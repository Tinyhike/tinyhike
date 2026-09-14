/**
 * Backfill the stroller booleans on places already seeded from OSM.
 *
 * The original seeder asked Overpass for `out center tags` and then read only
 * `name`, discarding every attribute OSM had sent — so all 381 Rotterdam places
 * carry null for all eleven tags. This re-fetches the same bbox and fills them in.
 *
 * Safe to re-run: it only writes fields that are currently null, so a value a user
 * (or Claude) has set is never overwritten. Nothing is deleted, nothing is set to
 * false unless OSM explicitly says so.
 *
 * Usage:  pnpm backfill:osm-tags            (Rotterdam bbox)
 *         BBOX="…" pnpm backfill:osm-tags
 *         DRY_RUN=1 pnpm backfill:osm-tags  (report only, no writes)
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { fetchOverpass, mapOsmTags, onlyMissing, DEFAULT_BBOX, type StrollerTags } from '../lib/osm.js'

const prisma = new PrismaClient()

async function backfill() {
  const bbox = process.env.BBOX ?? DEFAULT_BBOX
  const dryRun = process.env.DRY_RUN === '1'

  console.log(`Fetching Overpass for bbox ${bbox}…`)
  const elements = await fetchOverpass(bbox)
  console.log(`${elements.length} elements returned.`)

  // osmId is stored as `osm:<id>` — see seed-osm.ts.
  const byOsmId = new Map(elements.map((el) => [`osm:${el.id}`, el.tags]))

  const places = await prisma.place.findMany({
    where: { source: 'OSM', osmId: { not: null } },
  })
  console.log(`${places.length} OSM places in the database.\n`)

  const applied: Record<string, number> = {}
  let updated = 0
  let unmatched = 0

  for (const place of places) {
    const tags = byOsmId.get(place.osmId!)
    if (tags === undefined) {
      // The element no longer matches the query (deleted upstream, retagged, or
      // outside this bbox). Leave the place exactly as it is.
      unmatched++
      continue
    }

    const data = onlyMissing(mapOsmTags(tags), place as unknown as Record<string, unknown>)
    const keys = Object.keys(data) as Array<keyof StrollerTags>
    if (keys.length === 0) continue

    for (const key of keys) applied[key] = (applied[key] ?? 0) + 1
    if (!dryRun) await prisma.place.update({ where: { id: place.id }, data })
    updated++
  }

  console.log(`${dryRun ? '[DRY RUN] would update' : 'Updated'} ${updated} places (${unmatched} had no matching OSM element).`)
  console.log('\nfields set:')
  for (const [key, count] of Object.entries(applied).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(15)} ${count}`)
  }
  if (Object.keys(applied).length === 0) console.log('  (none)')

  await prisma.$disconnect()
}

backfill().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
