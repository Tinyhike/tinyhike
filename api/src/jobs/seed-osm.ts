/**
 * Seed places from the OpenStreetMap Overpass API for a given city bbox.
 * Fetches parks, playgrounds, cafes suitable for stroller hikes.
 *
 * Usage: BBOX="51.8,4.4,51.95,4.6" pnpm seed:osm
 * BBOX is Overpass order: south,west,north,east (minLat,minLon,maxLat,maxLon).
 *
 * The query and the OSM-tag mapping live in lib/osm.ts, shared with
 * backfill-osm-tags.ts so the two can't drift apart.
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { fetchOverpass, mapOsmTags, DEFAULT_BBOX } from '../lib/osm.js'

const prisma = new PrismaClient()

async function seed() {
  const bbox = process.env.BBOX ?? DEFAULT_BBOX
  const elements = await fetchOverpass(bbox)

  let created = 0
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat
    const lng = el.lon ?? el.center?.lon
    const name = el.tags?.name
    if (!lat || !lng || !name) continue

    const osmId = `osm:${el.id}`
    const existing = await prisma.place.findUnique({ where: { osmId } })
    if (existing) continue

    await prisma.place.create({
      data: {
        lat,
        lng,
        osmId,
        source: 'OSM',
        status: 'APPROVED', // OSM is a trusted source — auto-approve (moderation decision, see ROADMAP)
        // The original seeder asked for `out center tags` and then read only `name`,
        // throwing away every attribute OSM sent. That's why the first 381 places
        // had all eleven stroller booleans null.
        ...mapOsmTags(el.tags),
        translations: { create: { locale: 'nl', name } },
      },
    })
    created++
  }

  console.log(`Seeded ${created} places from OSM (bbox: ${bbox})`)
  await prisma.$disconnect()
}

seed().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
