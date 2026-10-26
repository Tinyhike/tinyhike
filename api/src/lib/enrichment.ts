/**
 * Which places Claude enrichment may describe. Kept apart from jobs/enrich.ts,
 * which creates its Prisma and Anthropic clients on load, so the rule can be tested.
 */

import type { Prisma } from '@prisma/client'
import { publicPlaceWhere } from './place-visibility.js'

/**
 * Un-enriched = OSM-origin, public, and Claude hasn't written descriptions yet.
 * enrichedAt is the single canonical "needs enrichment" signal; source is provenance
 * only (never mutated by enrichment), so enriched OSM places keep source='OSM'.
 *
 * Public only (Jérôme, 26 Oct 2026): a hidden place (an unverified café) has no
 * page anyone can open, so describing it would spend Claude calls for nothing.
 * AND rather than a spread, so a key added on either side can never replace the
 * visibility rule's own OR.
 */
export const UNENRICHED_WHERE = {
  AND: [publicPlaceWhere, { source: 'OSM', enrichedAt: null }],
} satisfies Prisma.PlaceWhereInput
