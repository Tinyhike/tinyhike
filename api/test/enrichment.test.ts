import { describe, it, expect } from 'vitest'
import { UNENRICHED_WHERE } from '../src/lib/enrichment.js'
import { publicPlaceWhere } from '../src/lib/place-visibility.js'

describe('UNENRICHED_WHERE', () => {
  it('only ever selects public, OSM, not-yet-enriched places: never a hidden café', () => {
    expect(UNENRICHED_WHERE).toEqual({ AND: [publicPlaceWhere, { source: 'OSM', enrichedAt: null }] })
  })

  it('keeps the visibility rule intact when the job adds its own keys', () => {
    // enrich.ts spreads it with `id: { notIn: seen }`: the rule sits under AND,
    // where no added key can replace its OR.
    const where = { ...UNENRICHED_WHERE, id: { notIn: ['a'] } }
    expect(where.AND[0]).toBe(publicPlaceWhere)
    expect((where.AND[0] as typeof publicPlaceWhere).OR).toEqual([
      { category: { in: ['PLAYGROUND', 'PARK', 'PICNIC_SITE'] } },
      { verifiedAt: { not: null } },
    ])
  })
})
