import { FastifyInstance } from 'fastify'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import crypto from 'crypto'
import { requireAuth } from '../plugins/auth.js'

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

// Explicit allowlist of raster image types. Excludes SVG (script payloads) and any
// other content type. The mapped value is the file extension used for the R2 key.
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_BYTES = 10 * 1024 * 1024
const PRESIGN_TTL_SECONDS = 300

const PresignSchema = z.object({
  contentType: z.string(),
  placeId: z.string().cuid().optional(),
  routeId: z.string().cuid().optional(),
})

const ConfirmSchema = z.object({
  key: z.string().max(200),
  placeId: z.string().cuid().optional(),
  routeId: z.string().cuid().optional(),
})

/** Keys are minted server-side as uploads/<userId>/<uuid>.<ext> — see presign. */
function isOwnKey(key: string, userId: string): boolean {
  const exts = Object.values(ALLOWED_IMAGE_TYPES).join('|')
  const pattern = new RegExp(
    `^uploads/${userId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${exts})$`,
  )
  return pattern.test(key)
}

export default async function photosRoutes(app: FastifyInstance) {
  // POST /api/photos/presign — mint a short-lived R2 upload URL.
  //
  // Deliberately writes nothing to the database. It used to create the Photo row
  // here, which meant every abandoned upload left a row pointing at an object that
  // was never stored, indistinguishable from a real photo awaiting moderation.
  // The row is now created in /confirm, once the object is known to exist.
  app.post(
    '/presign',
    { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const parsed = PresignSchema.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: 'BadRequest', message: 'Invalid body' })

      const ext = ALLOWED_IMAGE_TYPES[parsed.data.contentType]
      if (!ext) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Only JPEG, PNG, or WebP images are allowed' })
      }

      // Namespacing by user is what lets /confirm prove the caller owns this key.
      const key = `uploads/${req.session!.sub}/${crypto.randomUUID()}.${ext}`

      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: parsed.data.contentType }),
        { expiresIn: PRESIGN_TTL_SECONDS },
      )

      return { uploadUrl, key, expiresIn: PRESIGN_TTL_SECONDS }
    },
  )

  // POST /api/photos/confirm — record an upload that actually landed in R2.
  //
  // The previous version set status to PENDING on a row that was already PENDING,
  // so it did nothing at all: a client could skip the upload entirely and still
  // have a photo queued for moderation. This verifies the object first.
  app.post(
    '/confirm',
    { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const parsed = ConfirmSchema.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: 'BadRequest', message: 'Invalid body' })
      const { key, placeId, routeId } = parsed.data
      const userId = req.session!.sub

      if (!isOwnKey(key, userId)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'That key was not issued to you' })
      }
      if (!placeId && !routeId) {
        return reply.status(400).send({ error: 'BadRequest', message: 'A photo must attach to a place or a route' })
      }

      // Reject a dangling foreign key with a 400 rather than letting Prisma raise a 500.
      if (placeId && !(await app.prisma.place.findUnique({ where: { id: placeId }, select: { id: true } }))) {
        return reply.status(404).send({ error: 'NotFound', message: 'Place not found' })
      }
      if (routeId && !(await app.prisma.route.findUnique({ where: { id: routeId }, select: { id: true } }))) {
        return reply.status(404).send({ error: 'NotFound', message: 'Route not found' })
      }

      let head
      try {
        head = await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
      } catch {
        return reply.status(409).send({ error: 'NotUploaded', message: 'No object found at that key' })
      }

      // The presigned PUT pins ContentType, but never trust the stored object's own
      // metadata blindly: re-check both before queueing it for human/AI moderation.
      if (head.ContentType && !ALLOWED_IMAGE_TYPES[head.ContentType]) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Stored object is not an allowed image type' })
      }
      if ((head.ContentLength ?? 0) > MAX_BYTES) {
        return reply.status(413).send({ error: 'PayloadTooLarge', message: 'Image exceeds 10 MB' })
      }

      try {
        return await app.prisma.photo.create({
          data: {
            r2Key: key,
            r2Url: `${process.env.R2_PUBLIC_URL}/${key}`,
            status: 'PENDING',
            placeId,
            routeId,
            uploadedById: userId,
          },
        })
      } catch (err) {
        // r2Key is unique, so a repeated confirm lands here. Idempotent by design:
        // a flaky connection shouldn't turn one upload into an error the user sees.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const existing = await app.prisma.photo.findUnique({ where: { r2Key: key } })
          if (existing) return existing
        }
        throw err
      }
    },
  )
}
