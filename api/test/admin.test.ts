import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import sharp from 'sharp'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-for-admin-routes-0123456789abcdef'
})

// R2 mocked; the moderation service and sharp are real, so these tests exercise
// the full admin path short of the network.
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
import { makePrismaMock, asPrisma } from './helpers.js'

const ADMIN = 'cadmin0000000000000000001'
const MEMBER = 'cmember000000000000000001'
const PHOTO = 'cphoto0000000000000000001'
const PLACE = 'cplace0000000000000000001'
const STAGED = `confirmed/${MEMBER}/3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b.jpg`

function makeDb() {
  const base = makePrismaMock()
  return { ...base, photo: { ...base.photo, updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
}

async function as(userId: string, role: string) {
  return { [SESSION_COOKIE]: await signSession({ sub: userId, role }) }
}

describe('admin routes', () => {
  let app: FastifyInstance
  let db: ReturnType<typeof makeDb>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(r2.stagingBucket).mockReturnValue('tinyhike-photos-staging')
    vi.mocked(r2.publicBucket).mockReturnValue('tinyhike-photos')
    vi.mocked(r2.publicUrl).mockImplementation((key: string) => `https://photos.example.test/${key}`)
    vi.mocked(r2.presignGet).mockResolvedValue('https://staging.example.test/signed-get')
    vi.mocked(r2.putObject).mockResolvedValue(undefined)
    vi.mocked(r2.deleteObject).mockResolvedValue(undefined)

    db = makeDb()
    app = await buildApp({ prisma: asPrisma(db), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  const request = async (
    method: 'GET' | 'PATCH',
    url: string,
    opts: { role?: 'ADMIN' | 'MEMBER' | null; payload?: Record<string, unknown> } = {},
  ) => {
    const role = opts.role === undefined ? 'ADMIN' : opts.role
    return app.inject({
      method,
      url,
      payload: opts.payload,
      cookies: role ? await as(role === 'ADMIN' ? ADMIN : MEMBER, role) : {},
    })
  }

  describe.each([
    ['GET', '/api/admin/photos', undefined],
    ['PATCH', `/api/admin/photos/${PHOTO}`, { status: 'APPROVED' }],
    ['PATCH', `/api/admin/places/${PLACE}`, { status: 'APPROVED' }],
  ] as const)('%s %s', (method, url, payload) => {
    it('answers 401 without a session', async () => {
      const res = await request(method, url, { role: null, payload })
      expect(res.statusCode).toBe(401)
      expect(res.json()).toMatchObject({ error: 'Unauthorized' })
    })

    it('answers 403 to a signed-in non-admin', async () => {
      const res = await request(method, url, { role: 'MEMBER', payload })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: 'Forbidden' })
      expect(db.photo.findMany).not.toHaveBeenCalled()
      expect(db.photo.findUnique).not.toHaveBeenCalled()
      expect(db.place.update).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/admin/photos', () => {
    it('lists the PENDING queue by default, 50 at a time', async () => {
      db.photo.findMany.mockResolvedValue([
        {
          id: PHOTO,
          status: 'PENDING',
          createdAt: new Date('2026-10-20T10:00:00Z'),
          placeId: PLACE,
          routeId: null,
          r2Key: STAGED,
          r2Url: null,
          moderationNote: null,
          uploadedBy: { id: MEMBER, handle: 'marieke' },
          place: { translations: [{ locale: 'nl', name: 'Speeltuin Het Park' }] },
        },
      ])

      const res = await request('GET', '/api/admin/photos')
      expect(res.statusCode).toBe(200)
      expect(db.photo.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING' }, take: 50 }))
      expect(res.json()).toEqual({
        photos: [
          {
            id: PHOTO,
            status: 'PENDING',
            createdAt: '2026-10-20T10:00:00.000Z',
            placeId: PLACE,
            placeName: 'Speeltuin Het Park',
            routeId: null,
            uploader: { id: MEMBER, handle: 'marieke' },
            viewUrl: 'https://staging.example.test/signed-get',
            moderationNote: null,
          },
        ],
      })
    })

    it('filters by status and take', async () => {
      const res = await request('GET', '/api/admin/photos?status=REJECTED&take=100')
      expect(res.statusCode).toBe(200)
      expect(db.photo.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'REJECTED' }, take: 100 }))
    })

    it.each(['status=pending', 'status=DELETED', 'take=0', 'take=101', 'take=abc', 'take=1.5'])(
      'rejects ?%s with 400',
      async (qs) => {
        const res = await request('GET', `/api/admin/photos?${qs}`)
        expect(res.statusCode).toBe(400)
        expect(res.json()).toMatchObject({ error: 'BadRequest' })
        expect(db.photo.findMany).not.toHaveBeenCalled()
      },
    )
  })

  describe('PATCH /api/admin/photos/:id', () => {
    const patch = (payload: Record<string, unknown>, id = PHOTO) =>
      request('PATCH', `/api/admin/photos/${id}`, { payload })

    beforeEach(() => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
    })

    it('approves: re-encodes into the public bucket and returns the public URL', async () => {
      const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#FFD166' } })
        .jpeg()
        .withExif({ IFD0: { Copyright: 'probe' } })
        .toBuffer()
      vi.mocked(r2.getObjectBytes).mockResolvedValue({ status: 'ok', bytes: jpeg })

      const res = await patch({ status: 'APPROVED' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        id: PHOTO,
        status: 'APPROVED',
        r2Url: `https://photos.example.test/p/${PHOTO}.jpg`,
        purgeUrl: null,
      })
      expect(r2.putObject).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: 'tinyhike-photos', key: `p/${PHOTO}.jpg`, contentType: 'image/jpeg' }),
      )
    })

    it('rejects: deletes the staged bytes and stores the note', async () => {
      const res = await patch({ status: 'REJECTED', moderationNote: '  child’s face visible  ' })
      expect(res.statusCode).toBe(200)
      // Staged bytes were never public: nothing to purge.
      expect(res.json()).toEqual({ id: PHOTO, status: 'REJECTED', r2Url: null, purgeUrl: null })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: STAGED })
      expect(db.photo.updateMany).toHaveBeenCalledWith({
        where: { id: PHOTO, status: 'PENDING', r2Key: STAGED },
        data: { status: 'REJECTED', r2Url: null, moderationNote: 'child’s face visible' },
      })
    })

    it('a takedown names the URL the Cloudflare edge still serves', async () => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'APPROVED', r2Key: `p/${PHOTO}.jpg` })
      const res = await patch({ status: 'REJECTED', moderationNote: 'takedown request' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        id: PHOTO,
        status: 'REJECTED',
        r2Url: null,
        purgeUrl: `https://photos.example.test/p/${PHOTO}.jpg`,
      })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: `p/${PHOTO}.jpg` })
    })

    it('treats a blank note as no note', async () => {
      await patch({ status: 'REJECTED', moderationNote: '   ' })
      expect(db.photo.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ moderationNote: undefined }) }),
      )
    })

    it('answers 404 for an unknown photo', async () => {
      db.photo.findUnique.mockResolvedValue(null)
      const res = await patch({ status: 'APPROVED' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'NotFound' })
    })

    it('answers 409 NotPending when approving a photo that is not PENDING', async () => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'REJECTED', r2Key: STAGED })
      const res = await patch({ status: 'APPROVED' })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: 'NotPending' })
    })

    it('rejecting a photo approved meanwhile still takes its public object down', async () => {
      db.photo.findUnique
        .mockResolvedValueOnce({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
        .mockResolvedValueOnce({ id: PHOTO, status: 'APPROVED', r2Key: `p/${PHOTO}.jpg` })
      db.photo.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })

      const res = await patch({ status: 'REJECTED' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        id: PHOTO,
        status: 'REJECTED',
        r2Url: null,
        purgeUrl: `https://photos.example.test/p/${PHOTO}.jpg`,
      })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: `p/${PHOTO}.jpg` })
    })

    it('answers 409 Conflict when the row keeps changing under a reject', async () => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
      db.photo.updateMany.mockResolvedValue({ count: 0 })
      const res = await patch({ status: 'REJECTED' })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: 'Conflict' })
    })

    it('answers 422 InvalidImage when the bytes do not decode, publishing nothing', async () => {
      vi.mocked(r2.getObjectBytes).mockResolvedValue({ status: 'ok', bytes: Buffer.from('<html>gotcha</html>') })
      const res = await patch({ status: 'APPROVED' })
      expect(res.statusCode).toBe(422)
      expect(res.json()).toMatchObject({ error: 'InvalidImage' })
      expect(r2.putObject).not.toHaveBeenCalled()
      expect(db.photo.updateMany).not.toHaveBeenCalled()
    })

    it.each([
      ['an unknown status', { status: 'PENDING' }],
      ['no status', {}],
      ['a note over 500 characters', { status: 'REJECTED', moderationNote: 'x'.repeat(501) }],
      ['a non-string note', { status: 'REJECTED', moderationNote: 42 }],
    ])('rejects %s with 400', async (_label, payload) => {
      const res = await patch(payload)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: 'BadRequest' })
      expect(db.photo.findUnique).not.toHaveBeenCalled()
    })

    it('answers 404 for a malformed id, which cannot name a photo', async () => {
      const res = await patch({ status: 'APPROVED' }, 'not-a-cuid')
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'NotFound', message: 'Photo not found' })
      expect(db.photo.findUnique).not.toHaveBeenCalled()
    })

    it('answers 500, publishing nothing, when R2_PUBLIC_URL is unusable', async () => {
      vi.mocked(r2.publicUrl).mockImplementation(() => {
        throw new Error('R2_PUBLIC_URL is not set')
      })
      const res = await patch({ status: 'APPROVED' })
      expect(res.statusCode).toBe(500)
      expect(r2.getObjectBytes).not.toHaveBeenCalled()
      expect(r2.putObject).not.toHaveBeenCalled()
      expect(db.photo.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /api/admin/places/:id', () => {
    const patch = (payload: Record<string, unknown>) => request('PATCH', `/api/admin/places/${PLACE}`, { payload })

    it('updates the status', async () => {
      db.place.update.mockResolvedValue({ id: PLACE, status: 'APPROVED' })
      const res = await patch({ status: 'APPROVED' })
      expect(res.statusCode).toBe(200)
      expect(db.place.update).toHaveBeenCalledWith({ where: { id: PLACE }, data: { status: 'APPROVED' } })
    })

    it.each([[{ status: 'PENDING' }], [{}], [{ status: 1 }]])('rejects %j with 400', async (payload) => {
      const res = await patch(payload)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: 'BadRequest' })
      expect(db.place.update).not.toHaveBeenCalled()
    })

    it('answers 404 for a malformed id, which cannot name a place', async () => {
      const res = await request('PATCH', '/api/admin/places/not-a-cuid', { payload: { status: 'APPROVED' } })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'NotFound' })
      expect(db.place.update).not.toHaveBeenCalled()
    })

    it('answers 404 when the place does not exist', async () => {
      db.place.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record to update not found', { code: 'P2025', clientVersion: 'test' }),
      )
      const res = await patch({ status: 'REJECTED' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'NotFound' })
    })
  })
})
