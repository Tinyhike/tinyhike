import { describe, it, expect, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { makePrismaMock, asPrisma } from './helpers.js'

describe('POST /api/auth/magic — rate limiting (Phase 0)', () => {
  let app: FastifyInstance
  afterEach(async () => {
    await app.close()
  })

  it('allows 5 requests then returns 429 on the 6th (5 / 5min per IP)', async () => {
    app = await buildApp({ prisma: asPrisma(makePrismaMock()), logger: false })

    const codes: number[] = []
    for (let i = 0; i < 6; i++) {
      // Invalid email → the handler returns 400, but the rate limiter runs first
      // as an onRequest hook, so the 6th request is blocked at 429 regardless.
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/magic',
        payload: { email: 'not-an-email' },
      })
      codes.push(res.statusCode)
    }

    expect(codes.slice(0, 5)).toEqual([400, 400, 400, 400, 400])
    expect(codes[5]).toBe(429)
  })

  it('the 429 body is shaped by the global error handler ({ error, message })', async () => {
    app = await buildApp({ prisma: asPrisma(makePrismaMock()), logger: false })

    let last = await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'x' } })
    for (let i = 0; i < 6; i++) {
      last = await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'x' } })
    }
    expect(last.statusCode).toBe(429)
    const body = last.json() as { error?: string; message?: string }
    expect(body.message).toBeTruthy()
    // never a raw stack trace
    expect(JSON.stringify(body)).not.toMatch(/at .*\(.*:\d+:\d+\)/)
  })
})
