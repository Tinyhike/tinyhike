/**
 * Photo moderation: the only path by which an upload becomes public.
 *
 * A PENDING photo lives in the private staging bucket (r2Key = confirmed/…, no
 * r2Url). Approving it does NOT copy those bytes: it decodes them and re-encodes a
 * fresh JPEG into the public bucket. That one step
 *   - strips EXIF/XMP/ICC (GPS of the family's home, capture time, phone model),
 *   - proves the object is a real image (anything sharp can't decode is refused),
 *   - caps the size served to 4G phones,
 *   - and publishes under p/<photoId>.jpg, a key that carries no user id.
 *
 * Shared by the admin routes and the moderate-photos CLI, so both map the same
 * typed errors (PhotoModerationError) to an HTTP status or an exit code.
 *
 * Where a row's bytes live is read from its key (see locate()):
 *   confirmed/<userId>/<uuid>.<ext>  private staging bucket, a PENDING upload
 *   p/<photoId>.jpg                  public bucket, approved and re-encoded
 *   uploads/<userId>/<uuid>.<ext>    PUBLIC bucket: a row confirmed before the
 *                                    staging bucket existed, whose raw upload (EXIF
 *                                    and all) still sits at photos.tinyhike.com/uploads/…
 *                                    purgeLegacyUploads() moves those into staging.
 *
 * Deleting a public object does not take it offline: Cloudflare's edge keeps
 * serving it (Cache-Control immutable, one year) until the URL is purged by hand.
 * Every result that deleted one says so in purgeUrl / purgeUrls.
 */

import type { PhotoStatus, PrismaClient } from '@prisma/client'
import sharp from 'sharp'
import {
  MAX_UPLOAD_BYTES,
  stagingBucket,
  publicBucket,
  publicUrl,
  presignGet,
  getObjectBytes,
  putObject,
  copyObject,
  deleteObject,
  listObjectKeys,
} from '../lib/r2.js'

export type PhotoModerationErrorCode =
  | 'NotFound'
  | 'NotPending'
  | 'InvalidImage'
  | 'ObjectMissing'
  | 'UploadsDisabled'
  | 'Conflict'

const STATUS_FOR: Record<PhotoModerationErrorCode, number> = {
  NotFound: 404,
  NotPending: 409,
  // The row says PENDING but the staged bytes are gone: nothing to approve. Reject it.
  ObjectMissing: 409,
  InvalidImage: 422,
  // No staging bucket configured, so pending photos can't be read.
  UploadsDisabled: 503,
  // The row kept changing under a reject; asking again settles it.
  Conflict: 409,
}

export class PhotoModerationError extends Error {
  readonly statusCode: number
  constructor(
    readonly code: PhotoModerationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PhotoModerationError'
    this.statusCode = STATUS_FOR[code]
  }
}

/** The slice of a logger the service needs; Fastify's request.log fits, so does a console shim. */
export interface ModerationLogger {
  warn(obj: object, msg: string): void
}

type Db = Pick<PrismaClient, 'photo'>

/** A moderator's view of a staged object is a presigned GET valid this long. */
const VIEW_URL_TTL_SECONDS = 600

/** Longest edge of a published photo. Plenty for a phone sheet, a fraction of a 48 MP original. */
const MAX_EDGE = 2048

/** Decompression-bomb guard: a few KB of PNG can declare a billion pixels. */
const MAX_INPUT_PIXELS = 50_000_000

/** Public keys are unique per photo and never rewritten, so the edge may keep them for a year. */
const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** Where /api/photos/confirm puts an upload in the staging bucket. */
const STAGED_PREFIX = 'confirmed/'

/** Where the pre-staging /presign put raw uploads, in the PUBLIC bucket. */
const LEGACY_PREFIX = 'uploads/'

/**
 * Each race rejectPhoto loses means the row moved forward, and it only moves one
 * way: PENDING → APPROVED → REJECTED (a REJECTED row keeps its key, so another
 * reject changing the note doesn't count). Three reads always reach a state the
 * conditional write lands on, unless the row is deleted meanwhile.
 */
const REJECT_ATTEMPTS = 3

export interface ModerationPhoto {
  id: string
  status: PhotoStatus
  createdAt: Date
  placeId: string | null
  placeName: string | null
  routeId: string | null
  uploader: { id: string; handle: string | null } | null
  viewUrl: string | null
  moderationNote: string | null
}

/**
 * The moderation queue. PENDING is oldest first (first in, first reviewed); the
 * other statuses newest first, which is what a moderator looking back wants.
 */
export async function listPhotos(
  db: Db,
  opts: { status: PhotoStatus; take: number },
): Promise<ModerationPhoto[]> {
  const order = opts.status === 'PENDING' ? 'asc' : 'desc'
  const rows = await db.photo.findMany({
    where: { status: opts.status },
    orderBy: [{ createdAt: order }, { id: order }],
    take: opts.take,
    select: {
      id: true,
      status: true,
      createdAt: true,
      placeId: true,
      routeId: true,
      r2Key: true,
      r2Url: true,
      moderationNote: true,
      uploadedBy: { select: { id: true, handle: true } },
      place: { select: { translations: { select: { locale: true, name: true }, orderBy: { locale: 'asc' } } } },
    },
  })

  return Promise.all(
    rows.map(async (row) => {
      const translations = row.place?.translations ?? []
      const name = translations.find((t) => t.locale === 'nl') ?? translations[0]
      return {
        id: row.id,
        status: row.status,
        createdAt: row.createdAt,
        placeId: row.placeId,
        placeName: name?.name ?? null,
        routeId: row.routeId,
        uploader: row.uploadedBy ? { id: row.uploadedBy.id, handle: row.uploadedBy.handle } : null,
        viewUrl: await viewUrlFor(row),
        moderationNote: row.moderationNote,
      }
    }),
  )
}

async function viewUrlFor(row: { status: PhotoStatus; r2Key: string; r2Url: string | null }): Promise<string | null> {
  switch (row.status) {
    case 'PENDING': {
      // Unmoderated bytes: a short-lived signed link, for the moderator's eyes only.
      // Signing works the same for a pre-staging row in the public bucket.
      const { bucket } = locate(row.r2Key)
      return bucket ? presignGet({ bucket, key: row.r2Key, expiresIn: VIEW_URL_TTL_SECONDS }) : null
    }
    case 'APPROVED':
      return row.r2Url
    case 'REJECTED':
      return null
  }
}

interface ObjectLocation {
  /** undefined when the key belongs in staging and no staging bucket is configured. */
  bucket: string | undefined
  /** Served at R2_PUBLIC_URL, so a delete must be followed by an edge-cache purge. */
  isPublic: boolean
}

/**
 * The bucket holding a row's bytes, from its key prefix (see the table at the top).
 * Anything not under confirmed/ is taken to be public: p/… and the pre-staging
 * uploads/… both are, and for an unexpected key, deleting from the public bucket
 * is the direction that keeps unmoderated bytes offline.
 */
function locate(r2Key: string): ObjectLocation {
  if (r2Key.startsWith(STAGED_PREFIX)) return { bucket: stagingBucket(), isPublic: false }
  return { bucket: publicBucket(), isPublic: true }
}

export interface ModerationResult {
  id: string
  status: PhotoStatus
  r2Url: string | null
  /**
   * A public URL whose object this call deleted, which the Cloudflare edge keeps
   * serving until it is purged by hand (Caching → Purge Cache → Custom Purge).
   * Set by a takedown, or by approving a pre-staging row. Null otherwise.
   */
  purgeUrl: string | null
}

/**
 * The edge URL of a public key, for a purge reminder. Never throws: a takedown
 * has already deleted the bytes by then and must not fail on R2_PUBLIC_URL, so a
 * bad config yields null and the warning carries the key instead.
 */
function purgeUrlFor(key: string, log: ModerationLogger): string | null {
  try {
    return publicUrl(key)
  } catch (err) {
    log.warn({ err, key }, 'R2_PUBLIC_URL is unusable: purge this key on photos.tinyhike.com by hand')
    return null
  }
}

/**
 * Publish a PENDING photo.
 *
 * Order matters: re-encode → put public → update row → delete the source. The row
 * only changes once the public object exists, so a failure part-way never leaves
 * an APPROVED photo pointing at nothing. The source delete comes last and a
 * failure there is only logged: a leftover staging object is private and harmless.
 * A pre-staging source is public, so for one of those the warning names the URL
 * to remove by hand.
 */
export async function approvePhoto(
  db: Db,
  id: string,
  opts: { moderationNote?: string; log: ModerationLogger },
): Promise<ModerationResult> {
  const photo = await db.photo.findUnique({ where: { id }, select: { id: true, status: true, r2Key: true } })
  if (!photo) throw new PhotoModerationError('NotFound', 'Photo not found')
  if (photo.status !== 'PENDING') throw new PhotoModerationError('NotPending', `Photo is ${photo.status}, not PENDING`)

  const { bucket: sourceBucket, isPublic: sourceIsPublic } = locate(photo.r2Key)
  if (!sourceBucket) throw new PhotoModerationError('UploadsDisabled', 'R2_STAGING_BUCKET is not configured')

  // Resolved before any work: both throw on a missing or unusable config, and an
  // approval must fail before it publishes anything, not store a broken URL.
  const bucket = publicBucket()
  const key = `p/${photo.id}.jpg`
  const url = publicUrl(key)

  const object = await getObjectBytes({ bucket: sourceBucket, key: photo.r2Key, maxBytes: MAX_UPLOAD_BYTES })
  if (object.status === 'missing') return settleMissingSource(db, photo.id)
  if (object.status === 'too_large') throw new PhotoModerationError('InvalidImage', 'Image exceeds 10 MB')

  const jpeg = await reencode(object.bytes)

  await putObject({ bucket, key, body: jpeg, contentType: 'image/jpeg', cacheControl: PUBLIC_CACHE_CONTROL })

  // Conditional on still being PENDING: a reject that landed while we were
  // encoding must win, or a rejected photo would go public.
  let updated
  try {
    updated = await db.photo.updateMany({
      where: { id: photo.id, status: 'PENDING' },
      data: { status: 'APPROVED', r2Key: key, r2Url: url, moderationNote: opts.moderationNote },
    })
  } catch (err) {
    await unpublish(bucket, key, opts.log)
    throw err
  }

  if (updated.count === 0) {
    const now = await db.photo.findUnique({ where: { id: photo.id }, select: { status: true, r2Url: true } })
    // A concurrent approval published the very same bytes under the same key: done.
    if (now?.status === 'APPROVED' && now.r2Url === url) {
      return { id: photo.id, status: 'APPROVED', r2Url: url, purgeUrl: null }
    }
    await unpublish(bucket, key, opts.log)
    throw new PhotoModerationError('NotPending', 'Photo was moderated by someone else meanwhile')
  }

  let purgeUrl: string | null = null
  try {
    await deleteObject({ bucket: sourceBucket, key: photo.r2Key })
    if (sourceIsPublic) {
      purgeUrl = purgeUrlFor(photo.r2Key, opts.log)
      opts.log.warn(
        { photoId: photo.id, url: purgeUrl, key: photo.r2Key },
        'pre-staging original removed from the public bucket: purge this URL from the Cloudflare cache',
      )
    }
  } catch (err) {
    opts.log.warn(
      { err, photoId: photo.id, key: photo.r2Key, ...(sourceIsPublic && { url: purgeUrlFor(photo.r2Key, opts.log) }) },
      sourceIsPublic
        ? 'approved photo: its raw pre-staging original is STILL PUBLIC, delete it by hand'
        : 'approved photo: staging delete failed',
    )
  }

  return { id: photo.id, status: 'APPROVED', r2Url: url, purgeUrl }
}

/**
 * The source object vanished between reading the row and downloading it. That is
 * what a concurrent approval looks like from the losing side (the winner deletes
 * the staged copy once it has published), so read the row again before advising a
 * reject: told to reject a photo that was just approved, a moderator would turn a
 * double-click into a takedown.
 */
async function settleMissingSource(db: Db, id: string): Promise<ModerationResult> {
  const now = await db.photo.findUnique({ where: { id }, select: { status: true, r2Url: true } })
  if (!now) throw new PhotoModerationError('NotFound', 'Photo not found')
  if (now.status === 'APPROVED') return { id, status: 'APPROVED', r2Url: now.r2Url, purgeUrl: null }
  if (now.status === 'REJECTED') throw new PhotoModerationError('NotPending', 'Photo was rejected meanwhile')
  throw new PhotoModerationError('ObjectMissing', 'The uploaded file no longer exists; reject this photo')
}

/**
 * Reject a photo, whatever its status.
 *
 * Deletes the bytes wherever the row's key says they live: a PENDING upload in
 * staging, or, for an APPROVED photo, the public object, which makes this a
 * takedown. A public object is still in the edge cache after that (Cache-Control:
 * immutable, one year), and its id-based URL is easy to rebuild: the result's
 * purgeUrl names it, for whoever moderates to purge by hand in the Cloudflare
 * dashboard (Caching → Purge Cache → Custom Purge).
 *
 * The delete comes first and must succeed: a takedown that silently left the
 * bytes online, while the row said REJECTED, would be worse than an error.
 *
 * The write is conditional on the row still having the status and key whose bytes
 * were just deleted. Without that, an approval finishing in between (p/<id>.jpg
 * published, staging deleted) would be overwritten to REJECTED with its public
 * object left online, and every later reject would see REJECTED and delete
 * nothing. On a lost race the row is read again and the reject redone against it.
 */
export async function rejectPhoto(
  db: Db,
  id: string,
  opts: { moderationNote?: string; log: ModerationLogger },
): Promise<ModerationResult> {
  // A lost race can mean the second pass deletes a public object the first did
  // not see, so remember any purge across attempts.
  let purgeUrl: string | null = null
  for (let attempt = 0; attempt < REJECT_ATTEMPTS; attempt++) {
    const photo = await db.photo.findUnique({ where: { id }, select: { id: true, status: true, r2Key: true } })
    if (!photo) throw new PhotoModerationError('NotFound', 'Photo not found')

    purgeUrl = (await deleteBytes(photo, opts.log)) ?? purgeUrl

    const updated = await db.photo.updateMany({
      where: { id: photo.id, status: photo.status, r2Key: photo.r2Key },
      // r2Url cleared so nothing can render a link to deleted bytes.
      data: { status: 'REJECTED', r2Url: null, moderationNote: opts.moderationNote },
    })
    if (updated.count > 0) return { id: photo.id, status: 'REJECTED', r2Url: null, purgeUrl }
  }
  throw new PhotoModerationError('Conflict', 'Photo kept changing while being rejected; try again')
}

/**
 * Delete a photo's bytes ahead of marking it REJECTED. Resolves the URL to purge
 * from the edge when the bytes were public, else null.
 */
async function deleteBytes(
  photo: { id: string; status: PhotoStatus; r2Key: string },
  log: ModerationLogger,
): Promise<string | null> {
  // Already REJECTED: its bytes were deleted then; only the note may change.
  if (photo.status === 'REJECTED') return null

  const { bucket, isPublic } = locate(photo.r2Key)
  if (!bucket) {
    // Staged bytes are private either way; rejecting must not depend on config.
    log.warn({ photoId: photo.id, key: photo.r2Key }, 'no staging bucket configured: staged object left in place')
    return null
  }
  await deleteObject({ bucket, key: photo.r2Key })
  if (!isPublic) return null

  const url = purgeUrlFor(photo.r2Key, log)
  log.warn(
    { photoId: photo.id, url, key: photo.r2Key },
    'photo taken down from the public bucket: purge this URL from the Cloudflare cache',
  )
  return url
}

export interface LegacyPurgeReport {
  dryRun: boolean
  /** PENDING photos whose raw original was (or would be) moved into private staging. */
  moved: string[]
  /** PENDING photos whose original no longer exists: nothing to moderate, reject them. */
  missing: string[]
  /** Public URLs deleted (or that would be). Each must be purged from the Cloudflare cache. */
  purgeUrls: string[]
  /** Keys left in place because an APPROVED row serves them (or a PENDING one could not move). */
  kept: string[]
}

/**
 * Clear what the pre-staging upload flow left in the PUBLIC bucket.
 *
 * Before the staging bucket existed, /presign signed PUTs straight into R2_BUCKET
 * at uploads/<userId>/<uuid>.<ext>, and photos.tinyhike.com serves that bucket in
 * full: raw bytes, EXIF and all, under a key naming the uploader. Two kinds of
 * object are left there, and no other code path finds the second:
 *   - originals of PENDING rows confirmed back then;
 *   - PUTs never confirmed, which have no row at all.
 *
 * 1. Each PENDING row under uploads/ has its original copied to staging at
 *    confirmed/<userId>/<uuid>.<ext> and its row repointed there with r2Url
 *    cleared, so it stays in the moderation queue without being public. The write
 *    is conditional, like everywhere in this file: a row moderated meanwhile keeps
 *    its outcome and the copy is dropped.
 * 2. Every object under uploads/ in the public bucket is deleted unless an
 *    APPROVED row serves it. That includes the originals just moved.
 *
 * Fails before deleting anything if a move is needed and no staging bucket is
 * configured, or if any move fails: rerunning is safe, a moved row no longer
 * matches step 1. With dryRun, nothing is copied, written or deleted, and the
 * report says what would be.
 */
export async function purgeLegacyUploads(
  db: Db,
  opts: { dryRun?: boolean; log: ModerationLogger },
): Promise<LegacyPurgeReport> {
  const dryRun = opts.dryRun ?? false
  const report: LegacyPurgeReport = { dryRun, moved: [], missing: [], purgeUrls: [], kept: [] }
  const bucket = publicBucket()

  // 1. Move PENDING originals into private staging.
  const pending = await db.photo.findMany({
    where: { status: 'PENDING', r2Key: { startsWith: LEGACY_PREFIX } },
    select: { id: true, r2Key: true },
  })
  // Originals whose row leaves (or, in a dry run, would leave) uploads/.
  const movedKeys = new Set<string>()
  const moved = (row: { id: string; r2Key: string }) => {
    report.moved.push(row.id)
    movedKeys.add(row.r2Key)
  }

  if (dryRun) {
    pending.forEach(moved)
  } else if (pending.length > 0) {
    const staging = stagingBucket()
    if (!staging) {
      throw new PhotoModerationError(
        'UploadsDisabled',
        'R2_STAGING_BUCKET is not configured: pending legacy photos have nowhere private to move to',
      )
    }
    for (const row of pending) {
      const outcome = await moveToStaging(db, row, { staging, publicBucket: bucket, log: opts.log })
      if (outcome === 'moved') moved(row)
      else if (outcome === 'missing') report.missing.push(row.id)
    }
  }

  // 2. Delete every public object under uploads/ that no APPROVED row serves.
  for await (const keys of listObjectKeys({ bucket, prefix: LEGACY_PREFIX })) {
    const rows = await db.photo.findMany({
      where: { r2Key: { in: keys } },
      select: { r2Key: true, status: true },
    })
    const keep = new Set(
      rows
        .filter((r) => r.status === 'APPROVED' || (r.status === 'PENDING' && !movedKeys.has(r.r2Key)))
        .map((r) => r.r2Key),
    )
    for (const key of keys) {
      if (keep.has(key)) {
        report.kept.push(key)
        continue
      }
      if (!dryRun) await deleteObject({ bucket, key })
      report.purgeUrls.push(purgeUrlFor(key, opts.log) ?? key)
    }
  }

  return report
}

/**
 * Copy one legacy original into staging and repoint its row there. 'moderated'
 * means the row changed status meanwhile, and the copy was dropped: whoever
 * moderated it has dealt with the original.
 */
async function moveToStaging(
  db: Db,
  row: { id: string; r2Key: string },
  opts: { staging: string; publicBucket: string; log: ModerationLogger },
): Promise<'moved' | 'missing' | 'moderated'> {
  const target = `${STAGED_PREFIX}${row.r2Key.slice(LEGACY_PREFIX.length)}`
  const copied = await copyObject({ bucket: opts.staging, sourceBucket: opts.publicBucket, from: row.r2Key, to: target })
  if (!copied) return 'missing'

  // confirmed/ never expires, so a copy no row references must not be left behind.
  const dropCopy = () =>
    deleteObject({ bucket: opts.staging, key: target }).catch((err: unknown) =>
      opts.log.warn({ err, key: target }, 'could not delete an unreferenced staging copy'),
    )

  let updated
  try {
    updated = await db.photo.updateMany({
      where: { id: row.id, status: 'PENDING', r2Key: row.r2Key },
      data: { r2Key: target, r2Url: null },
    })
  } catch (err) {
    await dropCopy()
    throw err
  }
  if (updated.count === 0) {
    await dropCopy()
    return 'moderated'
  }
  return 'moved'
}

/**
 * Decode untrusted bytes and encode a clean JPEG.
 *
 * The magic-byte check keeps sharp's other decoders (SVG, TIFF, HEIF, GIF...) out
 * of reach: only the three types an upload may declare are ever parsed.
 * rotate() bakes the EXIF orientation into the pixels before the metadata goes,
 * otherwise portrait phone photos would publish sideways. sharp writes no metadata
 * unless asked (withMetadata/keepExif), and nothing here asks.
 */
async function reencode(bytes: Buffer): Promise<Buffer> {
  if (!looksLikeAllowedImage(bytes)) {
    throw new PhotoModerationError('InvalidImage', 'Not a JPEG, PNG or WebP image')
  }
  try {
    return await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
  } catch {
    throw new PhotoModerationError('InvalidImage', 'The file could not be decoded as an image')
  }
}

function looksLikeAllowedImage(b: Buffer): boolean {
  const jpeg = b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  const png = b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const webp = b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'
  return jpeg || png || webp
}

/** Undo a publish whose row update did not happen, so no unreferenced public object lingers. */
async function unpublish(bucket: string, key: string, log: ModerationLogger): Promise<void> {
  try {
    await deleteObject({ bucket, key })
  } catch (err) {
    log.warn({ err, key }, 'could not remove public object after a failed approval')
  }
}
