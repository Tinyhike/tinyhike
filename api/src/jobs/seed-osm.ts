/**
 * Seed places from the OpenStreetMap Overpass API for a given city bbox.
 * Fetches parks, playgrounds, cafes and picnic sites suitable for stroller hikes.
 *
 * Usage: BBOX="51.8,4.4,51.95,4.6" pnpm seed:osm
 * BBOX is Overpass order: south,west,north,east (minLat,minLon,maxLat,maxLon).
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
  DEFAULT_BBOX,
} from '../lib/osm.js'

const prisma = new PrismaClient()

async function seed() {
  const bbox = process.env.BBOX ?? DEFAULT_BBOX
  const elements = await fetchOverpass(bbox)
  console.log(`${elements.length} elements returned for bbox ${bbox}.`)

  let created = 0
  let skipped = 0
  let migrated = 0
  let unnamed = 0

  for (const el of elements) {
    const coords = elementCoords(el)
    if (!coords) continue

    // Unnamed features used to be dropped, which quietly cost us most playgrounds —
    // in OSM they rarely carry a name. They now get a generic name per kind.
    const translations = translationsFor(el.tags?.name, kindOf(el.tags))
    if (translations.length === 0) continue
    if (!el.tags?.name) unnamed++

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
      await prisma.place.update({ where: { id: legacy.id }, data: { osmId } })
      migrated++
      continue
    }

    await prisma.place.create({
      data: {
        lat: coords.lat,
        lng: coords.lng,
        osmId,
        source: 'OSM',
        status: 'APPROVED', // OSM is a trusted source — auto-approve (moderation decision, see ROADMAP)
        // The original seeder asked for `out center tags` and then read only `name`,
        // throwing away every attribute OSM sent. That's why the first 381 places
        // had all eleven stroller booleans null.
        ...mapOsmTags(el.tags),
        translations: { create: translations },
      },
    })
    created++
  }

  console.log(
    `Seeded ${created} new places (${unnamed} of them unnamed in OSM, given a generic name); ` +
      `${skipped} already known, ${migrated} ids migrated to typed form.`,
  )
  await prisma.$disconnect()
}

seed().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
