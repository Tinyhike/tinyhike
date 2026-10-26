import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, type PhotoStatus } from '@prisma/client'
import { z } from 'zod'
import crypto from 'crypto'
import { requireAuth, type SessionPayload } from '../plugins/auth.js'
import { clientKey } from '../lib/client-key.js'
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  isAllowedImageType,
  type AllowedImageType,
  type ObjectHead,
  stagingBucket,
  uploadsEnabled,
  presignPut,
  copyObject,
  headObject,
  deleteObject,
} from '../lib/r2.js'
import { canSeePlace, VISIBILITY_SELECT } from '../lib/place-visibility.js'

/**
 * Photo upload, in three steps, none of which ever exposes unmoderated bytes:
 *
 *  1. POST /presign  mints a 2-minute PUT URL into the PRIVATE staging bucket at
 *                    uploads/<userId>/<uuid>.<ext>, pinned to the declared
 *                    Content-Type and exact size.
 *  2. The browser PUTs the file straight to R2 (the API never streams it).
 *  3. POST /confirm  copies it to confirmed/<userId>/<uuid>.<ext>, validates the
 *                    COPY, drops the upload, and queues a PENDING Photo row.
 *
 * Approval (src/services/photo-moderation.ts) re-encodes the image into the public
 * bucket; only then does a photo get a URL. The uploader is never handed one.
 */

// Short: a presigned PUT can be replayed until it expires. Confirm copies the
// object to a key the client can't write, so a replay can no longer change what a
// Photo row points at; the TTL just bounds the litter in uploads/ (which a staging
// lifecycle rule expires after a day).
const PRESIGN_TTL_SECONDS = 120

// Unmoderated photos a single account may have queued. Bounds both moderation
// backlog and the private storage one account can occupy.
const MAX_PENDING_PER_USER = 20

const PresignSchema = z.object({
  contentType: z.custom<AllowedImageType>((v) => typeof v === 'string' && isAllowedImageType(v), {
    message: 'Only JPEG, PNG or WebP images are allowed',
  }),
  // Declared by the client and signed into the URL as Content-Length, so R2 itself
  // refuses a body of any other size.
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  placeId: z.string().cuid().optional(),
  routeId: z.string().cuid().optional(),
})

const ConfirmSchema = z.object({
  key: z.string().max(200),
  placeId: z.string().cuid().optional(),
  routeId: z.string().cuid().optional(),
})

const UPLOAD_KEY = /^uploads\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png|webp)$/

/**
 * Keys are minted by /presign as uploads/<userId>/<uuid>.<ext>, so the path itself
 * proves who a key was issued to. The user id is compared as a string rather than
 * spliced into the pattern, so nothing in it is ever read as regex syntax.
 */
function isOwnKey(key: string, userId: string): boolean {
  const match = UPLOAD_KEY.exec(key)
  return match !== null && match[1] === userId
}

/** The server-owned twin of an upload key. Deterministic, so /confirm stays idempotent. */
function confirmedKeyFor(uploadKey: string): string {
  return `confirmed/${uploadKey.slice('uploads/'.length)}`
}

/**
 * Why the confirmed copy can't be queued, or null when it can. The presigned PUT
 * already pins type and size, but the copy is what gets moderated, so it is checked
 * on its own terms. A missing Content-Type is a failure, not a pass.
 */
function invalidUpload(
  head: ObjectHead,
  uploadKey: string,
): { status: 400 | 413; error: string; message: string } | null {
  const type = head.contentType?.split(';')[0].trim().toLowerCase()
  const ext = uploadKey.slice(uploadKey.lastIndexOf('.') + 1)
  if (!isAllowedImageType(type) || ALLOWED_IMAGE_TYPES[type] !== ext) {
    return { status: 400, error: 'BadRequest', message: 'Stored object is not an allowed image type' }
  }
  if (head.contentLength === undefined || head.contentLength < 1) {
    return { status: 400, error: 'BadRequest', message: 'Stored object is empty' }
  }
  if (head.contentLength > MAX_UPLOAD_BYTES) {
    return { status: 413, error: 'PayloadTooLarge', message: 'Image exceeds 10 MB' }
  }
  return null
}

/**
 * Per-ACCOUNT limit. Hooked on preHandler so it runs after requireAuth has set
 * req.session. Keyed by IP alone, one account could mint uploads from as many
 * networks as it can reach, while two parents behind one café NAT would share a
 * bucket. The IP fallback (IPv6 grouped by /64) only applies if a session is
 * somehow absent; requireAuth has already answered 401 by then.
 */
function perUserLimit(max: number) {
  return {
    max,
    timeWindow: '10 minutes',
    hook: 'preHandler' as const,
    keyGenerator: (req: FastifyRequest) => (req.session ? `user:${req.session.sub}` : `ip:${clientKey(req.ip)}`),
  }
}

/**
 * Whether the caller may attach a photo to a route. An APPROVED one is public;
 * before approval, or after a rejection, only its author and the moderators may
 * contribute to it. Everyone else gets the 404 every other endpoint gives for it.
 * Places follow canSeePlace() (lib/place-visibility.ts), which also hides
 * unverified cafés.
 */
function canContribute(
  target: { status: string; ownerId: string | null },
  session: SessionPayload,
): boolean {
  return target.status === 'APPROVED' || session.role === 'ADMIN' || target.ownerId === session.sub
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

const NOT_UPLOADED = { error: 'NotUploaded', message: 'No object found at that key' } as const

function uploadsDisabled(reply: FastifyReply) {
  return reply
    .status(503)
    .send({ error: 'UploadsDisabled', message: 'Photo uploads are not available right now' })
}

function tooManyPending(reply: FastifyReply) {
  return reply.status(429).send({
    error: 'TooManyPending',
    message: `You already have ${MAX_PENDING_PER_USER} photos waiting for review`,
  })
}

export default async function photosRoutes(app: FastifyInstance) {
  const pendingCount = (userId: string) =>
    app.prisma.photo.count({ where: { uploadedById: userId, status: 'PENDING' } })

  // GET /api/photos/config — lets the web hide the upload UI instead of offering a
  // button that can only fail. Uploads are off unless a private staging bucket is
  // configured: without one there is nowhere safe to put unmoderated bytes.
  app.get('/config', async () => ({ enabled: uploadsEnabled() }))

  // POST /api/photos/presign — mint a short-lived upload URL into staging.
  //
  // Writes nothing to the database: an abandoned upload must not leave a row that
  // looks like a photo awaiting moderation. The row is created by /confirm.
  app.post(
    '/presign',
    { preHandler: requireAuth, config: { rateLimit: perUserLimit(20) } },
    async (req, reply) => {
      const bucket = stagingBucket()
      if (!bucket) return uploadsDisabled(reply)

      const parsed = PresignSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'BadRequest', message: 'Invalid upload request', details: parsed.error.flatten() })
      }
      const { contentType, size } = parsed.data
      const userId = req.session!.sub

      if ((await pendingCount(userId)) >= MAX_PENDING_PER_USER) return tooManyPending(reply)

      // Namespacing by user is what lets /confirm prove the caller owns this key.
      // The key stays private: it names a staging object, never a public URL.
      const key = `uploads/${userId}/${crypto.randomUUID()}.${ALLOWED_IMAGE_TYPES[contentType]}`
      const uploadUrl = await presignPut({ bucket, key, contentType, size, expiresIn: PRESIGN_TTL_SECONDS })

      req.log.info({ userId, key, size, contentType }, 'photo upload presigned')
      return { uploadUrl, key, expiresIn: PRESIGN_TTL_SECONDS }
    },
  )

  // POST /api/photos/confirm — queue an upload that actually landed in staging.
  //
  // The object at uploads/… stays writable by whoever holds the presigned URL until
  // it expires, so validating it in place would be a check-then-use race: re-PUT a
  // different body after a successful confirm and the row would point at it. The
  // object is first copied to confirmed/…, a key no client can write, and it is the
  // COPY that gets validated and referenced.
  app.post(
    '/confirm',
    { preHandler: requireAuth, config: { rateLimit: perUserLimit(30) } },
    async (req, reply) => {
      const bucket = stagingBucket()
      if (!bucket) return uploadsDisabled(reply)

      const parsed = ConfirmSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'BadRequest', message: 'Invalid confirm request', details: parsed.error.flatten() })
      }
      const { key, placeId, routeId } = parsed.data
      const session = req.session!
      const userId = session.sub

      if (!isOwnKey(key, userId)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'That key was not issued to you' })
      }
      if (!placeId && !routeId) {
        return reply.status(400).send({ error: 'BadRequest', message: 'A photo must attach to a place or a route' })
      }

      // A dangling foreign key is the caller's mistake: 404 rather than a Prisma 500.
      // So is a place or route the caller can't see: it answers 404 everywhere else.
      if (placeId) {
        const place = await app.prisma.place.findUnique({ where: { id: placeId }, select: VISIBILITY_SELECT })
        if (!place || !canSeePlace(place, session)) {
          return reply.status(404).send({ error: 'NotFound', message: 'Place not found' })
        }
      }
      if (routeId) {
        const route = await app.prisma.route.findUnique({
          where: { id: routeId },
          select: { status: true, authorId: true },
        })
        if (!route || !canContribute({ status: route.status, ownerId: route.authorId }, session)) {
          return reply.status(404).send({ error: 'NotFound', message: 'Route not found' })
        }
      }

      const confirmedKey = confirmedKeyFor(key)

      // Idempotent: a retried confirm (flaky connection, double tap) gets the photo
      // it already created. The upload itself is gone by then, so this lookup has
      // to come before the copy.
      const existing = await app.prisma.photo.findFirst({
        where: { r2Key: confirmedKey, uploadedById: userId },
        select: { id: true, status: true },
      })
      if (existing) return alreadyConfirmed(reply, existing)

      if ((await pendingCount(userId)) >= MAX_PENDING_PER_USER) return tooManyPending(reply)

      if (!(await copyObject({ bucket, from: key, to: confirmedKey }))) {
        return reply.status(409).send(NOT_UPLOADED)
      }

      // From here until a row references it, the copy is this request's to clean up:
      // confirmed/ never expires, so any failure that left it behind would keep it
      // forever. Once a unique violation shows that a concurrent confirm's row
      // references the very same copy, it must stay.
      let referenced = false
      let photo: { id: string; status: PhotoStatus }
      let created = true
      try {
        const head = await headObject({ bucket, key: confirmedKey })
        if (!head) return reply.status(409).send(NOT_UPLOADED)

        // An invalid object is removed under both keys: nothing will ever reference it.
        // allSettled: a failed cleanup is logged, and must not turn the 400/413 the
        // client should see into a 500 that the web would retry.
        const invalid = invalidUpload(head, key)
        if (invalid) {
          const keys = [confirmedKey, key]
          const results = await Promise.allSettled(keys.map((k) => deleteObject({ bucket, key: k })))
          results.forEach((result, i) => {
            if (result.status === 'rejected') {
              req.log.warn({ err: result.reason, key: keys[i] }, 'could not delete invalid upload')
            }
          })
          req.log.warn({ userId, key, contentType: head.contentType, size: head.contentLength }, 'invalid upload rejected')
          return reply.status(invalid.status).send({ error: invalid.error, message: invalid.message })
        }

        try {
          photo = await app.prisma.photo.create({
            // r2Url stays null until approval: a PENDING photo has no public URL.
            data: { r2Key: confirmedKey, r2Url: null, status: 'PENDING', placeId, routeId, uploadedById: userId },
            select: { id: true, status: true },
          })
          referenced = true
        } catch (err) {
          if (!isUniqueViolation(err)) throw err
          // r2Key is unique: a concurrent confirm of the same upload won the race,
          // and its row references the copy.
          referenced = true
          const dupe = await app.prisma.photo.findFirst({
            where: { r2Key: confirmedKey, uploadedById: userId },
            select: { id: true, status: true },
          })
          if (!dupe) throw err
          photo = dupe
          created = false
        }
      } catch (err) {
        if (!referenced) {
          // The upload is left in place (uploads/ expires) so the client can retry.
          await deleteObject({ bucket, key: confirmedKey }).catch((delErr: unknown) =>
            req.log.warn({ err: delErr, key: confirmedKey }, 'could not delete unreferenced confirmed copy'),
          )
        }
        throw err
      }

      // Only now, with a row pointing at the copy, is the upload redundant. A
      // failed delete is harmless: it is private, and uploads/ expires.
      await deleteObject({ bucket, key }).catch((err: unknown) =>
        req.log.warn({ err, key }, 'could not delete confirmed upload source'),
      )

      if (!created) return alreadyConfirmed(reply, photo)
      req.log.info({ userId, photoId: photo.id, placeId, routeId }, 'photo queued for moderation')
      // Only id and status: the uploader learns no key and no URL for unmoderated bytes.
      return reply.status(201).send({ id: photo.id, status: 'PENDING' })
    },
  )
}

/**
 * A repeated confirm of an upload that already has a row. Still queued: 200 with
 * the same body as the first confirm. Already moderated (a REJECTED row keeps its
 * confirmed/ key; an APPROVED one moved to p/ and can't match): 409, so a retry
 * never reports a rejected photo as waiting for review.
 */
function alreadyConfirmed(reply: FastifyReply, photo: { id: string; status: PhotoStatus }) {
  if (photo.status !== 'PENDING') {
    return reply.status(409).send({ error: 'NotPending', message: 'This photo has already been reviewed' })
  }
  return reply.status(200).send({ id: photo.id, status: 'PENDING' })
}
