import { FastifyInstance, FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAdmin } from '../plugins/auth.js'
import { listPhotos, approvePhoto, rejectPhoto, PhotoModerationError } from '../services/photo-moderation.js'

// Ids are cuids. A malformed one cannot name a row, so it is answered like any
// other unknown id: 404, not 400.
const IdParams = z.object({ id: z.string().cuid() })

const PlaceModerationSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
})

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

function badRequest(reply: FastifyReply, message: string, error: z.ZodError) {
  return reply.status(400).send({ error: 'BadRequest', message, details: error.flatten() })
}

export default async function adminRoutes(app: FastifyInstance) {
  // GET /api/admin/stats
  app.get('/stats', { preHandler: requireAdmin }, async () => {
    const [places, pendingPlaces, photos, pendingPhotos, users] = await Promise.all([
      app.prisma.place.count(),
      app.prisma.place.count({ where: { status: 'PENDING' } }),
      app.prisma.photo.count(),
      app.prisma.photo.count({ where: { status: 'PENDING' } }),
      app.prisma.user.count(),
    ])
    return { places, pendingPlaces, photos, pendingPhotos, users }
  })

  // PATCH /api/admin/places/:id — approve / reject
  app.patch('/places/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const params = IdParams.safeParse(req.params)
    if (!params.success) return reply.status(404).send({ error: 'NotFound', message: 'Place not found' })
    const body = PlaceModerationSchema.safeParse(req.body)
    if (!body.success) return badRequest(reply, 'Invalid status', body.error)

    try {
      return await app.prisma.place.update({ where: { id: params.data.id }, data: { status: body.data.status } })
    } catch (err) {
      // P2025: no row to update. The caller's mistake, not a server fault.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'NotFound', message: 'Place not found' })
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

  // POST /api/admin/seed — bulk upsert OSM places
  app.post<{ Body: { places: Array<{ osmId: string; lat: number; lng: number; name: string; locale?: string }> } }>(
    '/seed',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { places } = req.body
      let created = 0

      for (const p of places) {
        const existing = await app.prisma.place.findUnique({ where: { osmId: p.osmId } })
        if (existing) continue
        await app.prisma.place.create({
          data: {
            lat: p.lat,
            lng: p.lng,
            osmId: p.osmId,
            source: 'OSM',
            status: 'PENDING',
            translations: { create: { locale: p.locale ?? 'nl', name: p.name } },
          },
        })
        created++
      }

      return { created }
    },
  )
}
