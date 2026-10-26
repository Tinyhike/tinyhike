/**
 * Moderate uploaded photos from the shell, until the admin UI exists.
 *
 * Same code path as PATCH /api/admin/photos/:id (src/services/photo-moderation.ts):
 * approving re-encodes the staged upload (EXIF stripped) into the public bucket;
 * rejecting deletes the bytes. Run it on the VPS, where .env holds the R2 keys.
 *
 * Usage:  pnpm photos:moderate list [PENDING|APPROVED|REJECTED]   (default PENDING)
 *         pnpm photos:moderate approve <id>
 *         pnpm photos:moderate reject <id> [note...]
 *         pnpm photos:moderate purge-legacy [--dry-run]
 *
 * A PENDING photo's view URL is a signed link into the private staging bucket,
 * valid for 10 minutes: open it in a browser, then approve or reject.
 *
 * Deleting a public object (a takedown, or approving a pre-staging photo) leaves
 * it in Cloudflare's edge cache for up to a year: the command prints the URL to
 * purge (dashboard → Caching → Purge Cache → Custom Purge).
 *
 * purge-legacy runs once, at the deploy that introduces the staging bucket: it
 * clears the raw uploads the old flow left in the public bucket. See
 * purgeLegacyUploads() in src/services/photo-moderation.ts. Run --dry-run first.
 */

import 'dotenv/config'
import { PrismaClient, type PhotoStatus } from '@prisma/client'
import {
  listPhotos,
  approvePhoto,
  rejectPhoto,
  purgeLegacyUploads,
  PhotoModerationError,
  type ModerationLogger,
  type ModerationResult,
} from '../services/photo-moderation.js'
import { stagingBucket } from '../lib/r2.js'

const prisma = new PrismaClient()

const STATUSES: readonly PhotoStatus[] = ['PENDING', 'APPROVED', 'REJECTED']

const USAGE = `Usage:
  pnpm photos:moderate list [PENDING|APPROVED|REJECTED]
  pnpm photos:moderate approve <id>
  pnpm photos:moderate reject <id> [note...]
  pnpm photos:moderate purge-legacy [--dry-run]`

const log: ModerationLogger = {
  warn: (obj, msg) => console.warn(`! ${msg}`, obj),
}

class UsageError extends Error {}

async function list(arg: string | undefined) {
  const status = (arg ?? 'PENDING').toUpperCase()
  if (!STATUSES.includes(status as PhotoStatus)) throw new UsageError(`Unknown status "${arg}"`)

  const photos = await listPhotos(prisma, { status: status as PhotoStatus, take: 100 })
  if (photos.length === 0) {
    console.log(`No ${status} photos.`)
    return
  }
  for (const p of photos) {
    console.log(`${p.id}  [${p.status}]`)
    console.log(`  place:    ${p.placeName ?? p.placeId ?? (p.routeId ? `route ${p.routeId}` : '—')}`)
    console.log(`  uploader: ${p.uploader ? (p.uploader.handle ?? p.uploader.id) : '—'}`)
    console.log(`  date:     ${p.createdAt.toISOString()}`)
    console.log(`  view:     ${p.viewUrl ?? '—'}`)
    if (p.moderationNote) console.log(`  note:     ${p.moderationNote}`)
    console.log('')
  }
  console.log(`${photos.length} ${status} photo(s).`)
}

function printPurge(result: ModerationResult) {
  if (result.purgeUrl) {
    console.log(`Still cached at the edge: purge ${result.purgeUrl}`)
    console.log('  (Cloudflare dashboard → Caching → Purge Cache → Custom Purge)')
  }
}

async function purgeLegacy(flag: string | undefined) {
  if (flag !== undefined && flag !== '--dry-run') throw new UsageError(`Unknown option "${flag}"`)
  const dryRun = flag === '--dry-run'
  const report = await purgeLegacyUploads(prisma, { dryRun, log })
  const would = dryRun ? 'would be ' : ''

  if (report.moved.length + report.missing.length + report.purgeUrls.length + report.kept.length === 0) {
    console.log('Nothing under uploads/ in the public bucket, and no pending photo points there. Nothing to do.')
    return
  }
  console.log(`${report.moved.length} pending photo(s) ${would}moved into private staging.`)
  if (dryRun && report.moved.length > 0 && !stagingBucket()) {
    console.log('  R2_STAGING_BUCKET is not set: set it before the real run.')
  }
  for (const id of report.missing) {
    console.log(`Pending photo ${id} has no original left: pnpm photos:moderate reject ${id}`)
  }
  for (const key of report.kept) console.log(`Kept (an approved photo, or a pending one that did not move, uses it): ${key}`)
  console.log(`${report.purgeUrls.length} public object(s) ${would}deleted.`)
  if (report.purgeUrls.length > 0) {
    console.log(
      dryRun
        ? 'After the real run, purge these from the Cloudflare cache:'
        : 'Purge these from the Cloudflare cache (or purge the prefix photos.tinyhike.com/uploads/):',
    )
    for (const url of report.purgeUrls) console.log(`  ${url}`)
  }
}

async function main() {
  const [command, id, ...rest] = process.argv.slice(2)

  switch (command) {
    case 'list':
      return list(id)
    case 'approve': {
      if (!id) throw new UsageError('approve needs a photo id')
      const result = await approvePhoto(prisma, id, { log })
      console.log(`Approved ${result.id}: ${result.r2Url}`)
      printPurge(result)
      return
    }
    case 'reject': {
      if (!id) throw new UsageError('reject needs a photo id')
      const note = rest.join(' ').trim() || undefined
      if (note && note.length > 500) throw new UsageError('note is limited to 500 characters')
      const result = await rejectPhoto(prisma, id, { moderationNote: note, log })
      console.log(`Rejected ${result.id}.`)
      printPurge(result)
      return
    }
    case 'purge-legacy':
      return purgeLegacy(id)
    default:
      throw new UsageError(command ? `Unknown command "${command}"` : 'No command given')
  }
}

main()
  .catch((err: unknown) => {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n\n${USAGE}`)
    } else if (err instanceof PhotoModerationError) {
      console.error(`${err.code}: ${err.message}`)
    } else {
      console.error('photo moderation failed:', err)
    }
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
