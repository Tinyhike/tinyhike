import { describe, it, expect } from 'vitest'
import {
  mapOsmTags,
  onlyMissing,
  osmIdFor,
  isSameFeature,
  elementCoords,
  overpassQuery,
  translationsFor,
  kindOf,
} from '../src/lib/osm.js'

describe('overpassQuery', () => {
  it('asks for nodes, ways and relations', () => {
    // The original query took playgrounds as nodes only. In OSM a playground is
    // normally an area, so that missed 10 of the 12 present around Delfshaven.
    const q = overpassQuery('51.8,4.4,51.95,4.6')
    expect(q).toContain('nwr["leisure"~"^(park|playground)$"]')
    expect(q).toContain('out center tags') // areas need a representative point
  })
})

describe('osmIdFor', () => {
  it('keeps ids from colliding across element types', () => {
    // node 123 and way 123 are unrelated objects, and Place.osmId is unique — the
    // untyped `osm:123` form would make one of them fail to insert.
    expect(osmIdFor({ id: 123, type: 'node' })).toBe('osm:node/123')
    expect(osmIdFor({ id: 123, type: 'way' })).toBe('osm:way/123')
    expect(osmIdFor({ id: 123, type: 'node' })).not.toBe(osmIdFor({ id: 123, type: 'way' }))
  })
})

describe('elementCoords', () => {
  it('reads a node’s own position', () => {
    expect(elementCoords({ id: 1, lat: 51.92, lon: 4.48 })).toEqual({ lat: 51.92, lng: 4.48 })
  })

  it('falls back to the computed centre for ways and relations', () => {
    expect(elementCoords({ id: 1, center: { lat: 51.92, lon: 4.48 } })).toEqual({ lat: 51.92, lng: 4.48 })
  })

  it('returns null when neither is present', () => {
    expect(elementCoords({ id: 1 })).toBeNull()
  })
})

describe('isSameFeature', () => {
  it('accepts a legacy row sitting at the same spot', () => {
    expect(isSameFeature({ id: 1, lat: 51.92, lon: 4.48 }, { lat: 51.92, lng: 4.48 })).toBe(true)
  })

  it('rejects an unrelated object that merely shares an id number', () => {
    expect(isSameFeature({ id: 1, lat: 51.92, lon: 4.48 }, { lat: 51.88, lng: 4.51 })).toBe(false)
  })
})

describe('mapOsmTags', () => {
  it('returns nothing for an element with no tags', () => {
    expect(mapOsmTags(undefined)).toEqual({})
    expect(mapOsmTags({})).toEqual({})
  })

  it('treats a missing key as unknown, never as a "no"', () => {
    // The whole point: an OSM playground with no `toilets` key doesn't mean there
    // are no toilets, it means nobody recorded it. Claiming false here would send a
    // parent somewhere on a promise we never had grounds to make.
    const mapped = mapOsmTags({ leisure: 'playground', name: 'Speeltuin' })
    expect(mapped.hasToilets).toBeUndefined()
    expect(mapped.wheelchairOk).toBeUndefined()
    expect(mapped.freeEntry).toBeUndefined()
    expect(mapped.hasPlayground).toBe(true) // the one thing OSM did state
  })

  it('maps wheelchair yes/no, and leaves "limited" unknown', () => {
    expect(mapOsmTags({ wheelchair: 'yes' }).wheelchairOk).toBe(true)
    expect(mapOsmTags({ wheelchair: 'no' }).wheelchairOk).toBe(false)
    // "limited" could be one kerb or a flight of steps — we can't tell, so we don't say.
    expect(mapOsmTags({ wheelchair: 'limited' }).wheelchairOk).toBeUndefined()
  })

  it('reads toilets from any of the three ways OSM expresses them', () => {
    expect(mapOsmTags({ toilets: 'yes' }).hasToilets).toBe(true)
    expect(mapOsmTags({ amenity: 'toilets' }).hasToilets).toBe(true)
    expect(mapOsmTags({ 'toilets:wheelchair': 'yes' }).hasToilets).toBe(true)
    expect(mapOsmTags({ toilets: 'no' }).hasToilets).toBe(false)
  })

  it('derives smoothness from the surface, both ways', () => {
    expect(mapOsmTags({ surface: 'asphalt' }).smooth).toBe(true)
    expect(mapOsmTags({ surface: 'paving_stones' }).smooth).toBe(true)
    expect(mapOsmTags({ surface: 'sand' }).smooth).toBe(false)
    expect(mapOsmTags({ surface: 'cobblestone' }).smooth).toBe(false)
    expect(mapOsmTags({ surface: 'something_unheard_of' }).smooth).toBeUndefined()
  })

  it('maps fee, dog and cafe', () => {
    expect(mapOsmTags({ fee: 'no' }).freeEntry).toBe(true)
    expect(mapOsmTags({ fee: 'yes' }).freeEntry).toBe(false)
    expect(mapOsmTags({ dog: 'leashed' }).dogFriendly).toBe(true)
    expect(mapOsmTags({ dog: 'no' }).dogFriendly).toBe(false)
    expect(mapOsmTags({ amenity: 'cafe' }).hasCafe).toBe(true)
  })

  it('never infers the three judgement tags', () => {
    // napFriendly / shaded have no OSM equivalent; enclosed needs a barrier that is
    // almost never mapped on the point itself. These belong to Claude or to reviews.
    const mapped = mapOsmTags({ leisure: 'park', surface: 'asphalt', wheelchair: 'yes', natural: 'wood' })
    expect(mapped.napFriendly).toBeUndefined()
    expect(mapped.shaded).toBeUndefined()
    expect(mapped.enclosed).toBeUndefined()
  })
})

describe('translationsFor', () => {
  it('keeps a real OSM name as-is, in nl only', () => {
    // A proper noun isn't translated; enrichment supplies fr/en afterwards.
    expect(translationsFor('Speelpark BoTu', 'playground')).toEqual([{ locale: 'nl', name: 'Speelpark BoTu' }])
  })

  it('gives an unnamed feature a generic name in all three locales', () => {
    // Most OSM playgrounds have no name, and they're exactly what a parent wants on
    // the map — dropping them left the map emptiest where it mattered most.
    const rows = translationsFor(undefined, 'playground')
    expect(rows).toHaveLength(3)
    expect(rows).toContainEqual({ locale: 'nl', name: 'Speeltuin' })
    expect(rows).toContainEqual({ locale: 'fr', name: 'Aire de jeux' })
    expect(rows).toContainEqual({ locale: 'en', name: 'Playground' })
  })

  it('produces nothing for an unnamed feature of no recognised kind', () => {
    expect(translationsFor(undefined, null)).toEqual([])
  })
})

describe('kindOf', () => {
  it('recognises the four kinds the query selects for', () => {
    expect(kindOf({ leisure: 'playground' })).toBe('playground')
    expect(kindOf({ leisure: 'park' })).toBe('park')
    expect(kindOf({ amenity: 'cafe' })).toBe('cafe')
    expect(kindOf({ tourism: 'picnic_site' })).toBe('picnic_site')
  })

  it('returns null for anything else', () => {
    expect(kindOf({ amenity: 'pharmacy' })).toBeNull()
    expect(kindOf(undefined)).toBeNull()
  })
})

describe('onlyMissing', () => {
  it('keeps fields that are currently null', () => {
    expect(onlyMissing({ smooth: true }, { smooth: null })).toEqual({ smooth: true })
  })

  it('never overwrites a value a human already set', () => {
    // A parent who reported "not smooth" outranks whatever OSM says.
    expect(onlyMissing({ smooth: true }, { smooth: false })).toEqual({})
    expect(onlyMissing({ smooth: false }, { smooth: true })).toEqual({})
  })

  it('filters a mixed mapping down to only the unset fields', () => {
    const result = onlyMissing(
      { smooth: true, hasToilets: true, wheelchairOk: false },
      { smooth: null, hasToilets: true, wheelchairOk: null },
    )
    expect(result).toEqual({ smooth: true, wheelchairOk: false })
  })
})
