import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'

// Sign test sessions with a known secret. Runs before any import, and dotenv never
// overrides a variable that is already set.
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-for-photo-routes-0123456789abcdef'
})

// R2 is replaced wholesale: these tests cover the contract around the upload, never
// the network. Constants and pure helpers stay real.
vi.mock('../src/lib/r2.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/r2.js')>()
  return {
    ...actual,
    stagingBucket: vi.fn(),
    uploadsEnabled: vi.fn(),
    publicBucket: vi.fn(),
    publicUrl: vi.fn(),
    presignPut: vi.fn(),
    presignGet: vi.fn(),
    headObject: vi.fn(),
    copyObject: vi.fn(),
    deleteObject: vi.fn(),
    getObjectBytes: vi.fn(),
    putObject: vi.fn(),
    listObjectKeys: vi.fn(),
  }
})

import { buildApp } from '../src/app.js'
import { signSession, SESSION_COOKIE } from '../src/plugins/auth.js'
import * as r2 from '../src/lib/r2.js'
import { makePrismaMock, asPrisma, type PrismaMock } from './helpers.js'

const USER_A = 'cuseraaaa000000000000001'
const USER_B = 'cuserbbbb000000000000002'
const PLACE = 'cplace0000000000000000001'
const ROUTE = 'croute0000000000000000001'
const UUID = '3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b'
const KEY_A = `uploads/${USER_A}/${UUID}.jpg`
const CONFIRMED_A = `confirmed/${USER_A}/${UUID}.jpg`
const SIGNED_PUT = 'https://tinyhike-photos-staging.acct.r2.cloudflarestorage.com/signed-put'

function setStaging(bucket: string | undefined) {
  vi.mocked(r2.stagingBucket).mockReturnValue(bucket)
  vi.mocked(r2.uploadsEnabled).mockReturnValue(bucket !== undefined)
}

async function as(userId: string, role = 'MEMBER') {
  return { [SESSION_COOKIE]: await signSession({ sub: userId, role }) }
}

describe('photo upload', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    vi.clearAllMocks()
    setStaging('tinyhike-photos-staging')
    vi.mocked(r2.presignPut).mockResolvedValue(SIGNED_PUT)
    vi.mocked(r2.copyObject).mockResolvedValue(true)
    vi.mocked(r2.headObject).mockResolvedValue({ contentType: 'image/jpeg', contentLength: 250_000 })
    vi.mocked(r2.deleteObject).mockResolvedValue(undefined)

    prisma = makePrismaMock()
    prisma.place.findUnique.mockResolvedValue({ status: 'APPROVED', submittedById: null })
    prisma.route.findUnique.mockResolvedValue({ status: 'APPROVED', authorId: null })
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  const presign = async (payload: Record<string, unknown>, userId: string | null = USER_A) =>
    app.inject({
      method: 'POST',
      url: '/api/photos/presign',
      payload,
      cookies: userId ? await as(userId) : {},
    })

  const confirm = async (payload: Record<string, unknown>, userId: string | null = USER_A, role = 'MEMBER') =>
    app.inject({
      method: 'POST',
      url: '/api/photos/confirm',
      payload,
      cookies: userId ? await as(userId, role) : {},
    })

  describe('GET /api/photos/config', () => {
    it('reports uploads enabled when a staging bucket is configured', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/photos/config' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ enabled: true })
    })

    it('reports uploads disabled without one, so the web hides the UI', async () => {
      setStaging(undefined)
      const res = await app.inject({ method: 'GET', url: '/api/photos/config' })
      expect(res.json()).toEqual({ enabled: false })
    })
  })

  describe('POST /api/photos/presign', () => {
    it('requires authentication', async () => {
      const res = await presign({ contentType: 'image/jpeg', size: 1000 }, null)
      expect(res.statusCode).toBe(401)
      expect(r2.presignPut).not.toHaveBeenCalled()
    })

    it('mints a staging URL pinned to the declared type and size', async () => {
      const res = await presign({ contentType: 'image/jpeg', size: 123_456, placeId: PLACE })
      expect(res.statusCode).toBe(200)

      const body = res.json() as { uploadUrl: string; key: string; expiresIn: number }
      expect(body.uploadUrl).toBe(SIGNED_PUT)
      expect(body.expiresIn).toBe(120)
      expect(body.key).toMatch(
        new RegExp(`^uploads/${USER_A}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.jpg$`),
      )
      expect(r2.presignPut).toHaveBeenCalledWith({
        bucket: 'tinyhike-photos-staging',
        key: body.key,
        contentType: 'image/jpeg',
        size: 123_456,
        expiresIn: 120,
      })
    })

    it('derives the key extension from the declared type', async () => {
      const res = await presign({ contentType: 'image/webp', size: 1000 })
      expect((res.json() as { key: string }).key).toMatch(/\.webp$/)
    })

    it('never writes a Photo row while only presigning', async () => {
      await presign({ contentType: 'image/jpeg', size: 1000 })
      // An abandoned upload must not leave a row that looks like a queued photo.
      expect(prisma.photo.create).not.toHaveBeenCalled()
    })

    it.each([
      ['an SVG', { contentType: 'image/svg+xml', size: 1000 }],
      ['HTML', { contentType: 'text/html', size: 1000 }],
      ['a prototype key as type', { contentType: 'toString', size: 1000 }],
      ['no size', { contentType: 'image/jpeg' }],
      ['an empty file', { contentType: 'image/jpeg', size: 0 }],
      ['a fractional size', { contentType: 'image/jpeg', size: 10.5 }],
      ['more than 10 MiB', { contentType: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }],
      ['a malformed placeId', { contentType: 'image/jpeg', size: 1000, placeId: 'not a cuid' }],
    ])('rejects %s with 400', async (_label, payload) => {
      const res = await presign(payload)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: 'BadRequest' })
      expect(r2.presignPut).not.toHaveBeenCalled()
    })

    it('accepts exactly 10 MiB', async () => {
      const res = await presign({ contentType: 'image/png', size: 10 * 1024 * 1024 })
      expect(res.statusCode).toBe(200)
    })

    it('fails closed with 503 when no staging bucket is configured', async () => {
      setStaging(undefined)
      const res = await presign({ contentType: 'image/jpeg', size: 1000 })
      expect(res.statusCode).toBe(503)
      expect(res.json()).toMatchObject({ error: 'UploadsDisabled' })
      expect(r2.presignPut).not.toHaveBeenCalled()
    })

    it('refuses a 21st pending photo with 429 TooManyPending', async () => {
      prisma.photo.count.mockResolvedValue(20)
      const res = await presign({ contentType: 'image/jpeg', size: 1000 })
      expect(res.statusCode).toBe(429)
      expect(res.json()).toMatchObject({ error: 'TooManyPending' })
      expect(prisma.photo.count).toHaveBeenCalledWith({ where: { uploadedById: USER_A, status: 'PENDING' } })
      expect(r2.presignPut).not.toHaveBeenCalled()
    })

    it('limits each account to 20 presigns per 10 minutes, separately from others on the same IP', async () => {
      for (let i = 0; i < 20; i++) {
        expect((await presign({ contentType: 'image/jpeg', size: 1000 })).statusCode).toBe(200)
      }
      const blocked = await presign({ contentType: 'image/jpeg', size: 1000 })
      expect(blocked.statusCode).toBe(429)
      expect(blocked.json()).not.toMatchObject({ error: 'TooManyPending' })

      // Same IP (inject always uses 127.0.0.1), different parent: own bucket.
      expect((await presign({ contentType: 'image/jpeg', size: 1000 }, USER_B)).statusCode).toBe(200)
    })
  })

  describe('POST /api/photos/confirm', () => {
    it('requires authentication', async () => {
      const res = await confirm({ key: KEY_A, placeId: PLACE }, null)
      expect(res.statusCode).toBe(401)
    })

    it('copies the upload to a server-owned key, validates the copy, and queues it', async () => {
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(201)

      expect(r2.copyObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', from: KEY_A, to: CONFIRMED_A })
      // The COPY is what gets checked: the upload key stays client-writable until the URL expires.
      expect(r2.headObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: CONFIRMED_A })
      expect(prisma.photo.create).toHaveBeenCalledWith({
        data: {
          r2Key: CONFIRMED_A,
          r2Url: null,
          status: 'PENDING',
          placeId: PLACE,
          routeId: undefined,
          uploadedById: USER_A,
        },
        select: { id: true, status: true },
      })
      expect(r2.deleteObject).toHaveBeenCalledTimes(1)
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: KEY_A })
      // The upload is only dropped once a row references the copy.
      expect(prisma.photo.create.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(r2.deleteObject).mock.invocationCallOrder[0],
      )
    })

    it('never hands the uploader a key or URL', async () => {
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.json()).toEqual({ id: 'ph1', status: 'PENDING' })
      expect(res.body).not.toMatch(/https?:|uploads\/|confirmed\/|r2/i)
    })

    it('accepts a route instead of a place', async () => {
      const res = await confirm({ key: KEY_A, routeId: ROUTE })
      expect(res.statusCode).toBe(201)
    })

    it('fails closed with 503 when no staging bucket is configured', async () => {
      setStaging(undefined)
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(503)
      expect(res.json()).toMatchObject({ error: 'UploadsDisabled' })
      expect(r2.copyObject).not.toHaveBeenCalled()
    })

    it('rejects a malformed body with 400', async () => {
      const res = await confirm({ key: 42, placeId: PLACE })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: 'BadRequest' })
    })

    it.each([
      ['another user’s key', `uploads/${USER_B}/${UUID}.jpg`],
      ['a path-traversal key', `uploads/${USER_A}/../${USER_B}/${UUID}.jpg`],
      ['a key that is not a minted uuid', `uploads/${USER_A}/photo.jpg`],
      ['an already-confirmed key', CONFIRMED_A],
      ['a public key', 'p/cphoto0000000000000000001.jpg'],
      ['a disallowed extension', `uploads/${USER_A}/${UUID}.html`],
    ])('refuses %s with 403', async (_label, key) => {
      const res = await confirm({ key, placeId: PLACE })
      expect(res.statusCode).toBe(403)
      expect(r2.copyObject).not.toHaveBeenCalled()
      expect(prisma.photo.create).not.toHaveBeenCalled()
    })

    it('requires a place or a route', async () => {
      const res = await confirm({ key: KEY_A })
      expect(res.statusCode).toBe(400)
      expect(r2.copyObject).not.toHaveBeenCalled()
    })

    it('answers 404 for an unknown place', async () => {
      prisma.place.findUnique.mockResolvedValue(null)
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(404)
      expect(r2.copyObject).not.toHaveBeenCalled()
    })

    it('answers 404 for an unknown route', async () => {
      prisma.route.findUnique.mockResolvedValue(null)
      const res = await confirm({ key: KEY_A, routeId: ROUTE })
      expect(res.statusCode).toBe(404)
    })

    it.each(['PENDING', 'REJECTED'])(
      'answers 404 for another parent’s %s place, as every other endpoint does',
      async (status) => {
        prisma.place.findUnique.mockResolvedValue({ status, submittedById: USER_B })
        const res = await confirm({ key: KEY_A, placeId: PLACE })
        expect(res.statusCode).toBe(404)
        expect(res.json()).toEqual({ error: 'NotFound', message: 'Place not found' })
        expect(prisma.place.findUnique).toHaveBeenCalledWith({
          where: { id: PLACE },
          select: { status: true, submittedById: true },
        })
        expect(r2.copyObject).not.toHaveBeenCalled()
      },
    )

    it('lets a parent add a photo to the place they submitted, before approval', async () => {
      prisma.place.findUnique.mockResolvedValue({ status: 'PENDING', submittedById: USER_A })
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(201)
    })

    it('lets an admin add a photo to any pending place', async () => {
      prisma.place.findUnique.mockResolvedValue({ status: 'PENDING', submittedById: USER_B })
      const res = await confirm({ key: KEY_A, placeId: PLACE }, USER_A, 'ADMIN')
      expect(res.statusCode).toBe(201)
    })

    it('answers 404 for another parent’s unapproved route', async () => {
      prisma.route.findUnique.mockResolvedValue({ status: 'PENDING', authorId: USER_B })
      const res = await confirm({ key: KEY_A, routeId: ROUTE })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'NotFound', message: 'Route not found' })
      expect(r2.copyObject).not.toHaveBeenCalled()
    })

    it('answers 409 NotUploaded when nothing was PUT', async () => {
      vi.mocked(r2.copyObject).mockResolvedValue(false)
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: 'NotUploaded' })
      expect(prisma.photo.create).not.toHaveBeenCalled()
    })

    it('answers 409 NotUploaded when the copy vanished', async () => {
      vi.mocked(r2.headObject).mockResolvedValue(null)
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(409)
    })

    it('rejects a copy with no Content-Type and deletes both objects', async () => {
      vi.mocked(r2.headObject).mockResolvedValue({ contentLength: 1000 })
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(400)
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: CONFIRMED_A })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: KEY_A })
      expect(prisma.photo.create).not.toHaveBeenCalled()
    })

    it.each([
      ['an HTML body', { contentType: 'text/html', contentLength: 1000 }],
      ['a type that does not match the key', { contentType: 'image/png', contentLength: 1000 }],
      ['an empty object', { contentType: 'image/jpeg', contentLength: 0 }],
      ['an unknown size', { contentType: 'image/jpeg' }],
    ])('rejects %s with 400 and deletes both objects', async (_label, head) => {
      vi.mocked(r2.headObject).mockResolvedValue(head)
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(400)
      expect(r2.deleteObject).toHaveBeenCalledTimes(2)
      expect(prisma.photo.create).not.toHaveBeenCalled()
    })

    it('still answers 400 when cleaning up an invalid object fails', async () => {
      vi.mocked(r2.headObject).mockResolvedValue({ contentType: 'text/html', contentLength: 1000 })
      vi.mocked(r2.deleteObject).mockRejectedValueOnce(new Error('R2 hiccup')).mockResolvedValueOnce(undefined)
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      // Not a 500: the web would keep the key and retry a confirm that can never pass.
      expect(res.statusCode).toBe(400)
      expect(r2.deleteObject).toHaveBeenCalledTimes(2)
    })

    it('drops the confirmed copy, but keeps the upload, when the HEAD fails', async () => {
      vi.mocked(r2.headObject).mockRejectedValue(new Error('R2 unavailable'))
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(500)
      // confirmed/ never expires: an unreferenced copy would stay forever.
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: CONFIRMED_A })
      expect(r2.deleteObject).not.toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: KEY_A })
      expect(prisma.photo.create).not.toHaveBeenCalled()
    })

    it('still answers 500 when that cleanup fails too', async () => {
      vi.mocked(r2.headObject).mockRejectedValue(new Error('R2 unavailable'))
      vi.mocked(r2.deleteObject).mockRejectedValue(new Error('R2 unavailable'))
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(500)
    })

    it('accepts a Content-Type with parameters', async () => {
      vi.mocked(r2.headObject).mockResolvedValue({ contentType: 'image/jpeg; charset=binary', contentLength: 1000 })
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(201)
    })

    it('rejects an object over 10 MB with 413 and deletes both objects', async () => {
      vi.mocked(r2.headObject).mockResolvedValue({ contentType: 'image/jpeg', contentLength: 10 * 1024 * 1024 + 1 })
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(413)
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: CONFIRMED_A })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: KEY_A })
      expect(prisma.photo.create).not.toHaveBeenCalled()
    })

    it('is idempotent: a repeated confirm returns the existing photo with 200', async () => {
      prisma.photo.findFirst.mockResolvedValue({ id: 'ph9', status: 'PENDING' })
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ id: 'ph9', status: 'PENDING' })
      expect(prisma.photo.findFirst).toHaveBeenCalledWith({
        where: { r2Key: CONFIRMED_A, uploadedById: USER_A },
        select: { id: true, status: true },
      })
      expect(r2.copyObject).not.toHaveBeenCalled()
      expect(prisma.photo.create).not.toHaveBeenCalled()
    })

    it('answers 409 NotPending when a repeated confirm finds the photo already rejected', async () => {
      // A REJECTED row keeps its confirmed/ key, so a late retry matches it.
      prisma.photo.findFirst.mockResolvedValue({ id: 'ph9', status: 'REJECTED' })
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: 'NotPending' })
      expect(r2.copyObject).not.toHaveBeenCalled()
    })

    it('keeps the copy when the lookup after a P2002 fails: the winning row references it', async () => {
      prisma.photo.findFirst.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('database unavailable'))
      prisma.photo.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      )
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(500)
      expect(r2.deleteObject).not.toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: CONFIRMED_A })
    })

    it('resolves a concurrent confirm (P2002) to the winning row, keeping its copy', async () => {
      prisma.photo.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'ph9', status: 'PENDING' })
      prisma.photo.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      )
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ id: 'ph9', status: 'PENDING' })
      expect(r2.deleteObject).not.toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: CONFIRMED_A })
    })

    it('drops the unreferenced copy but keeps the upload when the row cannot be written', async () => {
      prisma.photo.create.mockRejectedValue(new Error('database unavailable'))
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(500)
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: CONFIRMED_A })
      expect(r2.deleteObject).not.toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: KEY_A })
    })

    it('still succeeds when the upload source cannot be deleted', async () => {
      vi.mocked(r2.deleteObject).mockRejectedValue(new Error('R2 hiccup'))
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(201)
    })

    it('refuses with 429 TooManyPending once 20 photos await review', async () => {
      prisma.photo.count.mockResolvedValue(20)
      const res = await confirm({ key: KEY_A, placeId: PLACE })
      expect(res.statusCode).toBe(429)
      expect(res.json()).toMatchObject({ error: 'TooManyPending' })
      expect(r2.copyObject).not.toHaveBeenCalled()
    })

    it('limits each account to 30 confirms per 10 minutes', async () => {
      for (let i = 0; i < 30; i++) {
        expect((await confirm({ key: KEY_A, placeId: PLACE })).statusCode).toBe(201)
      }
      expect((await confirm({ key: KEY_A, placeId: PLACE })).statusCode).toBe(429)
      expect((await confirm({ key: `uploads/${USER_B}/${UUID}.jpg`, placeId: PLACE }, USER_B)).statusCode).toBe(201)
    })
  })
})
