import { describe, it, expect } from 'vitest'
import {
  contains,
  edgesOf,
  equipmentKinds,
  parseAge,
  playgroundDetails,
  playgroundDetailsQuery,
  playgroundUpdate,
  type GeometryElement,
  type GeoPoint,
} from '../src/lib/osm-playgrounds.js'

/** A closed square ring, south-west corner at (lat, lon), side `d` degrees. */
function square(lat: number, lon: number, d: number): GeoPoint[] {
  return [
    { lat, lon },
    { lat, lon: lon + d },
    { lat: lat + d, lon: lon + d },
    { lat: lat + d, lon },
    { lat, lon },
  ]
}

const at = (lat: number, lon: number) => ({ lat, lon })

describe('playgroundDetailsQuery', () => {
  it('asks for playground outlines, then equipment points, in the bbox', () => {
    const q = playgroundDetailsQuery('51.8,4.4,51.95,4.6')
    expect(q).toContain('nwr["leisure"="playground"](51.8,4.4,51.95,4.6);\nout geom;')
    expect(q).toContain('nwr["playground"](51.8,4.4,51.95,4.6);\nout center tags;')
  })
})

describe('contains / edgesOf', () => {
  const way: GeometryElement = { type: 'way', id: 1, geometry: square(0, 0, 10) }

  it('tells inside from outside a drawn way', () => {
    expect(contains(edgesOf(way), at(5, 5))).toBe(true)
    expect(contains(edgesOf(way), at(15, 5))).toBe(false)
    expect(contains(edgesOf(way), at(5, -1))).toBe(false)
  })

  it('handles a multipolygon with a hole', () => {
    const rel: GeometryElement = {
      type: 'relation',
      id: 2,
      members: [
        { type: 'way', role: 'outer', geometry: square(0, 0, 10) },
        { type: 'way', role: 'inner', geometry: square(4, 4, 2) },
      ],
    }
    expect(contains(edgesOf(rel), at(1, 1))).toBe(true)
    expect(contains(edgesOf(rel), at(5, 5))).toBe(false)
  })

  it('handles an outer ring split over two member ways, without reassembly', () => {
    const ring = square(0, 0, 10)
    const rel: GeometryElement = {
      type: 'relation',
      id: 3,
      members: [
        { type: 'way', role: 'outer', geometry: ring.slice(0, 3) },
        { type: 'way', role: 'outer', geometry: ring.slice(2).reverse() },
      ],
    }
    expect(contains(edgesOf(rel), at(5, 5))).toBe(true)
    expect(contains(edgesOf(rel), at(5, 11))).toBe(false)
  })

  it('a node has no outline', () => {
    expect(edgesOf({ type: 'node', id: 4, lat: 1, lon: 1 })).toEqual([])
  })
})

describe('parseAge', () => {
  it.each([
    ['0', 0],
    ['3', 3],
    [' 12 ', 12],
    ['18', 18],
  ])('reads %j as %d', (value, age) => {
    expect(parseAge(value)).toBe(age)
  })

  it.each([undefined, '', '19', '99', '-1', '3 years', '2.5', 'toddlers', '3-6'])('leaves %j unknown', (value) => {
    expect(parseAge(value)).toBeNull()
  })
})

describe('equipmentKinds', () => {
  it('splits a list and keeps OSM words', () => {
    expect(equipmentKinds({ playground: 'swing;slide; sandpit' })).toEqual(['swing', 'slide', 'sandpit'])
  })

  it('drops values that name no kind, and free text', () => {
    expect(equipmentKinds({ playground: 'yes' })).toEqual([])
    expect(equipmentKinds({ playground: 'no' })).toEqual([])
    expect(equipmentKinds({ playground: 'big red thing!' })).toEqual([])
    expect(equipmentKinds({})).toEqual([])
    expect(equipmentKinds(undefined)).toEqual([])
  })

  it('lowercases and de-duplicates', () => {
    expect(equipmentKinds({ playground: 'Swing;swing' })).toEqual(['swing'])
  })

  it('calls a swing for babies a baby swing', () => {
    expect(equipmentKinds({ playground: 'swing', baby: 'yes' })).toEqual(['baby_swing'])
    expect(equipmentKinds({ playground: 'slide', baby: 'yes' })).toEqual(['slide'])
  })
})

describe('playgroundDetails', () => {
  const area: GeometryElement = {
    type: 'way',
    id: 10,
    geometry: square(51.9, 4.4, 0.001),
    tags: { leisure: 'playground', min_age: '0', max_age: '6' },
  }
  const swingInside: GeometryElement = { type: 'node', id: 11, lat: 51.9005, lon: 4.4005, tags: { playground: 'swing' } }
  const slideInside: GeometryElement = { type: 'way', id: 12, center: at(51.9002, 4.4002), tags: { playground: 'slide' } }
  const sandpitOutside: GeometryElement = { type: 'node', id: 13, lat: 51.95, lon: 4.45, tags: { playground: 'sandpit' } }

  it('attaches the equipment inside each outline, sorted, with the own ages', () => {
    const details = playgroundDetails([area, swingInside, slideInside, sandpitOutside])
    expect(details.get('osm:way/10')).toEqual({ minAge: 0, maxAge: 6, playEquipment: ['slide', 'swing'] })
    expect(details.size).toBe(1)
  })

  it('a playground mapped as a node only gets its own tags', () => {
    const node: GeometryElement = {
      type: 'node',
      id: 20,
      lat: 51.9005,
      lon: 4.4005,
      tags: { leisure: 'playground', playground: 'springy' },
    }
    expect(playgroundDetails([node, swingInside]).get('osm:node/20')).toEqual({
      minAge: null,
      maxAge: null,
      playEquipment: ['springy'],
    })
  })

  it('keeps the outline when a playground also comes back as equipment', () => {
    const tagged = { ...area, tags: { leisure: 'playground', playground: 'structure' } }
    const asEquipment: GeometryElement = { type: 'way', id: 10, center: at(51.9005, 4.4005), tags: tagged.tags }
    const details = playgroundDetails([tagged, asEquipment, swingInside])
    expect(details.get('osm:way/10')?.playEquipment).toEqual(['structure', 'swing'])
  })

  it('a playground is not equipment of another one around it', () => {
    const inner: GeometryElement = { type: 'node', id: 30, lat: 51.9005, lon: 4.4005, tags: { leisure: 'playground', playground: 'slide' } }
    expect(playgroundDetails([area, inner]).get('osm:way/10')?.playEquipment).toEqual([])
  })

  it('drops a reversed age range rather than guess which bound is wrong', () => {
    const reversed = { ...area, tags: { leisure: 'playground', min_age: '12', max_age: '3' } }
    expect(playgroundDetails([reversed]).get('osm:way/10')).toMatchObject({ minAge: null, maxAge: null })
  })

  it('a playground with nothing mapped gets empty details, not invented ones', () => {
    const bare = { ...area, tags: { leisure: 'playground' } }
    expect(playgroundDetails([bare]).get('osm:way/10')).toEqual({ minAge: null, maxAge: null, playEquipment: [] })
  })
})

describe('playgroundUpdate', () => {
  const details = { minAge: 0, maxAge: 6, playEquipment: ['slide', 'swing'] }

  it('fills only what the place does not have', () => {
    expect(playgroundUpdate(details, { minAge: null, maxAge: null, playEquipment: [] })).toEqual(details)
    expect(playgroundUpdate(details, { minAge: 2, maxAge: null, playEquipment: ['sandpit'] })).toEqual({ maxAge: 6 })
  })

  it('never replaces a set value, the maximum age included', () => {
    expect(playgroundUpdate(details, { minAge: null, maxAge: 4, playEquipment: [] })).toEqual({
      minAge: 0,
      playEquipment: ['slide', 'swing'],
    })
    expect(playgroundUpdate(details, { minAge: 1, maxAge: 4, playEquipment: ['sandpit'] })).toEqual({})
  })

  it('writes no age when the row would end up with a reversed range', () => {
    // maxAge 6 kept from an earlier run, OSM now says 8 to 12.
    const update = playgroundUpdate({ minAge: 8, maxAge: 12, playEquipment: [] }, { minAge: null, maxAge: 6, playEquipment: [] })
    expect(update).toEqual({})
  })

  it('writes nothing when OSM says nothing', () => {
    expect(playgroundUpdate({ minAge: null, maxAge: null, playEquipment: [] }, { minAge: null, maxAge: null, playEquipment: [] })).toEqual({})
  })
})
