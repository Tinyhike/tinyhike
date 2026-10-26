/**
 * Backfill the stroller booleans, and the category, on places already seeded from OSM.
 *
 * The original seeder asked Overpass for `out center tags` and then read only
 * `name`, discarding every attribute OSM had sent — so all 381 Rotterdam places
 * carry null for all eleven tags. This re-fetches the same bbox and fills them in.
 *
 * It also fills Place.category (26 Oct 2026), which decides what the public sees
 * (lib/place-visibility.ts). It must run before an API that filters on category is
 * deployed: a null category is hidden. Places whose OSM element is gone keep a null
 * category, so they stay hidden until an admin verifies them.
 *
 * Safe to re-run: it only writes fields that are currently null, so a value a user
 * (or Claude, or an admin's visit) has set is never overwritten. Nothing is
 * deleted, nothing is set to false unless OSM explicitly says so.
 *
 * Usage:  pnpm backfill:osm-tags            (Rotterdam bbox)
 *         BBOX="…" pnpm backfill:osm-tags
 *         DRY_RUN=1 pnpm backfill:osm-tags  (report only, no writes)
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
  fetchOverpass,
  backfillUpdate,
  categoryOf,
  osmIdFor,
  legacyOsmId,
  DEFAULT_BBOX,
} from '../lib/osm.js'

const prisma = new PrismaClient()

async function backfill() {
  const bbox = process.env.BBOX ?? DEFAULT_BBOX
  const dryRun = process.env.DRY_RUN === '1'

  console.log(`Fetching Overpass for bbox ${bbox}…`)
  const elements = await fetchOverpass(bbox)
  console.log(`${elements.length} elements returned.`)

  // Index under both id forms: rows seeded before ids carried their type still read
  // `osm:<id>`, and the seeder migrates them lazily.
  const byOsmId = new Map<string, Record<string, string> | undefined>()
  for (const el of elements) {
    byOsmId.set(osmIdFor(el), el.tags)
    if (!byOsmId.has(legacyOsmId(el))) byOsmId.set(legacyOsmId(el), el.tags)
  }

  const places = await prisma.place.findMany({
    where: { source: 'OSM', osmId: { not: null } },
  })
  console.log(`${places.length} OSM places in the database.\n`)

  const applied: Record<string, number> = {}
  // Category of every place once this run is through: what it has, or what it gets.
  const categories: Record<string, number> = {}
  // Cross-check: hasCafe was set by the seeder from exactly amenity=cafe, so a
  // café without it (or the reverse) would point at a mapping bug.
  const mismatches: string[] = []
  let updated = 0
  let unmatched = 0

  for (const place of places) {
    const tags = byOsmId.get(place.osmId!)
    if (tags === undefined) {
      // The element no longer matches the query (deleted upstream, retagged, or
      // outside this bbox). Leave the place exactly as it is.
      unmatched++
      const key = place.category ?? 'null (no OSM element)'
      categories[key] = (categories[key] ?? 0) + 1
      continue
    }

    const data = backfillUpdate(tags, place)
    const category = place.category ?? data.category ?? null
    categories[category ?? 'null'] = (categories[category ?? 'null'] ?? 0) + 1
    if ((categoryOf(tags) === 'CAFE') !== (place.hasCafe === true)) {
      mismatches.push(`${place.osmId} (category ${categoryOf(tags)}, hasCafe ${place.hasCafe})`)
    }

    const keys = Object.keys(data)
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

  console.log(`\ncategories ${dryRun ? 'after a real run' : 'now'}:`)
  for (const [key, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(22)} ${count}`)
  }
  console.log(`\ncafé vs hasCafe mismatches: ${mismatches.length}`)
  for (const line of mismatches) console.log(`  ${line}`)

  await prisma.$disconnect()
}

backfill().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
