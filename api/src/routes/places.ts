import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../plugins/auth.js'

const PlaceSubmitSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  locale: z.string().default('en'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  tips: z.string().max(300).optional(),
})

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

export default async function placesRoutes(app: FastifyInstance) {
  // GET /api/places?bbox=west,south,east,north&locale=nl&limit=200
  app.get<{ Querystring: { bbox?: string; locale?: string; limit?: string } }>('/', async (req, reply) => {
    const { bbox, locale = 'nl', limit: rawLimit } = req.query
    const where: Record<string, unknown> = { status: 'APPROVED' }

    let limit = DEFAULT_LIMIT
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        return reply.status(400).send({ error: 'BadRequest', message: `limit must be an integer between 1 and ${MAX_LIMIT}` })
      }
      limit = parsed
    }

    // bbox filter (lat/lng range). Validate before use so malformed input can't
    // silently produce NaN bounds and a broken/empty filter.
    if (bbox) {
      const parts = bbox.split(',').map(Number)
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        return reply.status(400).send({ error: 'BadRequest', message: 'bbox must be "west,south,east,north" numbers' })
      }
      const [west, south, east, north] = parts
      if (west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) {
        return reply.status(400).send({ error: 'BadRequest', message: 'bbox out of range or inverted' })
      }
      where.lat = { gte: south, lte: north }
      where.lng = { gte: west, lte: east }
    }

    // Fetch one more than asked for: if it comes back, the viewport holds more
    // places than we're returning. Cheaper than a COUNT on every map pan, and the
    // client needs to know — silently dropping pins reads as missing data.
    const rows = await app.prisma.place.findMany({
      where,
      include: {
        translations: { where: { locale } },
        photos: { where: { status: 'APPROVED' }, take: 1 },
        _count: { select: { reviews: true } },
      },
      take: limit + 1,
    })

    const truncated = rows.length > limit
    const places = truncated ? rows.slice(0, limit) : rows

    reply.header('X-Result-Truncated', String(truncated))
    if (truncated) {
      // Only now is the exact total worth a second query.
      reply.header('X-Total-Count', String(await app.prisma.place.count({ where })))
    } else {
      reply.header('X-Total-Count', String(places.length))
    }

    return places
  })

  // GET /api/places/:id?locale=nl
  app.get<{ Params: { id: string }; Querystring: { locale?: string } }>('/:id', async (req, reply) => {
    const place = await app.prisma.place.findUnique({
      where: { id: req.params.id },
      include: {
        translations: true,
        photos: { where: { status: 'APPROVED' } },
        reviews: { take: 20, orderBy: { createdAt: 'desc' } },
        _count: { select: { reviews: true } },
      },
    })
    if (!place) return reply.status(404).send({ error: 'Not found' })
    return place
  })

  // POST /api/places — authenticated user submission
  app.post('/', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = PlaceSubmitSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { lat, lng, locale, name, description, tips } = parsed.data

    const place = await app.prisma.place.create({
      data: {
        lat,
        lng,
        source: 'USER',
        status: 'PENDING',
        submittedById: req.session!.sub,
        translations: { create: { locale, name, description, tips } },
      },
      include: { translations: true },
    })
    return reply.status(201).send(place)
  })

  // POST /api/places/:id/reviews — unauthenticated by design (anonymous reviews),
  // so rate-limit to curb spam/bots.
  app.post<{ Params: { id: string } }>(
    '/:id/reviews',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const schema = z
      .object({
        // Optional: a tag confirmation ("yes, there's a changing table") is a review
        // with only tagsConfirmed/tagsDisputed. Forcing a star rating on it would
        // either block the lightest contribution or pollute the score average.
        score: z.number().int().min(1).max(5).optional(),
        tagsConfirmed: z.array(z.string()).max(19).default([]),
        tagsDisputed: z.array(z.string()).max(19).default([]),
        comment: z.string().max(500).optional(),
        anonymous: z.boolean().default(false),
      })
      .refine((r) => r.score !== undefined || r.comment || r.tagsConfirmed.length > 0 || r.tagsDisputed.length > 0, {
        message: 'A review must carry a score, a comment, or at least one tag vote',
      })
      // The same tag both confirmed and disputed is a contradiction, not a vote.
      .refine((r) => !r.tagsConfirmed.some((tag) => r.tagsDisputed.includes(tag)), {
        message: 'A tag cannot be both confirmed and disputed',
      })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const place = await app.prisma.place.findUnique({ where: { id: req.params.id } })
    if (!place) return reply.status(404).send({ error: 'Not found' })

    const review = await app.prisma.review.create({
      data: {
        placeId: req.params.id,
        userId: req.session?.sub ?? null,
        ...parsed.data,
      },
    })
    return reply.status(201).send(review)
  })
}
