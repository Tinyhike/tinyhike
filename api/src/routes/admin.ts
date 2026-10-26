import { FastifyInstance, FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAdmin } from '../plugins/auth.js'
import { listPhotos, approvePhoto, rejectPhoto, PhotoModerationError } from '../services/photo-moderation.js'
import {
  assertAdmin,
  listPlacesForVerification,
  verifyPlace,
  unverifyPlace,
  PlaceVerificationError,
} from '../services/place-verification.js'
import { publicPlaceWhere } from '../lib/place-visibility.js'

// Ids are cuids. A malformed one cannot name a row, so it is answered like any
// other unknown id: 404, not 400.
const IdParams = z.object({ id: z.string().cuid() })

const CATEGORIES = ['PLAYGROUND', 'PARK', 'PICNIC_SITE', 'CAFE'] as const

// Approving a proposal and classifying it are moderation; verifying it is a
// separate action (PUT …/verification). Approval alone never verifies.
const PlaceModerationSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED']).optional(),
    // null clears it (unknown, so hidden unless verified).
    category: z.enum(CATEGORIES).nullable().optional(),
  })
  .strict()
  .refine((body) => body.status !== undefined || body.category !== undefined, {
    message: 'Give a status, a category, or both',
  })

const PlaceListQuery = z.object({
  category: z.enum([...CATEGORIES, 'NONE']).optional(),
  verified: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  name: z.string().trim().min(1).max(100).optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
})

// The four points of a visit, all required: a verification states each of them,
// "no" included.
const VerificationSchema = z
  .object({
    stepFree: z.boolean(),
    strollerRoom: z.boolean(),
    changingTable: z.boolean(),
    toilets: z.boolean(),
  })
  .strict()

const PhotoListQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
  take: z.coerce.number().int().min(1).max(100).default(50),
})

const PhotoModerationSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  // A blank note is no note.
  moderationNote: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((note) => note || undefined),
})

const SeedBody = z.object({
  places: z
    .array(
      z.object({
        // Typed ids (osm:way/123), or the legacy bare form (osm:123).
        osmId: z.string().regex(/^osm:((node|way|relation)\/)?\d{1,20}$/),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        name: z.string().trim().min(1).max(100),
        locale: z.enum(['nl', 'fr', 'en']).default('nl'),
        category: z.enum(CATEGORIES).optional(),
      }),
    )
    .max(1000),
})

function badRequest(reply: FastifyReply, message: string, error: z.ZodError) {
  return reply.status(400).send({ error: 'BadRequest', message, details: error.flatten() })
}

export default async function adminRoutes(app: FastifyInstance) {
  // GET /api/admin/stats
  app.get('/stats', { preHandler: requireAdmin }, async () => {
    const [places, visiblePlaces, verifiedPlaces, pendingPlaces, photos, pendingPhotos, users] = await Promise.all([
      app.prisma.place.count(),
      app.prisma.place.count({ where: publicPlaceWhere }),
      app.prisma.place.count({ where: { verifiedAt: { not: null } } }),
      app.prisma.place.count({ where: { status: 'PENDING' } }),
      app.prisma.photo.count(),
      app.prisma.photo.count({ where: { status: 'PENDING' } }),
      app.prisma.user.count(),
    ])
    // Hidden = everything not public, by subtraction: `NOT publicPlaceWhere` in SQL
    // would skip every row whose category is NULL (NOT of an unknown is unknown).
    const hiddenPlaces = places - visiblePlaces
    return { places, visiblePlaces, hiddenPlaces, verifiedPlaces, pendingPlaces, photos, pendingPhotos, users }
  })

  // GET /api/admin/places?category=CAFE&verified=false&name=…&take=100 — places to
  // verify. Each comes with its four points as they stand and whether it is public.
  app.get('/places', { preHandler: requireAdmin }, async (req, reply) => {
    const query = PlaceListQuery.safeParse(req.query)
    if (!query.success) return badRequest(reply, 'Invalid query', query.error)
    return listPlacesForVerification(app.prisma, query.data)
  })

  // PATCH /api/admin/places/:id — approve / reject a proposal, and/or set its category
  app.patch('/places/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const params = IdParams.safeParse(req.params)
    if (!params.success) return reply.status(404).send({ error: 'NotFound', message: 'Place not found' })
    const body = PlaceModerationSchema.safeParse(req.body)
    if (!body.success) return badRequest(reply, 'Invalid status or category', body.error)

    try {
      // A category change can put a hidden café on the public map, like a
      // verification: same check of the role in the database, not the JWT.
      if (body.data.category !== undefined) await assertAdmin(app.prisma, req.session!.sub)
      return await app.prisma.place.update({ where: { id: params.data.id }, data: body.data })
    } catch (err) {
      // P2025: no row to update. The caller's mistake, not a server fault.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'NotFound', message: 'Place not found' })
      }
      if (err instanceof PlaceVerificationError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message })
      }
      throw err
    }
  })

  // PUT /api/admin/places/:id/verification — record a visit: the four points, the
  // date and the admin. See src/services/place-verification.ts.
  app.put('/places/:id/verification', { preHandler: requireAdmin }, async (req, reply) => {
    const params = IdParams.safeParse(req.params)
    if (!params.success) return reply.status(404).send({ error: 'NotFound', message: 'Place not found' })
    const body = VerificationSchema.safeParse(req.body)
    if (!body.success) return badRequest(reply, 'Invalid verification', body.error)

    try {
      const result = await verifyPlace(app.prisma, params.data.id, body.data, req.session!.sub)
      req.log.info({ placeId: result.id, by: req.session!.sub, visible: result.visible }, 'place verified')
      return result
    } catch (err) {
      if (err instanceof PlaceVerificationError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message })
      }
      throw err
    }
  })

  // DELETE /api/admin/places/:id/verification — withdraw it. The place is hidden
  // again unless its category is public; the four points stay.
  app.delete('/places/:id/verification', { preHandler: requireAdmin }, async (req, reply) => {
    const params = IdParams.safeParse(req.params)
    if (!params.success) return reply.status(404).send({ error: 'NotFound', message: 'Place not found' })

    try {
      const result = await unverifyPlace(app.prisma, params.data.id, req.session!.sub)
      req.log.info({ placeId: result.id, by: req.session!.sub, visible: result.visible }, 'place unverified')
      return result
    } catch (err) {
      if (err instanceof PlaceVerificationError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message })
      }
      throw err
    }
  })

  // GET /api/admin/photos?status=PENDING&take=50 — the moderation queue. A PENDING
  // photo's viewUrl is a 10-minute signed link into the private staging bucket.
  app.get('/photos', { preHandler: requireAdmin }, async (req, reply) => {
    const query = PhotoListQuery.safeParse(req.query)
    if (!query.success) return badRequest(reply, 'Invalid query', query.error)
    return { photos: await listPhotos(app.prisma, query.data) }
  })

  // PATCH /api/admin/photos/:id — approve (re-encode and publish) or reject (delete
  // the bytes; for an approved photo, a takedown). See src/services/photo-moderation.ts.
  //
  // Answers { id, status, r2Url, purgeUrl }. purgeUrl is non-null when a public
  // object was deleted: the Cloudflare edge keeps serving it (immutable, one year)
  // until that URL is purged by hand, so a takedown is not done until then.
  app.patch('/photos/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const params = IdParams.safeParse(req.params)
    if (!params.success) return reply.status(404).send({ error: 'NotFound', message: 'Photo not found' })
    const body = PhotoModerationSchema.safeParse(req.body)
    if (!body.success) return badRequest(reply, 'Invalid moderation request', body.error)

    const { status, moderationNote } = body.data
    const opts = { moderationNote, log: req.log }
    try {
      const result =
        status === 'APPROVED'
          ? await approvePhoto(app.prisma, params.data.id, opts)
          : await rejectPhoto(app.prisma, params.data.id, opts)
      req.log.info(
        { photoId: result.id, status: result.status, purgeUrl: result.purgeUrl, by: req.session?.sub },
        'photo moderated',
      )
      return result
    } catch (err) {
      if (err instanceof PhotoModerationError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message })
      }
      throw err
    }
  })

  // POST /api/admin/seed — bulk insert OSM places (meant for the Overpass-diff
  // cron, not wired yet). Places land PENDING. Without a category an approved one
  // would still be hidden, so the caller passes the category it read from OSM.
  app.post('/seed', { preHandler: requireAdmin }, async (req, reply) => {
    const body = SeedBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, 'Invalid seed', body.error)
    let created = 0

    for (const p of body.data.places) {
      const existing = await app.prisma.place.findUnique({ where: { osmId: p.osmId } })
      if (existing) continue
      await app.prisma.place.create({
        data: {
          lat: p.lat,
          lng: p.lng,
          osmId: p.osmId,
          source: 'OSM',
          status: 'PENDING',
          category: p.category,
          translations: { create: { locale: p.locale, name: p.name } },
        },
      })
      created++
    }

    return { created }
  })
}
