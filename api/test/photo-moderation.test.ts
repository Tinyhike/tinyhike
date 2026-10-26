import { describe, it, expect, beforeEach, vi } from 'vitest'
import sharp from 'sharp'

// R2 is mocked; sharp is REAL: the point of approval is what the re-encode does to
// the bytes, so it has to run on actual images.
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

import * as r2 from '../src/lib/r2.js'
import {
  approvePhoto,
  rejectPhoto,
  listPhotos,
  purgeLegacyUploads,
  PhotoModerationError,
} from '../src/services/photo-moderation.js'
import { makePrismaMock, asPrisma } from './helpers.js'

const PHOTO = 'cphoto0000000000000000001'
const STAGED = `confirmed/cuseraaaa000000000000001/3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b.jpg`
const PUBLIC_KEY = `p/${PHOTO}.jpg`
const PUBLIC_URL = `https://photos.example.test/${PUBLIC_KEY}`
/** A row confirmed before staging existed: its raw upload sits in the PUBLIC bucket. */
const LEGACY = `uploads/cuseraaaa000000000000001/3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b.jpg`
const LEGACY_URL = `https://photos.example.test/${LEGACY}`

/** The helpers mock plus the one call the service adds: a conditional status flip. */
function makeDb() {
  const base = makePrismaMock()
  return { ...base, photo: { ...base.photo, updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
}

type Db = ReturnType<typeof makeDb>

function jpegWithExif() {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: '#EF476F' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'probe' } })
    .toBuffer()
}

/** Whatever reached the public bucket. */
function publishedBytes(): Buffer {
  const call = vi.mocked(r2.putObject).mock.calls[0]
  if (!call) throw new Error('nothing was published')
  return call[0].body
}

describe('photo moderation service', () => {
  let db: Db
  const log = { warn: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(r2.stagingBucket).mockReturnValue('tinyhike-photos-staging')
    vi.mocked(r2.publicBucket).mockReturnValue('tinyhike-photos')
    vi.mocked(r2.publicUrl).mockImplementation((key: string) => `https://photos.example.test/${key}`)
    vi.mocked(r2.presignGet).mockResolvedValue('https://staging.example.test/signed-get')
    vi.mocked(r2.putObject).mockResolvedValue(undefined)
    vi.mocked(r2.deleteObject).mockResolvedValue(undefined)

    db = makeDb()
    db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
  })

  const approve = (note?: string) => approvePhoto(asPrisma(db), PHOTO, { moderationNote: note, log })
  const reject = (note?: string) => rejectPhoto(asPrisma(db), PHOTO, { moderationNote: note, log })

  describe('approvePhoto', () => {
    beforeEach(async () => {
      vi.mocked(r2.getObjectBytes).mockResolvedValue({ status: 'ok', bytes: await jpegWithExif() })
    })

    it('publishes a re-encoded JPEG with no EXIF', async () => {
      const source = await jpegWithExif()
      expect((await sharp(source).metadata()).exif).toBeDefined() // the probe is really there

      const result = await approve()
      expect(result).toEqual({ id: PHOTO, status: 'APPROVED', r2Url: PUBLIC_URL, purgeUrl: null })

      expect(r2.getObjectBytes).toHaveBeenCalledWith({
        bucket: 'tinyhike-photos-staging',
        key: STAGED,
        maxBytes: r2.MAX_UPLOAD_BYTES,
      })
      expect(r2.putObject).toHaveBeenCalledWith({
        bucket: 'tinyhike-photos',
        key: PUBLIC_KEY,
        body: expect.any(Buffer),
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      })

      const published = publishedBytes()
      expect(published.equals(source)).toBe(false)
      const meta = await sharp(published).metadata()
      expect(meta.format).toBe('jpeg')
      expect(meta.exif).toBeUndefined()
      expect(meta.xmp).toBeUndefined()
      expect(meta.width).toBe(64)
      expect(meta.height).toBe(48)
    })

    it('bakes the EXIF orientation into the pixels before dropping it', async () => {
      const portrait = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#06D6A0' } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer()
      vi.mocked(r2.getObjectBytes).mockResolvedValue({ status: 'ok', bytes: portrait })

      await approve()
      const meta = await sharp(publishedBytes()).metadata()
      expect([meta.width, meta.height]).toEqual([48, 64])
      expect(meta.orientation).toBeUndefined()
    })

    it('fits large images inside 2048x2048 and re-encodes PNG to JPEG', async () => {
      const wide = await sharp({ create: { width: 3000, height: 1000, channels: 4, background: '#118AB2' } })
        .png()
        .toBuffer()
      vi.mocked(r2.getObjectBytes).mockResolvedValue({ status: 'ok', bytes: wide })

      await approve()
      const meta = await sharp(publishedBytes()).metadata()
      expect(meta.format).toBe('jpeg')
      expect([meta.width, meta.height]).toEqual([2048, 683])
    })

    it('publishes, then flips the row, then drops the staged copy', async () => {
      await approve('ok')
      expect(db.photo.updateMany).toHaveBeenCalledWith({
        where: { id: PHOTO, status: 'PENDING' },
        data: { status: 'APPROVED', r2Key: PUBLIC_KEY, r2Url: PUBLIC_URL, moderationNote: 'ok' },
      })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: STAGED })

      const put = vi.mocked(r2.putObject).mock.invocationCallOrder[0]
      const update = db.photo.updateMany.mock.invocationCallOrder[0]
      const del = vi.mocked(r2.deleteObject).mock.invocationCallOrder[0]
      expect(put).toBeLessThan(update)
      expect(update).toBeLessThan(del)
    })

    it('logs and swallows a failed staging delete', async () => {
      vi.mocked(r2.deleteObject).mockRejectedValue(new Error('R2 hiccup'))
      await expect(approve()).resolves.toMatchObject({ status: 'APPROVED' })
      expect(log.warn).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['plain text', Buffer.from('definitely not an image')],
      ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')],
      ['a truncated JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])],
    ])('refuses %s as InvalidImage, publishing and changing nothing', async (_label, bytes) => {
      vi.mocked(r2.getObjectBytes).mockResolvedValue({ status: 'ok', bytes })

      const err = await approve().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PhotoModerationError)
      expect(err).toMatchObject({ code: 'InvalidImage', statusCode: 422 })
      expect(r2.putObject).not.toHaveBeenCalled()
      expect(db.photo.updateMany).not.toHaveBeenCalled()
      expect(db.photo.update).not.toHaveBeenCalled()
      expect(r2.deleteObject).not.toHaveBeenCalled()
    })

    it('refuses an oversized staged object as InvalidImage', async () => {
      vi.mocked(r2.getObjectBytes).mockResolvedValue({ status: 'too_large' })
      await expect(approve()).rejects.toMatchObject({ code: 'InvalidImage', statusCode: 422 })
      expect(r2.putObject).not.toHaveBeenCalled()
    })

    it('reports a staged object that no longer exists while the row is still PENDING', async () => {
      vi.mocked(r2.getObjectBytes).mockResolvedValue({ status: 'missing' })
      await expect(approve()).rejects.toMatchObject({ code: 'ObjectMissing', statusCode: 409 })
      expect(db.photo.findUnique).toHaveBeenCalledTimes(2) // re-checked before advising a reject
      expect(r2.putObject).not.toHaveBeenCalled()
    })

    it('treats a vanished source as success when a concurrent approval took it', async () => {
      // The winner published and deleted the staged copy between our read and our download.
      vi.mocked(r2.getObjectBytes).mockResolvedValue({ status: 'missing' })
      db.photo.findUnique
        .mockResolvedValueOnce({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
        .mockResolvedValueOnce({ status: 'APPROVED', r2Url: PUBLIC_URL })

      await expect(approve()).resolves.toEqual({ id: PHOTO, status: 'APPROVED', r2Url: PUBLIC_URL, purgeUrl: null })
      expect(r2.putObject).not.toHaveBeenCalled()
      expect(r2.deleteObject).not.toHaveBeenCalled()
      expect(db.photo.updateMany).not.toHaveBeenCalled()
    })

    it('answers NotPending, not ObjectMissing, when a concurrent reject took the source', async () => {
      vi.mocked(r2.getObjectBytes).mockResolvedValue({ status: 'missing' })
      db.photo.findUnique
        .mockResolvedValueOnce({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
        .mockResolvedValueOnce({ status: 'REJECTED', r2Url: null })

      await expect(approve()).rejects.toMatchObject({ code: 'NotPending', statusCode: 409 })
      expect(r2.putObject).not.toHaveBeenCalled()
    })

    it('publishes a pre-staging row from the public bucket, then removes its raw original', async () => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'PENDING', r2Key: LEGACY })

      // The raw original was public: the edge still serves it until purged.
      await expect(approve()).resolves.toEqual({
        id: PHOTO,
        status: 'APPROVED',
        r2Url: PUBLIC_URL,
        purgeUrl: LEGACY_URL,
      })
      expect(r2.getObjectBytes).toHaveBeenCalledWith({
        bucket: 'tinyhike-photos',
        key: LEGACY,
        maxBytes: r2.MAX_UPLOAD_BYTES,
      })
      expect((await sharp(publishedBytes()).metadata()).exif).toBeUndefined()
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: LEGACY })
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ url: `https://photos.example.test/${LEGACY}` }),
        expect.stringMatching(/purge/i),
      )
    })

    it('approves a pre-staging row even without a staging bucket', async () => {
      vi.mocked(r2.stagingBucket).mockReturnValue(undefined)
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'PENDING', r2Key: LEGACY })
      await expect(approve()).resolves.toMatchObject({ status: 'APPROVED' })
    })

    it('names the still-public original when its delete fails', async () => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'PENDING', r2Key: LEGACY })
      vi.mocked(r2.deleteObject).mockRejectedValue(new Error('R2 hiccup'))

      await expect(approve()).resolves.toMatchObject({ status: 'APPROVED' })
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ url: `https://photos.example.test/${LEGACY}` }),
        expect.stringMatching(/still public/i),
      )
    })

    it('answers NotFound for an unknown photo', async () => {
      db.photo.findUnique.mockResolvedValue(null)
      await expect(approve()).rejects.toMatchObject({ code: 'NotFound', statusCode: 404 })
    })

    it.each(['APPROVED', 'REJECTED'])('answers NotPending for a %s photo', async (status) => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status, r2Key: PUBLIC_KEY })
      await expect(approve()).rejects.toMatchObject({ code: 'NotPending', statusCode: 409 })
      expect(r2.getObjectBytes).not.toHaveBeenCalled()
    })

    it('cannot approve without a staging bucket', async () => {
      vi.mocked(r2.stagingBucket).mockReturnValue(undefined)
      await expect(approve()).rejects.toMatchObject({ code: 'UploadsDisabled', statusCode: 503 })
    })

    it('unpublishes when a concurrent reject won the race', async () => {
      db.photo.updateMany.mockResolvedValue({ count: 0 })
      db.photo.findUnique
        .mockResolvedValueOnce({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
        .mockResolvedValueOnce({ status: 'REJECTED', r2Url: null })

      await expect(approve()).rejects.toMatchObject({ code: 'NotPending' })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: PUBLIC_KEY })
    })

    it('keeps the object when a concurrent approval published the same thing', async () => {
      db.photo.updateMany.mockResolvedValue({ count: 0 })
      db.photo.findUnique
        .mockResolvedValueOnce({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
        .mockResolvedValueOnce({ status: 'APPROVED', r2Url: PUBLIC_URL })

      await expect(approve()).resolves.toEqual({ id: PHOTO, status: 'APPROVED', r2Url: PUBLIC_URL, purgeUrl: null })
      expect(r2.deleteObject).not.toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: PUBLIC_KEY })
    })

    it('fails before downloading or publishing anything when R2_PUBLIC_URL is unusable', async () => {
      // Otherwise the row would store a relative URL that renders as a broken image.
      vi.mocked(r2.publicUrl).mockImplementation(() => {
        throw new Error('R2_PUBLIC_URL is not set')
      })
      await expect(approve()).rejects.toThrow('R2_PUBLIC_URL is not set')
      expect(r2.getObjectBytes).not.toHaveBeenCalled()
      expect(r2.putObject).not.toHaveBeenCalled()
      expect(db.photo.updateMany).not.toHaveBeenCalled()
    })

    it('unpublishes when the row update fails', async () => {
      db.photo.updateMany.mockRejectedValue(new Error('database unavailable'))
      await expect(approve()).rejects.toThrow('database unavailable')
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: PUBLIC_KEY })
      expect(r2.deleteObject).not.toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: STAGED })
    })
  })

  describe('rejectPhoto', () => {
    it('deletes the staged bytes of a PENDING photo, then marks it REJECTED', async () => {
      const result = await reject('face visible')
      expect(result).toEqual({ id: PHOTO, status: 'REJECTED', r2Url: null, purgeUrl: null })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: STAGED })
      expect(db.photo.updateMany).toHaveBeenCalledWith({
        // Conditional on the row still being what was cleaned up.
        where: { id: PHOTO, status: 'PENDING', r2Key: STAGED },
        data: { status: 'REJECTED', r2Url: null, moderationNote: 'face visible' },
      })
      expect(db.photo.update).not.toHaveBeenCalled()
      expect(vi.mocked(r2.deleteObject).mock.invocationCallOrder[0]).toBeLessThan(
        db.photo.updateMany.mock.invocationCallOrder[0],
      )
      expect(log.warn).not.toHaveBeenCalled()
    })

    it('takes an APPROVED photo down from the public bucket', async () => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'APPROVED', r2Key: PUBLIC_KEY })
      const result = await reject()
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: PUBLIC_KEY })
      // The edge cache still holds it: the purge reminder must reach the caller, not only the log.
      expect(result.purgeUrl).toBe(PUBLIC_URL)
      expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ url: PUBLIC_URL }), expect.stringMatching(/purge/i))
    })

    it('completes a takedown even when R2_PUBLIC_URL is unusable, naming the key instead', async () => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'APPROVED', r2Key: PUBLIC_KEY })
      vi.mocked(r2.publicUrl).mockImplementation(() => {
        throw new Error('R2_PUBLIC_URL is not set')
      })
      await expect(reject()).resolves.toEqual({ id: PHOTO, status: 'REJECTED', r2Url: null, purgeUrl: null })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: PUBLIC_KEY })
      expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ key: PUBLIC_KEY }), expect.stringMatching(/purge/i))
    })

    it('takes the public object down when an approval finished between the read and the write', async () => {
      // 1. reject reads PENDING; 2. approve publishes p/<id>.jpg and flips the row;
      // 3. reject's conditional write misses, so it re-reads and redoes the takedown.
      db.photo.findUnique
        .mockResolvedValueOnce({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
        .mockResolvedValueOnce({ id: PHOTO, status: 'APPROVED', r2Key: PUBLIC_KEY })
      db.photo.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })

      await expect(reject('late')).resolves.toEqual({ id: PHOTO, status: 'REJECTED', r2Url: null, purgeUrl: PUBLIC_URL })

      expect(r2.deleteObject).toHaveBeenNthCalledWith(1, { bucket: 'tinyhike-photos-staging', key: STAGED })
      expect(r2.deleteObject).toHaveBeenNthCalledWith(2, { bucket: 'tinyhike-photos', key: PUBLIC_KEY })
      expect(db.photo.updateMany).toHaveBeenLastCalledWith({
        where: { id: PHOTO, status: 'APPROVED', r2Key: PUBLIC_KEY },
        data: { status: 'REJECTED', r2Url: null, moderationNote: 'late' },
      })
      expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ url: PUBLIC_URL }), expect.stringMatching(/purge/i))
    })

    it('settles on the note alone when another reject won the race', async () => {
      db.photo.findUnique
        .mockResolvedValueOnce({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
        .mockResolvedValueOnce({ id: PHOTO, status: 'REJECTED', r2Key: STAGED })
      db.photo.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })

      await expect(reject()).resolves.toMatchObject({ status: 'REJECTED' })
      expect(r2.deleteObject).toHaveBeenCalledTimes(1)
    })

    it('gives up with a Conflict after a bounded number of lost races', async () => {
      db.photo.updateMany.mockResolvedValue({ count: 0 })
      await expect(reject()).rejects.toMatchObject({ code: 'Conflict', statusCode: 409 })
      expect(db.photo.findUnique).toHaveBeenCalledTimes(3)
    })

    it('answers NotFound when the row disappears after a lost race', async () => {
      db.photo.findUnique
        .mockResolvedValueOnce({ id: PHOTO, status: 'PENDING', r2Key: STAGED })
        .mockResolvedValueOnce(null)
      db.photo.updateMany.mockResolvedValueOnce({ count: 0 })
      await expect(reject()).rejects.toMatchObject({ code: 'NotFound', statusCode: 404 })
    })

    it('deletes a pre-staging upload from the PUBLIC bucket, where it was served', async () => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'PENDING', r2Key: LEGACY })
      await reject()
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: LEGACY })
      expect(r2.deleteObject).not.toHaveBeenCalledWith(expect.objectContaining({ bucket: 'tinyhike-photos-staging' }))
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ url: `https://photos.example.test/${LEGACY}` }),
        expect.stringMatching(/purge/i),
      )
    })

    it('leaves the row untouched when the delete fails', async () => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'APPROVED', r2Key: PUBLIC_KEY })
      vi.mocked(r2.deleteObject).mockRejectedValue(new Error('R2 down'))
      await expect(reject()).rejects.toThrow('R2 down')
      expect(db.photo.updateMany).not.toHaveBeenCalled()
      expect(db.photo.update).not.toHaveBeenCalled()
    })

    it('only updates the note of an already REJECTED photo', async () => {
      db.photo.findUnique.mockResolvedValue({ id: PHOTO, status: 'REJECTED', r2Key: STAGED })
      await reject('duplicate')
      expect(r2.deleteObject).not.toHaveBeenCalled()
      expect(db.photo.updateMany).toHaveBeenCalledTimes(1)
      expect(db.photo.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ moderationNote: 'duplicate' }) }),
      )
    })

    it('still rejects a PENDING photo when no staging bucket is configured', async () => {
      vi.mocked(r2.stagingBucket).mockReturnValue(undefined)
      await expect(reject()).resolves.toMatchObject({ status: 'REJECTED' })
      expect(r2.deleteObject).not.toHaveBeenCalled()
      expect(log.warn).toHaveBeenCalledTimes(1)
    })

    it('answers NotFound for an unknown photo', async () => {
      db.photo.findUnique.mockResolvedValue(null)
      await expect(reject()).rejects.toMatchObject({ code: 'NotFound', statusCode: 404 })
    })
  })

  describe('listPhotos', () => {
    const row = (over: Record<string, unknown>) => ({
      id: PHOTO,
      status: 'PENDING',
      createdAt: new Date('2026-10-20T10:00:00Z'),
      placeId: 'cplace0000000000000000001',
      routeId: null,
      r2Key: STAGED,
      r2Url: null,
      moderationNote: null,
      uploadedBy: { id: 'cuseraaaa000000000000001', handle: null },
      place: {
        translations: [
          { locale: 'en', name: 'Playground' },
          { locale: 'nl', name: 'Speeltuin' },
        ],
      },
      ...over,
    })

    it('shows a PENDING photo through a short-lived signed link, oldest first', async () => {
      db.photo.findMany.mockResolvedValue([row({})])
      const photos = await listPhotos(asPrisma(db), { status: 'PENDING', take: 50 })

      expect(db.photo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING' },
          take: 50,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      )
      expect(r2.presignGet).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: STAGED, expiresIn: 600 })
      expect(photos).toEqual([
        {
          id: PHOTO,
          status: 'PENDING',
          createdAt: new Date('2026-10-20T10:00:00Z'),
          placeId: 'cplace0000000000000000001',
          placeName: 'Speeltuin',
          routeId: null,
          uploader: { id: 'cuseraaaa000000000000001', handle: null },
          viewUrl: 'https://staging.example.test/signed-get',
          moderationNote: null,
        },
      ])
    })

    it('falls back to the first translation, and to null without a place', async () => {
      db.photo.findMany.mockResolvedValue([
        row({ place: { translations: [{ locale: 'en', name: 'Playground' }] } }),
        row({ id: 'cphoto2', place: null, placeId: null, routeId: 'croute1' }),
      ])
      const photos = await listPhotos(asPrisma(db), { status: 'PENDING', take: 50 })
      expect(photos.map((p) => p.placeName)).toEqual(['Playground', null])
    })

    it('shows an APPROVED photo by its public URL, newest first', async () => {
      db.photo.findMany.mockResolvedValue([row({ status: 'APPROVED', r2Key: PUBLIC_KEY, r2Url: PUBLIC_URL })])
      const [photo] = await listPhotos(asPrisma(db), { status: 'APPROVED', take: 10 })
      expect(photo.viewUrl).toBe(PUBLIC_URL)
      expect(r2.presignGet).not.toHaveBeenCalled()
      expect(db.photo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      )
    })

    it('gives a REJECTED photo no view link', async () => {
      db.photo.findMany.mockResolvedValue([row({ status: 'REJECTED', moderationNote: 'blurry' })])
      const [photo] = await listPhotos(asPrisma(db), { status: 'REJECTED', take: 10 })
      expect(photo.viewUrl).toBeNull()
      expect(photo.moderationNote).toBe('blurry')
    })

    it('signs a pre-staging PENDING photo in the public bucket, where its bytes are', async () => {
      db.photo.findMany.mockResolvedValue([row({ r2Key: LEGACY })])
      await listPhotos(asPrisma(db), { status: 'PENDING', take: 10 })
      expect(r2.presignGet).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: LEGACY, expiresIn: 600 })
    })

    it('gives a PENDING photo no view link when staging is unset', async () => {
      vi.mocked(r2.stagingBucket).mockReturnValue(undefined)
      db.photo.findMany.mockResolvedValue([row({})])
      const [photo] = await listPhotos(asPrisma(db), { status: 'PENDING', take: 10 })
      expect(photo.viewUrl).toBeNull()
    })
  })

  describe('purgeLegacyUploads', () => {
    const CONFIRMED_LEGACY = `confirmed/${LEGACY.slice('uploads/'.length)}`
    const ORPHAN = 'uploads/cuserbbbb000000000000002/9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f.png'
    const APPROVED_LEGACY = 'uploads/cuserbbbb000000000000002/0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d.jpg'

    const purge = (dryRun = false) => purgeLegacyUploads(asPrisma(db), { dryRun, log })

    /** The public bucket's uploads/ prefix, as listObjectKeys pages it. */
    function listing(...pages: string[][]) {
      vi.mocked(r2.listObjectKeys).mockImplementation(async function* () {
        yield* pages
      })
    }

    /** Pending legacy rows for step 1; rows by key for step 2's lookup. */
    function rows(pending: { id: string; r2Key: string }[], byKey: { r2Key: string; status: string }[]) {
      db.photo.findMany.mockImplementation(async (args: { where: { status?: string } }) =>
        args.where.status === 'PENDING' ? pending : byKey,
      )
    }

    beforeEach(() => {
      vi.mocked(r2.copyObject).mockResolvedValue(true)
      listing()
      rows([], [])
    })

    it('does nothing when nothing was left behind', async () => {
      await expect(purge()).resolves.toEqual({ dryRun: false, moved: [], missing: [], purgeUrls: [], kept: [] })
      expect(r2.copyObject).not.toHaveBeenCalled()
      expect(r2.deleteObject).not.toHaveBeenCalled()
    })

    it('moves pending originals into staging and deletes every public upload no approved photo serves', async () => {
      listing([LEGACY, ORPHAN], [APPROVED_LEGACY])
      rows(
        [{ id: PHOTO, r2Key: LEGACY }],
        // By step 2 the moved row points into staging, so nothing references LEGACY.
        [{ r2Key: APPROVED_LEGACY, status: 'APPROVED' }],
      )

      const report = await purge()

      expect(db.photo.findMany).toHaveBeenCalledWith({
        where: { status: 'PENDING', r2Key: { startsWith: 'uploads/' } },
        select: { id: true, r2Key: true },
      })
      expect(r2.copyObject).toHaveBeenCalledWith({
        bucket: 'tinyhike-photos-staging',
        sourceBucket: 'tinyhike-photos',
        from: LEGACY,
        to: CONFIRMED_LEGACY,
      })
      expect(db.photo.updateMany).toHaveBeenCalledWith({
        where: { id: PHOTO, status: 'PENDING', r2Key: LEGACY },
        data: { r2Key: CONFIRMED_LEGACY, r2Url: null },
      })
      expect(r2.listObjectKeys).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', prefix: 'uploads/' })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: LEGACY })
      // A PUT that was never confirmed has no row, and is public all the same.
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: ORPHAN })
      expect(r2.deleteObject).not.toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: APPROVED_LEGACY })
      expect(vi.mocked(r2.copyObject).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(r2.deleteObject).mock.invocationCallOrder[0],
      )

      expect(report).toEqual({
        dryRun: false,
        moved: [PHOTO],
        missing: [],
        purgeUrls: [LEGACY_URL, `https://photos.example.test/${ORPHAN}`],
        kept: [APPROVED_LEGACY],
      })
    })

    it('changes nothing in a dry run, and reports what it would do', async () => {
      listing([LEGACY, ORPHAN])
      // In a dry run the row still points at LEGACY; it would move, so it is not protected.
      rows([{ id: PHOTO, r2Key: LEGACY }], [{ r2Key: LEGACY, status: 'PENDING' }])

      await expect(purge(true)).resolves.toEqual({
        dryRun: true,
        moved: [PHOTO],
        missing: [],
        purgeUrls: [LEGACY_URL, `https://photos.example.test/${ORPHAN}`],
        kept: [],
      })
      expect(r2.copyObject).not.toHaveBeenCalled()
      expect(db.photo.updateMany).not.toHaveBeenCalled()
      expect(r2.deleteObject).not.toHaveBeenCalled()
    })

    it('refuses to start without a staging bucket when a pending photo must move', async () => {
      vi.mocked(r2.stagingBucket).mockReturnValue(undefined)
      listing([LEGACY])
      rows([{ id: PHOTO, r2Key: LEGACY }], [])

      await expect(purge()).rejects.toMatchObject({ code: 'UploadsDisabled' })
      expect(r2.copyObject).not.toHaveBeenCalled()
      expect(r2.deleteObject).not.toHaveBeenCalled()
    })

    it('deletes orphaned uploads even without a staging bucket when no row needs moving', async () => {
      vi.mocked(r2.stagingBucket).mockReturnValue(undefined)
      listing([ORPHAN])
      await expect(purge()).resolves.toMatchObject({ purgeUrls: [`https://photos.example.test/${ORPHAN}`] })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos', key: ORPHAN })
    })

    it('reports a pending photo whose original is gone, without touching its row', async () => {
      vi.mocked(r2.copyObject).mockResolvedValue(false)
      rows([{ id: PHOTO, r2Key: LEGACY }], [])

      await expect(purge()).resolves.toMatchObject({ moved: [], missing: [PHOTO] })
      expect(db.photo.updateMany).not.toHaveBeenCalled()
    })

    it('drops the staging copy of a row moderated meanwhile', async () => {
      db.photo.updateMany.mockResolvedValue({ count: 0 })
      rows([{ id: PHOTO, r2Key: LEGACY }], [])

      await expect(purge()).resolves.toMatchObject({ moved: [], missing: [] })
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: CONFIRMED_LEGACY })
    })

    it('stops before deleting anything public when a move fails', async () => {
      db.photo.updateMany.mockRejectedValue(new Error('database unavailable'))
      listing([LEGACY])
      rows([{ id: PHOTO, r2Key: LEGACY }], [])

      await expect(purge()).rejects.toThrow('database unavailable')
      // The copy no row references is dropped; the public original waits for a rerun.
      expect(r2.deleteObject).toHaveBeenCalledTimes(1)
      expect(r2.deleteObject).toHaveBeenCalledWith({ bucket: 'tinyhike-photos-staging', key: CONFIRMED_LEGACY })
      expect(r2.listObjectKeys).not.toHaveBeenCalled()
    })

    it('never deletes an object a pending row still points at', async () => {
      // Safety net: a pending original that did not move stays put (and is reported).
      listing([LEGACY])
      rows([], [{ r2Key: LEGACY, status: 'PENDING' }])
      await expect(purge()).resolves.toMatchObject({ kept: [LEGACY], purgeUrls: [] })
      expect(r2.deleteObject).not.toHaveBeenCalled()
    })
  })
})
