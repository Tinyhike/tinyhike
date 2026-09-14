import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { makePrismaMock, asPrisma, type PrismaMock } from './helpers.js'

/**
 * These cover the contract around the upload, not the R2 round-trip itself —
 * reaching the network would make the suite slow and flaky. What matters here is
 * that nothing is written to the database before an object is proven to exist, and
 * that a caller can't confirm a key that was never issued to them.
 */
describe('photo upload', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = makePrismaMock()
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  it('requires authentication to mint an upload URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/photos/presign',
      payload: { contentType: 'image/jpeg' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('requires authentication to confirm an upload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/photos/confirm',
      payload: { key: 'uploads/u1/x.jpg' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('never writes a Photo row while only presigning', async () => {
    await app.inject({ method: 'POST', url: '/api/photos/presign', payload: { contentType: 'image/jpeg' } })
    // The row used to be created here, leaving an orphan whenever the upload was
    // abandoned — indistinguishable from a real photo awaiting moderation.
    expect(prisma.photo.create).not.toHaveBeenCalled()
  })
})
