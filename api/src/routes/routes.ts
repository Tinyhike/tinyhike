import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../plugins/auth.js'

// Explicit select: a Photo row also carries uploadedById, r2Key and the
// moderator's note, none of which belong in a public response.
const PUBLIC_PHOTO_SELECT = { id: true, r2Url: true, createdAt: true } as const

export default async function routesRoutes(app: FastifyInstance) {
  // GET /api/routes?bbox=…&locale=nl
  app.get<{ Querystring: { bbox?: string; locale?: string } }>('/', async (req) => {
    const { locale = 'nl' } = req.query
    return app.prisma.route.findMany({
      where: { status: 'APPROVED' },
      // The author's user id is internal, like a place's submittedById.
      omit: { authorId: true },
      include: {
        translations: { where: { locale } },
        photos: { where: { status: 'APPROVED' }, take: 1, select: PUBLIC_PHOTO_SELECT },
      },
      take: 100,
    })
  })

  // GET /api/routes/:id
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const route = await app.prisma.route.findUnique({
      where: { id: req.params.id },
      omit: { authorId: true },
      include: { translations: true, photos: { where: { status: 'APPROVED' }, select: PUBLIC_PHOTO_SELECT } },
    })
    if (!route) return reply.status(404).send({ error: 'NotFound', message: 'Route not found' })
    return route
  })

  // POST /api/routes/track — save raw GPS track, queued for simplification
  app.post('/track', { preHandler: requireAuth }, async (req, reply) => {
    const schema = z.object({
      coords: z.array(z.tuple([z.number(), z.number()])).min(2),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Invalid track', details: parsed.error.flatten() })
    }

    const track = await app.prisma.track.create({
      data: {
        rawGeojson: { type: 'LineString', coordinates: parsed.data.coords },
        userId: req.session!.sub,
      },
    })
    return reply.status(201).send(track)
  })
}
