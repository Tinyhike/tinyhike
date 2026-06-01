import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../plugins/auth.js'

export default async function routesRoutes(app: FastifyInstance) {
  // GET /api/routes?bbox=…&locale=nl
  app.get<{ Querystring: { bbox?: string; locale?: string } }>('/', async (req) => {
    const { locale = 'nl' } = req.query
    return app.prisma.route.findMany({
      where: { status: 'APPROVED' },
      include: {
        translations: { where: { locale } },
        photos: { where: { status: 'APPROVED' }, take: 1 },
      },
      take: 100,
    })
  })

  // GET /api/routes/:id
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const route = await app.prisma.route.findUnique({
      where: { id: req.params.id },
      include: { translations: true, photos: { where: { status: 'APPROVED' } } },
    })
    if (!route) return reply.status(404).send({ error: 'Not found' })
    return route
  })

  // POST /api/routes/track — save raw GPS track, queued for simplification
  app.post('/track', { preHandler: requireAuth }, async (req, reply) => {
    const schema = z.object({
      coords: z.array(z.tuple([z.number(), z.number()])).min(2),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const track = await app.prisma.track.create({
      data: {
        rawGeojson: { type: 'LineString', coordinates: parsed.data.coords },
        userId: req.session!.sub,
      },
    })
    return reply.status(201).send(track)
  })
}
