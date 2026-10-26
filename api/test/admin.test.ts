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

/** The four points of a visit, as the admin route takes them. */
const VISIT = { stepFree: true, strollerRoom: false, changingTable: false, toilets: true }

/** A café as the verification service selects it. */
function cafeRow(over: Record<string, unknown> = {}) {
  return {
    id: PLACE,
    osmId: 'osm:node/42',
    lat: 51.92,
    lng: 4.48,
    status: 'APPROVED',
    category: 'CAFE',
    access: 'OPEN',
    verifiedAt: null,
    wheelchairOk: null,
    isStrollerWide: null,
    hasChangingTable: null,
    hasToilets: null,
    translations: [{ locale: 'nl', name: 'Koffie & Co' }],
    ...over,
  }
}

function makeDb() {
  const base = makePrismaMock()
  return {
    ...base,
    photo: { ...base.photo, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    user: { ...base.user, count: vi.fn().mockResolvedValue(1) },
  }
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
    method: 'GET' | 'PATCH' | 'PUT' | 'DELETE' | 'POST',
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
    ['GET', '/api/admin/places', undefined],
    ['PUT', `/api/admin/places/${PLACE}/verification`, VISIT],
    ['DELETE', `/api/admin/places/${PLACE}/verification`, undefined],
    ['POST', '/api/admin/seed', { places: [] }],
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
      expect(db.place.findMany).not.toHaveBeenCalled()
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

    it('approving a proposal does not verify it: two separate actions', async () => {
      await patch({ status: 'APPROVED' })
      const arg = db.place.update.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data).not.toHaveProperty('verifiedAt')
      expect(arg.data).not.toHaveProperty('verifiedById')
    })

    it('a status alone needs no role lookup: it does not change what the public sees by itself', async () => {
      await patch({ status: 'REJECTED' })
      expect(db.user.findUnique).not.toHaveBeenCalled()
    })

    it('a category change checks the admin role in the database, like a verification', async () => {
      db.user.findUnique.mockResolvedValue({ role: 'MEMBER' })
      const res = await patch({ category: 'PARK' })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: 'NotAdmin' })
      expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: ADMIN }, select: { role: true } })
      expect(db.place.update).not.toHaveBeenCalled()
    })

    it('sets or clears the category, with or without a status', async () => {
      db.user.findUnique.mockResolvedValue({ role: 'ADMIN' })
      await patch({ status: 'APPROVED', category: 'PLAYGROUND' })
      expect(db.place.update).toHaveBeenLastCalledWith({
        where: { id: PLACE },
        data: { status: 'APPROVED', category: 'PLAYGROUND' },
      })
      await patch({ category: null })
      expect(db.place.update).toHaveBeenLastCalledWith({ where: { id: PLACE }, data: { category: null } })
    })

    it.each([[{ category: 'BAR' }], [{ status: 'APPROVED', verifiedAt: '2026-10-26' }]])(
      'rejects %j with 400',
      async (payload) => {
        const res = await patch(payload)
        expect(res.statusCode).toBe(400)
        expect(db.place.update).not.toHaveBeenCalled()
      },
    )

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

  describe('GET /api/admin/stats', () => {
    it('counts visible, hidden and verified places; hidden by subtraction', async () => {
      db.place.count
        .mockResolvedValueOnce(1318) // all
        .mockResolvedValueOnce(1027) // public
        .mockResolvedValueOnce(2) // verified
        .mockResolvedValueOnce(0) // pending
      const res = await request('GET', '/api/admin/stats')
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ places: 1318, visiblePlaces: 1027, hiddenPlaces: 291, verifiedPlaces: 2 })
      expect(db.place.count).toHaveBeenNthCalledWith(1)
      expect(db.place.count).toHaveBeenNthCalledWith(3, { where: { verifiedAt: { not: null } } })
      expect(db.place.count).toHaveBeenNthCalledWith(4, { where: { status: 'PENDING' } })
      expect(db.place.count).toHaveBeenNthCalledWith(2, {
        where: {
          status: 'APPROVED',
          OR: [{ category: { in: ['PLAYGROUND', 'PARK', 'PICNIC_SITE'] }, access: { in: ['OPEN', 'CUSTOMERS'] } }, { verifiedAt: { not: null } }],
        },
      })
    })
  })

  describe('GET /api/admin/places', () => {
    it('lists unverified cafés with their four points and whether they are public', async () => {
      db.place.findMany.mockResolvedValueOnce([cafeRow({ hasToilets: true })])
      db.place.count.mockResolvedValueOnce(274)
      const res = await request('GET', '/api/admin/places?category=CAFE&verified=false')

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        total: 274,
        places: [
          {
            id: PLACE,
            name: 'Koffie & Co',
            category: 'CAFE',
            access: 'OPEN',
            status: 'APPROVED',
            osmId: 'osm:node/42',
            lat: 51.92,
            lng: 4.48,
            verifiedAt: null,
            visible: false,
            points: { stepFree: null, strollerRoom: null, changingTable: null, toilets: true },
          },
        ],
      })
      const arg = db.place.findMany.mock.calls[0][0] as { where: unknown; take: number; select: Record<string, unknown> }
      expect(arg.where).toEqual({ category: 'CAFE', verifiedAt: null })
      expect(arg.take).toBe(100)
      expect(arg.select).not.toHaveProperty('verifiedById')
    })

    it('filters on OSM access', async () => {
      await request('GET', '/api/admin/places?category=PLAYGROUND&access=PRIVATE')
      expect((db.place.findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({ category: 'PLAYGROUND', access: 'PRIVATE' })
      expect((await request('GET', '/api/admin/places?access=MEMBERS')).statusCode).toBe(400)
    })

    it('filters on verified places, places with no category, and names', async () => {
      await request('GET', '/api/admin/places?category=NONE&verified=true&name=hopper')
      const arg = db.place.findMany.mock.calls[0][0] as { where: unknown }
      expect(arg.where).toEqual({
        category: null,
        verifiedAt: { not: null },
        translations: { some: { name: { contains: 'hopper', mode: 'insensitive' } } },
      })
    })

    it.each(['category=BAR', 'verified=maybe', 'take=0', 'take=501'])('rejects ?%s with 400', async (query) => {
      const res = await request('GET', `/api/admin/places?${query}`)
      expect(res.statusCode).toBe(400)
      expect(db.place.findMany).not.toHaveBeenCalled()
    })
  })

  describe('PUT /api/admin/places/:id/verification', () => {
    const put = (payload: Record<string, unknown>) =>
      request('PUT', `/api/admin/places/${PLACE}/verification`, { payload })

    beforeEach(() => {
      db.user.findUnique.mockResolvedValue({ role: 'ADMIN' })
    })

    it('writes the four points to their tags, stamps the date and the admin, and answers the summary', async () => {
      const now = new Date('2026-10-26T14:00:00Z')
      db.place.update.mockResolvedValueOnce(
        cafeRow({ verifiedAt: now, wheelchairOk: true, isStrollerWide: false, hasChangingTable: false, hasToilets: true }),
      )
      const res = await put(VISIT)

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        id: PLACE,
        visible: true,
        verifiedAt: now.toISOString(),
        points: { stepFree: true, strollerRoom: false, changingTable: false, toilets: true },
      })
      expect(res.body).not.toContain(ADMIN)

      const arg = db.place.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
      expect(arg.where).toEqual({ id: PLACE })
      expect(arg.data).toMatchObject({
        wheelchairOk: true,
        isStrollerWide: false,
        hasChangingTable: false,
        hasToilets: true,
        verifiedById: ADMIN,
      })
      expect(arg.data.verifiedAt).toBeInstanceOf(Date)
      expect(Object.keys(arg.data).sort()).toEqual(
        ['hasChangingTable', 'hasToilets', 'isStrollerWide', 'verifiedAt', 'verifiedById', 'wheelchairOk'],
      )
      expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: ADMIN }, select: { role: true } })
    })

    it('verifies a café answered no on all four points', async () => {
      db.place.update.mockResolvedValueOnce(cafeRow({ verifiedAt: new Date() }))
      const res = await put({ stepFree: false, strollerRoom: false, changingTable: false, toilets: false })
      expect(res.statusCode).toBe(200)
      const arg = db.place.update.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data).toMatchObject({ wheelchairOk: false, isStrollerWide: false, hasChangingTable: false, hasToilets: false })
      expect(arg.data.verifiedAt).toBeInstanceOf(Date)
    })

    it.each([
      ['a missing point', { stepFree: true, strollerRoom: true, changingTable: true }],
      ['a point that is not yes or no', { ...VISIT, toilets: 'yes' }],
      ['an unknown field', { ...VISIT, verifiedById: MEMBER }],
      ['an empty body', {}],
    ])('rejects %s with 400', async (_label, payload) => {
      const res = await put(payload)
      expect(res.statusCode).toBe(400)
      expect(db.place.update).not.toHaveBeenCalled()
    })

    it('answers 403 when the account is no longer an admin, whatever its session says', async () => {
      db.user.findUnique.mockResolvedValue({ role: 'MEMBER' })
      const res = await put(VISIT)
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: 'NotAdmin' })
      expect(db.place.update).not.toHaveBeenCalled()
    })

    it('answers 404 for an unknown or malformed id', async () => {
      db.place.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Record to update not found', { code: 'P2025', clientVersion: 'test' }),
      )
      expect((await put(VISIT)).statusCode).toBe(404)
      const bad = await request('PUT', '/api/admin/places/nope/verification', { payload: VISIT })
      expect(bad.statusCode).toBe(404)
    })
  })

  describe('DELETE /api/admin/places/:id/verification', () => {
    beforeEach(() => {
      db.user.findUnique.mockResolvedValue({ role: 'ADMIN' })
    })

    it('answers 403 when the account is no longer an admin, whatever its session says', async () => {
      db.user.findUnique.mockResolvedValue({ role: 'MEMBER' })
      const res = await request('DELETE', `/api/admin/places/${PLACE}/verification`)
      expect(res.statusCode).toBe(403)
      expect(db.place.update).not.toHaveBeenCalled()
    })

    it('clears the date and the admin, keeps the four points, and hides a café again', async () => {
      db.place.update.mockResolvedValueOnce(cafeRow({ wheelchairOk: true }))
      const res = await request('DELETE', `/api/admin/places/${PLACE}/verification`)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ visible: false, verifiedAt: null, points: { stepFree: true } })
      expect(db.place.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: PLACE }, data: { verifiedAt: null, verifiedById: null } }),
      )
    })

    it('answers 404 for an unknown place', async () => {
      db.place.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Record to update not found', { code: 'P2025', clientVersion: 'test' }),
      )
      expect((await request('DELETE', `/api/admin/places/${PLACE}/verification`)).statusCode).toBe(404)
    })
  })

  describe('POST /api/admin/seed', () => {
    const seed = (payload: Record<string, unknown>) => request('POST', '/api/admin/seed', { payload })

    it('stores the category it is given, so an approved playground can be public', async () => {
      const res = await seed({ places: [{ osmId: 'osm:way/1', lat: 51.9, lng: 4.48, name: 'Speeltuin', category: 'PLAYGROUND' }] })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ created: 1 })
      const arg = db.place.create.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data).toMatchObject({ osmId: 'osm:way/1', status: 'PENDING', source: 'OSM', category: 'PLAYGROUND' })
      expect(arg.data).not.toHaveProperty('verifiedAt')
    })

    it.each([
      ['no places array', {}],
      ['a bad osmId', { places: [{ osmId: '../x', lat: 51.9, lng: 4.48, name: 'X' }] }],
      ['an unknown category', { places: [{ osmId: 'osm:node/1', lat: 51.9, lng: 4.48, name: 'X', category: 'BAR' }] }],
      ['an out-of-range latitude', { places: [{ osmId: 'osm:node/1', lat: 91, lng: 4.48, name: 'X' }] }],
    ])('rejects %s with 400', async (_label, payload) => {
      const res = await seed(payload)
      expect(res.statusCode).toBe(400)
      expect(db.place.create).not.toHaveBeenCalled()
    })
  })
})
