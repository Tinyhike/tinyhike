import { describe, it, expect } from 'vitest'
import { mapOsmTags, onlyMissing } from '../src/lib/osm.js'

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
