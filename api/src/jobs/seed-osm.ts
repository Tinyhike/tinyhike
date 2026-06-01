/**
 * Seed places from OpenStreetMap Overpass API for a given city bbox.
 * Fetches parks, playgrounds, cafes suitable for stroller hikes.
 *
 * Usage: BBOX="4.4,51.8,4.6,51.95" npm run seed:osm
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const OVERPASS = 'https://overpass-api.de/api/interpreter'

const QUERY = (bbox: string) => `
[out:json][timeout:30];
(
  node["leisure"="playground"](${bbox});
  node["leisure"="park"](${bbox});
  node["amenity"="cafe"](${bbox});
  node["tourism"="picnic_site"](${bbox});
  way["leisure"="park"](${bbox});
);
out center tags;`

async function seed() {
  const bbox = process.env.BBOX ?? '4.4,51.8,4.6,51.95' // Rotterdam default
  const res = await fetch(OVERPASS, {
    method: 'POST',
    body: `data=${encodeURIComponent(QUERY(bbox))}`,
  })
  const data = (await res.json()) as { elements: Array<{ id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> }

  let created = 0
  for (const el of data.elements) {
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
        status: 'PENDING',
        translations: { create: { locale: 'nl', name } },
      },
    })
    created++
  }

  console.log(`Seeded ${created} places from OSM (bbox: ${bbox})`)
  await prisma.$disconnect()
}

seed()
