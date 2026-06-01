import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../plugins/auth.js'
import crypto from 'crypto'

export default async function listsRoutes(app: FastifyInstance) {
  // GET /api/lists/public
  app.get('/public', async () => {
    return app.prisma.list.findMany({
      where: { visibility: 'PUBLIC' },
      include: {
        translations: true,
        _count: { select: { listPlaces: true } },
        owner: { select: { id: true, handle: true } },
      },
      take: 50,
    })
  })

  // GET /api/lists/mine — authenticated
  app.get('/mine', { preHandler: requireAuth }, async (req) => {
    return app.prisma.list.findMany({
      where: { ownerId: req.session!.sub },
      include: { translations: true, _count: { select: { listPlaces: true } } },
    })
  })

  // GET /api/lists/:slug
  app.get<{ Params: { slug: string } }>('/:slug', async (req, reply) => {
    const list = await app.prisma.list.findUnique({
      where: { slug: req.params.slug },
      include: {
        translations: true,
        owner: { select: { id: true, handle: true } },
        listPlaces: {
          include: { place: { include: { translations: true } } },
          orderBy: { position: 'asc' },
        },
      },
    })
    if (!list) return reply.status(404).send({ error: 'Not found' })
    if (list.visibility === 'PRIVATE' && list.ownerId !== req.session?.sub) {
      return reply.status(403).send({ error: 'Forbidden' })
    }
    return list
  })

  // POST /api/lists
  app.post('/', { preHandler: requireAuth }, async (req, reply) => {
    const schema = z.object({
      visibility: z.enum(['PRIVATE', 'UNLISTED', 'PUBLIC']).default('PRIVATE'),
      locale: z.string().default('nl'),
      name: z.string().min(1).max(60),
      description: z.string().max(200).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { visibility, locale, name, description } = parsed.data

    const slug = `${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-${crypto.randomBytes(3).toString('hex')}`
    const list = await app.prisma.list.create({
      data: {
        slug,
        visibility,
        ownerId: req.session!.sub,
        translations: { create: { locale, name, description } },
      },
      include: { translations: true },
    })
    return reply.status(201).send(list)
  })

  // POST /api/lists/:slug/places
  app.post<{ Params: { slug: string }; Body: { placeId: string; note?: string } }>(
    '/:slug/places',
    { preHandler: requireAuth },
    async (req, reply) => {
      const list = await app.prisma.list.findUnique({ where: { slug: req.params.slug } })
      if (!list || list.ownerId !== req.session!.sub) {
        return reply.status(403).send({ error: 'Forbidden' })
      }
      const lp = await app.prisma.listPlace.create({
        data: { listId: list.id, placeId: req.body.placeId, addedById: req.session!.sub, note: req.body.note },
      })
      return reply.status(201).send(lp)
    },
  )
}
