/**
 * Overnight enrichment job — called by n8n cron at 02:30
 * Takes up to 50 PENDING places with no translations description
 * and asks Claude to generate name + description + tips in nl/fr/en
 *
 * Usage: npm run enrich:pending
 */

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const claude = new Anthropic()

const BATCH = 50
const LOCALES = ['nl', 'fr', 'en'] as const

async function enrich() {
  const places = await prisma.place.findMany({
    where: {
      status: 'PENDING',
      source: { in: ['OSM', 'CLAUDE'] },
      translations: { none: { description: { not: null } } },
    },
    include: { translations: true },
    take: BATCH,
  })

  console.log(`Enriching ${places.length} places…`)

  for (const place of places) {
    const existingName = place.translations[0]?.name ?? `Place at ${place.lat},${place.lng}`

    const prompt = `You are enriching a family-friendly hiking spot database.
Place name (original): ${existingName}
Coordinates: ${place.lat}, ${place.lng}

Generate a short name (max 40 chars), a 2-sentence description, and 1-sentence practical tip
for a parent pushing a stroller. Return JSON:
{ "nl": { "name": "", "description": "", "tips": "" },
  "fr": { "name": "", "description": "", "tips": "" },
  "en": { "name": "", "description": "", "tips": "" } }`

    try {
      const msg = await claude.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      })

      const raw = (msg.content[0] as { type: string; text: string }).text
      const json = JSON.parse(raw.match(/\{[\s\S]+\}/)?.[0] ?? '{}')

      for (const locale of LOCALES) {
        if (!json[locale]) continue
        await prisma.placeTranslation.upsert({
          where: { placeId_locale: { placeId: place.id, locale } },
          create: { placeId: place.id, locale, ...json[locale] },
          update: { ...json[locale] },
        })
      }

      await prisma.place.update({ where: { id: place.id }, data: { source: 'CLAUDE' } })
      console.log(`  ✓ ${existingName}`)
    } catch (err) {
      console.error(`  ✗ ${existingName}:`, err)
    }
  }

  await prisma.$disconnect()
}

enrich()
