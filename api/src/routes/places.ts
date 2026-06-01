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

export default async function placesRoutes(app: FastifyInstance) {
  // GET /api/places?bbox=west,south,east,north&locale=nl
  app.get<{ Querystring: { bbox?: string; locale?: string } }>('/', async (req) => {
    const { bbox, locale = 'nl' } = req.query
    const where: Record<string, unknown> = { status: 'APPROVED' }

    // bbox filter via raw query for PostGIS — fallback to lat/lng range
    if (bbox) {
      const [west, south, east, north] = bbox.split(',').map(Number)
      where.lat = { gte: south, lte: north }
      where.lng = { gte: west, lte: east }
    }

    const places = await app.prisma.place.findMany({
      where,
      include: {
        translations: { where: { locale } },
        photos: { where: { status: 'APPROVED' }, take: 1 },
        _count: { select: { reviews: true } },
      },
      take: 200,
    })
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

  // POST /api/places/:id/reviews
  app.post<{ Params: { id: string } }>('/:id/reviews', async (req, reply) => {
    const schema = z.object({
      score: z.number().int().min(1).max(5),
      tagsConfirmed: z.array(z.string()).default([]),
      tagsDisputed: z.array(z.string()).default([]),
      comment: z.string().max(500).optional(),
      anonymous: z.boolean().default(false),
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
