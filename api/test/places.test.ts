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
})
