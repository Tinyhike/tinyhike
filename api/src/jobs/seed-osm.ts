/**
 * Seed places from the OpenStreetMap Overpass API for a given city bbox.
 * Fetches parks, playgrounds, cafes, brunch restaurants (imported as cafés) and
 * picnic sites suitable for stroller hikes.
 *
 * Usage: BBOX="51.8,4.4,51.95,4.6" pnpm seed:osm
 *        DRY_RUN=1 pnpm seed:osm            (lists what it would add, writes nothing)
 *        ONLY=amenity=restaurant pnpm seed:osm   (adds only elements with that tag)
 * BBOX is Overpass order: south,west,north,east (minLat,minLon,maxLat,maxLon).
 *
 * ONLY narrows a run to the elements carrying one tag, so widening the query for
 * one kind of place doesn't also bring in whatever else OSM gained since the
 * last seed: on 26 Oct 2026 that was ~30 playgrounds and 7 parks, which go
 * public at once.
 *
 * The query and the OSM-tag mapping live in lib/osm.ts, shared with
 * backfill-osm-tags.ts so the two can't drift.
 *
 * Re-running is safe: existing places are skipped, never duplicated or overwritten.
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
  fetchOverpass,
  mapOsmTags,
  osmIdFor,
  legacyOsmId,
  isSameFeature,
  elementCoords,
  translationsFor,
  kindOf,
  categoryOf,
  accessOf,
  DEFAULT_BBOX,
} from '../lib/osm.js'

const prisma = new PrismaClient()

/** What OSM files an element under, for the dry-run list: `amenity=restaurant cuisine=pancake`. */
function osmKind(tags: Record<string, string> | undefined): string {
  return ['leisure', 'amenity', 'tourism', 'cuisine', 'access']
    .filter((key) => tags?.[key])
    .map((key) => `${key}=${tags![key]}`)
    .join(' ')
}

async function seed() {
  const bbox = process.env.BBOX ?? DEFAULT_BBOX
  const dryRun = process.env.DRY_RUN === '1'
  const only = process.env.ONLY
  const [onlyKey, onlyValue] = only?.split('=') ?? []
  if (only !== undefined && (!onlyKey || !onlyValue)) throw new Error(`ONLY must read key=value, not "${only}"`)

  const elements = await fetchOverpass(bbox)
  console.log(`${elements.length} elements returned for bbox ${bbox}.`)

  let created = 0
  let skipped = 0
  let migrated = 0
  let unnamed = 0
  let leftOut = 0
  const planned: string[] = []

  for (const el of elements) {
    const coords = elementCoords(el)
    if (!coords) continue

    // Unnamed features used to be dropped, which quietly cost us most playgrounds —
    // in OSM they rarely carry a name. They now get a generic name per kind.
    const translations = translationsFor(el.tags?.name, kindOf(el.tags))
    if (translations.length === 0) continue

    const osmId = osmIdFor(el)
    if (await prisma.place.findUnique({ where: { osmId } })) {
      skipped++
      continue
    }

    // Rows seeded before ids carried their type are stored as `osm:<id>`. Adopt one
    // only when the coordinates agree, so a node and a way sharing an id number
    // can't be mistaken for each other.
    const legacy = await prisma.place.findUnique({ where: { osmId: legacyOsmId(el) } })
    if (legacy && isSameFeature(el, legacy)) {
      if (!dryRun) await prisma.place.update({ where: { id: legacy.id }, data: { osmId } })
      migrated++
      continue
    }

    if (only && el.tags?.[onlyKey] !== onlyValue) {
      leftOut++
      continue
    }
    const category = categoryOf(el.tags)
    if (!el.tags?.name) unnamed++
    created++

    if (dryRun) {
      planned.push(`${(category ?? 'none').padEnd(11)} ${translations[0].name.padEnd(36)} ${osmId.padEnd(22)} ${osmKind(el.tags)}`)
      continue
    }

    await prisma.place.create({
      data: {
        lat: coords.lat,
        lng: coords.lng,
        osmId,
        source: 'OSM',
        status: 'APPROVED', // OSM is a trusted source — auto-approve (moderation decision, see ROADMAP)
        // Approved is not public: a café stays hidden until an admin verifies it
        // (lib/place-visibility.ts).
        category,
        // access=private is hidden too, unless verified; customers gets a mention.
        access: accessOf(el.tags),
        // The original seeder asked for `out center tags` and then read only `name`,
        // throwing away every attribute OSM sent. That's why the first 381 places
        // had all eleven stroller booleans null.
        ...mapOsmTags(el.tags),
        translations: { create: translations },
      },
    })
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] would add ${created} places${only ? ` (ONLY=${only})` : ''}:`)
    for (const line of planned.sort()) console.log(`  ${line}`)
  }
  console.log(
    `\n${dryRun ? '[DRY RUN] would seed' : 'Seeded'} ${created} new places (${unnamed} of them unnamed in OSM, given a generic name); ` +
      `${skipped} already known, ${migrated} ids ${dryRun ? 'to migrate' : 'migrated'} to typed form` +
      (only ? `, ${leftOut} new ones without ${only} left out.` : '.'),
  )
  await prisma.$disconnect()
}

seed().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
