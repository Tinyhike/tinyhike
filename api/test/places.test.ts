import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

// Before any import reads it: plugins/auth.ts derives its key at load time, and
// dotenv never overrides a variable that is already set. Tests sign their own
// sessions, so they never need (or touch) the real secret.
vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-only-jwt-secret'
})

import { buildApp } from '../src/app.js'
import { signSession, SESSION_COOKIE } from '../src/plugins/auth.js'
import { makePrismaMock, asPrisma, type PrismaMock } from './helpers.js'

const WRITTEN = { OR: [{ score: { not: null } }, { comment: { not: null } }] }
const ORDER = [{ createdAt: 'desc' }, { id: 'desc' }]

async function cookiesFor(sub: string, role = 'MEMBER') {
  return { [SESSION_COOKIE]: await signSession({ sub, role }) }
}

/** A place row as Prisma would return it with the detail's include. */
function placeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    status: 'APPROVED',
    submittedById: 'u-submitter',
    lat: 51.92,
    lng: 4.48,
    translations: [],
    photos: [],
    reviews: [],
    ...over,
  }
}

function reviewRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    score: 4,
    comment: 'Fine',
    tagsConfirmed: [],
    tagsDisputed: [],
    anonymous: true,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    user: null,
    ...over,
  }
}

describe('GET /api/places', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = makePrismaMock()
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  it('rejects a malformed (non-numeric) bbox with 400 and does not query', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/places?bbox=abc,def,ghi' })
    expect(res.statusCode).toBe(400)
    expect(prisma.place.findMany).not.toHaveBeenCalled()
  })

  it('rejects an inverted bbox (west > east) with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/places?bbox=10,10,5,5' })
    expect(res.statusCode).toBe(400)
    expect(prisma.place.findMany).not.toHaveBeenCalled()
  })

  it('accepts a valid bbox, returns 200, and filters on status APPROVED with correct bounds', async () => {
    // bbox = west,south,east,north
    const res = await app.inject({ method: 'GET', url: '/api/places?bbox=4.4,51.8,4.6,51.95&locale=nl' })
    expect(res.statusCode).toBe(200)
    expect(prisma.place.findMany).toHaveBeenCalledTimes(1)

    const arg = prisma.place.findMany.mock.calls[0][0] as {
      where: { status: string; lat: unknown; lng: unknown }
    }
    expect(arg.where.status).toBe('APPROVED') // only approved places are public
    expect(arg.where.lat).toEqual({ gte: 51.8, lte: 51.95 })
    expect(arg.where.lng).toEqual({ gte: 4.4, lte: 4.6 })
  })

  it('without a bbox still filters on APPROVED', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/places' })
    expect(res.statusCode).toBe(200)
    const arg = prisma.place.findMany.mock.calls[0][0] as { where: { status: string } }
    expect(arg.where.status).toBe('APPROVED')
  })

  it.each(['0', '501', 'abc', '1.5', '-3'])('rejects limit=%s with 400', async (limit) => {
    const res = await app.inject({ method: 'GET', url: `/api/places?limit=${limit}` })
    expect(res.statusCode).toBe(400)
    expect(prisma.place.findMany).not.toHaveBeenCalled()
  })

  it('asks for one row beyond the limit, to detect truncation without a COUNT', async () => {
    await app.inject({ method: 'GET', url: '/api/places?limit=10' })
    const arg = prisma.place.findMany.mock.calls[0][0] as { take: number }
    expect(arg.take).toBe(11)
  })

  it('reports an untruncated result and does not run a COUNT', async () => {
    prisma.place.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
    const res = await app.inject({ method: 'GET', url: '/api/places?limit=10' })

    expect(res.headers['x-result-truncated']).toBe('false')
    expect(res.headers['x-total-count']).toBe('2')
    expect(res.json()).toHaveLength(2)
    expect(prisma.place.count).not.toHaveBeenCalled()
  })

  it('trims the extra row, flags truncation, and reports the real total', async () => {
    // 3 rows for a limit of 2 — the third only exists to prove there are more.
    prisma.place.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    prisma.place.count.mockResolvedValueOnce(312)

    const res = await app.inject({ method: 'GET', url: '/api/places?limit=2' })

    expect(res.json()).toHaveLength(2) // the probe row is never returned
    expect(res.headers['x-result-truncated']).toBe('true')
    expect(res.headers['x-total-count']).toBe('312')
  })

  // The mock does not apply select/omit, so privacy is asserted on what the route
  // ASKS Prisma for: that is what decides the shape of the real response.
  it('never asks for submittedById or private photo columns on the map list', async () => {
    await app.inject({ method: 'GET', url: '/api/places' })
    const arg = prisma.place.findMany.mock.calls[0][0] as {
      omit: Record<string, boolean>
      include: { photos: unknown }
    }
    expect(arg.omit).toEqual({ submittedById: true })
    expect(arg.include.photos).toEqual({ where: { status: 'APPROVED' }, take: 1, select: { id: true, r2Url: true } })
  })
})

describe('GET /api/places/:id', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = makePrismaMock()
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  it('asks Prisma only for public photo and review columns, written reviews only, newest first', async () => {
    prisma.place.findUnique.mockResolvedValueOnce(placeRow())
    await app.inject({ method: 'GET', url: '/api/places/p1' })

    const arg = prisma.place.findUnique.mock.calls[0][0] as {
      include: { photos: unknown; reviews: { where: unknown; orderBy: unknown; take: number; select: Record<string, unknown> }; _count?: unknown }
    }
    expect(arg.include.photos).toEqual({
      where: { status: 'APPROVED' },
      select: { id: true, r2Url: true, createdAt: true },
    })
    expect(arg.include.reviews.where).toEqual(WRITTEN)
    expect(arg.include.reviews.orderBy).toEqual(ORDER)
    expect(arg.include.reviews.take).toBe(20)
    expect(arg.include.reviews.select).not.toHaveProperty('userId')
    expect(arg.include.reviews.select.user).toEqual({ select: { handle: true } })
    expect(arg.include).not.toHaveProperty('_count')
  })

  it('strips submittedById and never publishes review userIds or _count', async () => {
    prisma.place.findUnique.mockResolvedValueOnce(
      placeRow({
        submittedById: 'u-secret',
        // A row carrying more than the select asked for: the mapper must still
        // publish only the ReviewItem fields.
        reviews: [{ ...reviewRow('r1'), userId: 'u-author', anonymous: false, user: { handle: 'marieke', email: 'm@x.nl' } }],
      }),
    )
    prisma.review.count.mockResolvedValue(1)

    const res = await app.inject({ method: 'GET', url: '/api/places/p1' })
    const body = res.json()
    const raw = res.body

    expect(res.statusCode).toBe(200)
    expect(body).not.toHaveProperty('submittedById')
    expect(body).not.toHaveProperty('_count')
    expect(raw).not.toContain('u-secret')
    expect(raw).not.toContain('u-author')
    expect(raw).not.toContain('m@x.nl')
    expect(body.reviews[0]).toEqual({
      id: 'r1',
      score: 4,
      comment: 'Fine',
      tagsConfirmed: [],
      tagsDisputed: [],
      anonymous: false,
      createdAt: '2026-10-01T10:00:00.000Z',
      user: { handle: 'marieke' },
    })
  })

  it('averages over all rated reviews and strips authors of anonymous ones', async () => {
    prisma.place.findUnique.mockResolvedValueOnce(
      placeRow({
        reviews: [
          reviewRow('r1', { score: 5, anonymous: false, user: { handle: 'marieke' } }),
          // anonymous: true — the handle must NOT survive into the response.
          reviewRow('r2', { score: 3, anonymous: true, user: { handle: 'secret' } }),
        ],
      }),
    )
    prisma.review.aggregate.mockResolvedValueOnce({ _avg: { score: 4.6 }, _count: { score: 12 } })

    const res = await app.inject({ method: 'GET', url: '/api/places/p1' })
    const body = res.json()

    expect(body.scoreAvg).toBe(4.6)
    expect(body.scoreCount).toBe(12) // from the aggregate, not the 20 loaded rows
    expect(body.reviews[0].user).toEqual({ handle: 'marieke' })
    expect(body.reviews[1].user).toBeNull()
    expect(res.body).not.toContain('secret')
    // Aggregate only counts rated reviews — tag-only confirmations aren't ratings.
    const aggArg = prisma.review.aggregate.mock.calls[0][0] as { where: { placeId: string; score: unknown } }
    expect(aggArg.where).toEqual({ placeId: 'p1', score: { not: null } })
  })

  it('reports written reviews and tag-only votes as separate server-side totals', async () => {
    prisma.place.findUnique.mockResolvedValueOnce(placeRow({ reviews: [reviewRow('r1'), reviewRow('r2')] }))
    prisma.review.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      'OR' in where ? 25 : 7,
    )

    const body = (await app.inject({ method: 'GET', url: '/api/places/p1' })).json()

    expect(body.reviewCount).toBe(25)
    expect(body.voteCount).toBe(7)
    // More written reviews exist than were loaded: the client pages on from the last one.
    expect(body.nextCursor).toBe('r2')

    const wheres = prisma.review.count.mock.calls.map((c) => (c[0] as { where: unknown }).where)
    expect(wheres).toContainEqual({ placeId: 'p1', ...WRITTEN })
    expect(wheres).toContainEqual({ placeId: 'p1', score: null, comment: null })
  })

  it('has no nextCursor when every written review is already loaded', async () => {
    prisma.place.findUnique.mockResolvedValueOnce(placeRow({ reviews: [reviewRow('r1'), reviewRow('r2')] }))
    prisma.review.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      'OR' in where ? 2 : 40,
    )

    const body = (await app.inject({ method: 'GET', url: '/api/places/p1' })).json()
    expect(body.reviewCount).toBe(2)
    expect(body.voteCount).toBe(40)
    expect(body.nextCursor).toBeNull()
  })

  it('answers 404 { error: NotFound } for an unknown place', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/places/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('NotFound')
  })

  describe('a place awaiting moderation', () => {
    it.each(['PENDING', 'REJECTED'])('%s is 404 for an anonymous visitor', async (status) => {
      prisma.place.findUnique.mockResolvedValueOnce(placeRow({ status }))
      const res = await app.inject({ method: 'GET', url: '/api/places/p1' })
      expect(res.statusCode).toBe(404)
      expect(prisma.review.count).not.toHaveBeenCalled()
    })

    it('is 404 for another signed-in parent', async () => {
      prisma.place.findUnique.mockResolvedValueOnce(placeRow({ status: 'PENDING' }))
      const res = await app.inject({ method: 'GET', url: '/api/places/p1', cookies: await cookiesFor('u-stranger') })
      expect(res.statusCode).toBe(404)
    })

    it('is visible to the parent who submitted it, still without submittedById', async () => {
      prisma.place.findUnique.mockResolvedValueOnce(placeRow({ status: 'PENDING' }))
      const res = await app.inject({ method: 'GET', url: '/api/places/p1', cookies: await cookiesFor('u-submitter') })
      expect(res.statusCode).toBe(200)
      expect(res.json()).not.toHaveProperty('submittedById')
    })

    it('is visible to an admin', async () => {
      prisma.place.findUnique.mockResolvedValueOnce(placeRow({ status: 'PENDING' }))
      const res = await app.inject({ method: 'GET', url: '/api/places/p1', cookies: await cookiesFor('u-admin', 'ADMIN') })
      expect(res.statusCode).toBe(200)
    })
  })

  it('treats a garbage session cookie as anonymous, never as a 401', async () => {
    prisma.place.findUnique.mockResolvedValueOnce(placeRow())
    const res = await app.inject({ method: 'GET', url: '/api/places/p1', cookies: { [SESSION_COOKIE]: 'garbage' } })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /api/places/:id/reviews', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = makePrismaMock()
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
    prisma.place.findUnique.mockResolvedValue({ id: 'p1', status: 'APPROVED', submittedById: null })
  })
  afterEach(async () => {
    await app.close()
  })

  it('serves the first page of written reviews, newest first, 20 by default', async () => {
    prisma.review.findMany.mockResolvedValueOnce([reviewRow('r1'), reviewRow('r2')])

    const res = await app.inject({ method: 'GET', url: '/api/places/p1/reviews' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      reviews: [expect.objectContaining({ id: 'r1' }), expect.objectContaining({ id: 'r2' })],
      nextCursor: null,
    })

    const arg = prisma.review.findMany.mock.calls[0][0] as Record<string, unknown>
    expect(arg.where).toEqual({ placeId: 'p1', ...WRITTEN })
    expect(arg.orderBy).toEqual(ORDER)
    expect(arg.take).toBe(21) // one extra row says whether another page exists
    expect(arg).not.toHaveProperty('cursor')
    expect(arg.select).not.toHaveProperty('userId')
  })

  it('pages on from a cursor, and hands out the next one when more rows exist', async () => {
    prisma.review.findFirst.mockResolvedValueOnce({ id: 'r2' })
    prisma.review.findMany.mockResolvedValueOnce([reviewRow('r3'), reviewRow('r4'), reviewRow('r5')])

    const res = await app.inject({ method: 'GET', url: '/api/places/p1/reviews?cursor=r2&take=2' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.reviews.map((r: { id: string }) => r.id)).toEqual(['r3', 'r4'])
    expect(body.nextCursor).toBe('r4')

    const arg = prisma.review.findMany.mock.calls[0][0] as Record<string, unknown>
    expect(arg.cursor).toEqual({ id: 'r2' })
    expect(arg.skip).toBe(1)
    expect(arg.take).toBe(3)
    // The cursor must be a written review of THIS place.
    const anchor = prisma.review.findFirst.mock.calls[0][0] as { where: unknown }
    expect(anchor.where).toEqual({ id: 'r2', placeId: 'p1', ...WRITTEN })
  })

  it('strips the author of anonymous reviews on every page', async () => {
    prisma.review.findMany.mockResolvedValueOnce([reviewRow('r1', { anonymous: true, user: { handle: 'secret' } })])
    const res = await app.inject({ method: 'GET', url: '/api/places/p1/reviews' })
    expect(res.json().reviews[0].user).toBeNull()
    expect(res.body).not.toContain('secret')
  })

  it.each(['0', '51', 'abc', '1.5', ''])('rejects take=%s with 400', async (take) => {
    const res = await app.inject({ method: 'GET', url: `/api/places/p1/reviews?take=${take}` })
    expect(res.statusCode).toBe(400)
    expect(prisma.review.findMany).not.toHaveBeenCalled()
  })

  it.each(['ABC', '..%2Fx', 'a'.repeat(41)])('rejects a malformed cursor (%s) with 400', async (cursor) => {
    const res = await app.inject({ method: 'GET', url: `/api/places/p1/reviews?cursor=${cursor}` })
    expect(res.statusCode).toBe(400)
    expect(prisma.review.findMany).not.toHaveBeenCalled()
  })

  it('rejects a cursor that is not a written review of this place with 400', async () => {
    prisma.review.findFirst.mockResolvedValueOnce(null)
    const res = await app.inject({ method: 'GET', url: '/api/places/p1/reviews?cursor=rother' })
    expect(res.statusCode).toBe(400)
    expect(prisma.review.findMany).not.toHaveBeenCalled()
  })

  it('is 404 for an unknown place, and for a PENDING place seen by a stranger', async () => {
    prisma.place.findUnique.mockResolvedValueOnce(null)
    expect((await app.inject({ method: 'GET', url: '/api/places/nope/reviews' })).statusCode).toBe(404)

    prisma.place.findUnique.mockResolvedValueOnce({ id: 'p1', status: 'PENDING', submittedById: 'u-submitter' })
    expect((await app.inject({ method: 'GET', url: '/api/places/p1/reviews' })).statusCode).toBe(404)

    prisma.place.findUnique.mockResolvedValueOnce({ id: 'p1', status: 'PENDING', submittedById: 'u-submitter' })
    const own = await app.inject({ method: 'GET', url: '/api/places/p1/reviews', cookies: await cookiesFor('u-submitter') })
    expect(own.statusCode).toBe(200)
  })
})

describe('GET /api/places/:id/my-review', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = makePrismaMock()
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/places/p1/my-review' })
    expect(res.statusCode).toBe(401)
    expect(prisma.review.findFirst).not.toHaveBeenCalled()
  })

  it("returns the caller's own written review, score and comment only", async () => {
    prisma.review.findFirst.mockResolvedValueOnce({ score: 4, comment: 'Lovely' })
    const res = await app.inject({ method: 'GET', url: '/api/places/p1/my-review', cookies: await cookiesFor('u1') })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ score: 4, comment: 'Lovely' })
    const arg = prisma.review.findFirst.mock.calls[0][0] as { where: unknown; select: unknown }
    expect(arg.where).toEqual({ placeId: 'p1', userId: 'u1', ...WRITTEN })
    expect(arg.select).toEqual({ score: true, comment: true })
  })

  it('returns JSON null when the caller has not written one', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/places/p1/my-review', cookies: await cookiesFor('u1') })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.json()).toBeNull()
  })
})

describe('global rate limit', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await buildApp({ prisma: asPrisma(makePrismaMock()), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  // trustProxy is on, so X-Forwarded-For stands in for the address nginx resolved.
  const from = (ip: string) => ({ 'x-forwarded-for': ip })

  it('counts a whole IPv6 /64 as one client', async () => {
    for (let i = 1; i <= 200; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/places', headers: from(`2001:db8:1:2::${i.toString(16)}`) })
      expect(res.statusCode).toBe(200)
    }
    // Another address in the same /64: same bucket, now exhausted.
    const sameNet = await app.inject({ method: 'GET', url: '/api/places', headers: from('2001:db8:1:2:ffff::1') })
    expect(sameNet.statusCode).toBe(429)
    // The neighbouring /64 is someone else.
    const otherNet = await app.inject({ method: 'GET', url: '/api/places', headers: from('2001:db8:1:3::1') })
    expect(otherNet.statusCode).toBe(200)
  })
})

// web/src/lib/api.ts reads a string `error` and a `message`: a zod flatten() sent
// as `error` would reach a caller as code 'Error', message 'HTTP 400'.
describe('invalid submissions answer in the house error shape', () => {
  /** The shared mock plus the creates of the two other submission routes. */
  function makeMock() {
    const mock = makePrismaMock()
    return {
      ...mock,
      list: { ...mock.list, create: vi.fn() },
      track: { create: vi.fn() },
    }
  }
  let app: FastifyInstance
  let prisma: ReturnType<typeof makeMock>

  beforeEach(async () => {
    prisma = makeMock()
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  it.each([
    ['/api/places', { lat: 'north', lng: 4.48 }, 'Invalid place'],
    ['/api/lists', { name: '' }, 'Invalid list'],
    ['/api/routes/track', { coords: [[4.48, 51.92]] }, 'Invalid track'],
  ])('POST %s', async (url, payload, message) => {
    const res = await app.inject({ method: 'POST', url, payload, cookies: await cookiesFor('u1') })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body).toMatchObject({ error: 'BadRequest', message })
    expect(body.details).toHaveProperty('fieldErrors')
    expect(prisma.place.create).not.toHaveBeenCalled()
    expect(prisma.list.create).not.toHaveBeenCalled()
    expect(prisma.track.create).not.toHaveBeenCalled()
  })
})
