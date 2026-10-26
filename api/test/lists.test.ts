import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'

// Before any import reads it: plugins/auth.ts derives its key at load time, and
// dotenv never overrides a variable that is already set.
vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-only-jwt-secret'
})

import { buildApp } from '../src/app.js'
import { signSession, SESSION_COOKIE } from '../src/plugins/auth.js'
import { makePrismaMock, asPrisma } from './helpers.js'

async function cookiesFor(sub: string, role = 'MEMBER') {
  return { [SESSION_COOKIE]: await signSession({ sub, role }) }
}

/** The shared mock plus the one model only these routes touch. */
function makeMock() {
  return Object.assign(makePrismaMock(), {
    listPlace: { create: vi.fn().mockResolvedValue({ id: 'lp1' }) },
  })
}

function listRow(over: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    slug: 'parks-abc123',
    visibility: 'PRIVATE',
    ownerId: 'u-owner',
    translations: [],
    owner: { handle: 'marieke' },
    listPlaces: [
      { id: 'lp1', note: null, position: 0, createdAt: new Date(), place: { id: 'p1', status: 'APPROVED', translations: [] } },
      { id: 'lp2', note: null, position: 1, createdAt: new Date(), place: { id: 'p2', status: 'PENDING', translations: [] } },
    ],
    ...over,
  }
}

describe('lists', () => {
  let app: FastifyInstance
  let prisma: ReturnType<typeof makeMock>

  beforeEach(async () => {
    prisma = makeMock()
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  describe('GET /api/lists/:slug', () => {
    it('lets the owner open their own PRIVATE list', async () => {
      prisma.list.findUnique.mockResolvedValueOnce(listRow())
      const res = await app.inject({ method: 'GET', url: '/api/lists/parks-abc123', cookies: await cookiesFor('u-owner') })
      expect(res.statusCode).toBe(200)
      // The owner still sees the place they added while it awaits moderation.
      expect(res.json().listPlaces).toHaveLength(2)
    })

    it('is 403 for a PRIVATE list to anyone else, signed in or not', async () => {
      prisma.list.findUnique.mockResolvedValue(listRow())
      expect((await app.inject({ method: 'GET', url: '/api/lists/parks-abc123' })).statusCode).toBe(403)
      const other = await app.inject({ method: 'GET', url: '/api/lists/parks-abc123', cookies: await cookiesFor('u-other') })
      expect(other.statusCode).toBe(403)
    })

    it('never publishes user ids, and hides unmoderated places from visitors', async () => {
      prisma.list.findUnique.mockResolvedValueOnce(listRow({ visibility: 'PUBLIC' }))
      const res = await app.inject({ method: 'GET', url: '/api/lists/parks-abc123' })
      const body = res.json()

      expect(res.statusCode).toBe(200)
      expect(body).not.toHaveProperty('ownerId')
      expect(res.body).not.toContain('u-owner')
      expect(body.listPlaces.map((lp: { id: string }) => lp.id)).toEqual(['lp1'])

      // The mock does not apply select/omit: assert on what the route asks for.
      const arg = prisma.list.findUnique.mock.calls[0][0] as {
        include: { owner: unknown; listPlaces: { select: Record<string, unknown> } }
      }
      expect(arg.include.owner).toEqual({ select: { handle: true } })
      expect(arg.include.listPlaces.select).not.toHaveProperty('addedById')
      expect(arg.include.listPlaces.select.place).toEqual({
        omit: { submittedById: true },
        include: { translations: true },
      })
    })
  })

  it('GET /api/lists/public asks for no owner id at all', async () => {
    await app.inject({ method: 'GET', url: '/api/lists/public' })
    const arg = prisma.list.findMany.mock.calls[0][0] as { omit: unknown; include: { owner: unknown } }
    expect(arg.omit).toEqual({ ownerId: true })
    expect(arg.include.owner).toEqual({ select: { handle: true } })
  })

  describe('POST /api/lists/:slug/places', () => {
    beforeEach(() => {
      prisma.list.findUnique.mockResolvedValue({ id: 'l1', ownerId: 'u-owner' })
    })

    it('adds an approved place', async () => {
      prisma.place.findUnique.mockResolvedValueOnce({ status: 'APPROVED', submittedById: null })
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists/parks-abc123/places',
        payload: { placeId: 'p1' },
        cookies: await cookiesFor('u-owner'),
      })
      expect(res.statusCode).toBe(201)
    })

    it("refuses someone else's unmoderated place with 404", async () => {
      prisma.place.findUnique.mockResolvedValueOnce({ status: 'PENDING', submittedById: 'u-other' })
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists/parks-abc123/places',
        payload: { placeId: 'p2' },
        cookies: await cookiesFor('u-owner'),
      })
      expect(res.statusCode).toBe(404)
      expect(prisma.listPlace.create).not.toHaveBeenCalled()
    })

    it('rejects a malformed body with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists/parks-abc123/places',
        payload: { placeId: '../x' },
        cookies: await cookiesFor('u-owner'),
      })
      expect(res.statusCode).toBe(400)
    })

    it('answers 409 when the place is already in the list', async () => {
      prisma.place.findUnique.mockResolvedValueOnce({ status: 'APPROVED', submittedById: null })
      prisma.listPlace.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: Prisma.prismaVersion.client,
        }),
      )
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists/parks-abc123/places',
        payload: { placeId: 'p1' },
        cookies: await cookiesFor('u-owner'),
      })
      expect(res.statusCode).toBe(409)
    })
  })
})
