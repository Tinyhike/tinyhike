import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { makePrismaMock, asPrisma, type PrismaMock } from './helpers.js'

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
})
