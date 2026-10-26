import { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, optionalAuth } from '../plugins/auth.js'
import {
  canSeePlace,
  publicPlaceWhere,
  visiblePlaceWhere,
  withoutPrivateColumns,
  VISIBILITY_SELECT,
} from '../lib/place-visibility.js'
import crypto from 'crypto'

// Owners are shown by handle only. Their user id would be a join key: matched
// against any other payload that leaks an id, it attributes those contributions
// to a named parent. Nothing in the web app reads it.
const OWNER_SELECT = { select: { handle: true } } as const

const AddPlaceBody = z.object({
  // cuid
  placeId: z.string().regex(/^[a-z0-9]{1,40}$/),
  note: z.string().max(300).optional(),
})

export default async function listsRoutes(app: FastifyInstance) {
  // GET /api/lists/public
  // The counts, like the lists themselves, only include places the public can see.
  app.get('/public', async () => {
    return app.prisma.list.findMany({
      where: { visibility: 'PUBLIC' },
      omit: { ownerId: true },
      include: {
        translations: true,
        _count: { select: { listPlaces: { where: { place: publicPlaceWhere } } } },
        owner: OWNER_SELECT,
      },
      take: 50,
    })
  })

  // GET /api/lists/mine — authenticated
  app.get('/mine', { preHandler: requireAuth }, async (req) => {
    return app.prisma.list.findMany({
      where: { ownerId: req.session!.sub },
      include: {
        translations: true,
        _count: { select: { listPlaces: { where: { place: visiblePlaceWhere(req.session) } } } },
      },
    })
  })

  // GET /api/lists/:slug
  // optionalAuth: the owner of a PRIVATE list must be recognised to see it, and
  // req.session is only ever set by a preHandler.
  app.get<{ Params: { slug: string } }>('/:slug', { preHandler: optionalAuth }, async (req, reply) => {
    const list = await app.prisma.list.findUnique({
      where: { slug: req.params.slug },
      include: {
        translations: true,
        owner: OWNER_SELECT,
        listPlaces: {
          // Explicit select: addedById is a user id. The place row carries
          // submittedById and verifiedAt, loaded for canSeePlace() and stripped
          // below; verifiedById and updatedAt are never loaded.
          select: {
            id: true,
            note: true,
            position: true,
            createdAt: true,
            place: { omit: { verifiedById: true, updatedAt: true }, include: { translations: true } },
          },
          orderBy: { position: 'asc' },
        },
      },
    })
    if (!list) return reply.status(404).send({ error: 'NotFound', message: 'List not found' })

    const isOwner = req.session !== undefined && list.ownerId === req.session.sub
    if (list.visibility === 'PRIVATE' && !isOwner) {
      return reply.status(403).send({ error: 'Forbidden', message: 'This list is private' })
    }

    // ownerId is loaded only for the check above. Each place follows the same rule
    // as its own page: one the caller can't open (awaiting moderation, or an
    // unverified café) stays out of the list, the owner's own view included.
    const { ownerId: _ownerId, listPlaces, ...rest } = list
    return {
      ...rest,
      listPlaces: listPlaces
        .filter((lp) => canSeePlace(lp.place, req.session))
        .map((lp) => ({ ...lp, place: withoutPrivateColumns(lp.place) })),
    }
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
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Invalid list', details: parsed.error.flatten() })
    }
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
  app.post<{ Params: { slug: string } }>('/:slug/places', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = AddPlaceBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Invalid place', details: parsed.error.flatten() })
    }
    const { placeId, note } = parsed.data
    const session = req.session!

    const list = await app.prisma.list.findUnique({ where: { slug: req.params.slug } })
    if (!list || list.ownerId !== session.sub) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Not your list' })
    }

    // Same visibility rule as GET /api/places/:id: a place the public can't see can
    // only be listed by the parent who submitted it (or an admin), never discovered
    // by id.
    const place = await app.prisma.place.findUnique({ where: { id: placeId }, select: VISIBILITY_SELECT })
    if (!place || !canSeePlace(place, session)) {
      return reply.status(404).send({ error: 'NotFound', message: 'Place not found' })
    }

    try {
      const lp = await app.prisma.listPlace.create({
        data: { listId: list.id, placeId, addedById: session.sub, note },
      })
      return reply.status(201).send(lp)
    } catch (err) {
      // @@unique([listId, placeId])
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'AlreadyListed', message: 'This place is already in the list' })
      }
      throw err
    }
  })
}
