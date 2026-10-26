/**
 * Import playground details from OSM: age range (min_age / max_age) and the kinds
 * of play equipment mapped inside each playground (`playground=*`). See
 * lib/osm-playgrounds.ts for how equipment is attached to a playground, and for
 * the coverage measured in Rotterdam (thin).
 *
 * Safe to re-run, same rule as backfill-osm-tags.ts: it only fills what a place
 * doesn't have yet (null age, empty equipment list), never replaces a value.
 * The place sheet doesn't show these fields yet.
 *
 * Usage:  pnpm backfill:playgrounds            (Rotterdam bbox)
 *         BBOX="…" pnpm backfill:playgrounds
 *         DRY_RUN=1 pnpm backfill:playgrounds  (report only, no writes)
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { fetchOverpass, DEFAULT_BBOX } from '../lib/osm.js'
import {
  playgroundDetails,
  playgroundDetailsQuery,
  playgroundUpdate,
  type GeometryElement,
} from '../lib/osm-playgrounds.js'

const prisma = new PrismaClient()

async function backfill() {
  const bbox = process.env.BBOX ?? DEFAULT_BBOX
  const dryRun = process.env.DRY_RUN === '1'

  console.log(`Fetching playgrounds and equipment from Overpass for bbox ${bbox}…`)
  const elements = await fetchOverpass<GeometryElement>(bbox, playgroundDetailsQuery)
  const details = playgroundDetails(elements)
  console.log(`${elements.length} elements returned, ${details.size} playgrounds.`)

  const places = await prisma.place.findMany({
    where: { source: 'OSM', osmId: { not: null } },
    select: { id: true, osmId: true, minAge: true, maxAge: true, playEquipment: true },
  })

  let matched = 0
  let withAge = 0
  let withEquipment = 0
  let updated = 0
  const kinds: Record<string, number> = {}
  const applied: Record<string, number> = {}
  // Which places change, and to what: the run is reviewed from this list.
  const changes: string[] = []

  for (const place of places) {
    const found = details.get(place.osmId!)
    if (!found) continue
    matched++
    if (found.minAge !== null || found.maxAge !== null) withAge++
    if (found.playEquipment.length > 0) withEquipment++
    for (const kind of found.playEquipment) kinds[kind] = (kinds[kind] ?? 0) + 1

    const data = playgroundUpdate(found, place)
    const keys = Object.keys(data)
    if (keys.length === 0) continue
    for (const key of keys) applied[key] = (applied[key] ?? 0) + 1
    changes.push(`${place.osmId} ${JSON.stringify(data)}`)
    if (!dryRun) await prisma.place.update({ where: { id: place.id }, data })
    updated++
  }

  console.log(`\n${matched} places matched an OSM playground:`)
  console.log(`  with an age (min_age or max_age)  ${withAge}`)
  console.log(`  with at least one equipment kind  ${withEquipment}`)
  console.log(`\n${dryRun ? '[DRY RUN] would update' : 'Updated'} ${updated} places.`)
  for (const [key, count] of Object.entries(applied)) console.log(`  ${key.padEnd(14)} ${count}`)
  for (const line of changes) console.log(`  ${line}`)
  console.log('\nequipment kinds (places having each):')
  for (const [kind, count] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(18)} ${count}`)
  }

  await prisma.$disconnect()
}

backfill().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
