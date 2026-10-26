/**
 * Playground details from OpenStreetMap: the age range a playground is meant for
 * (`min_age`, `max_age`) and the kinds of play equipment it has (`playground=*`).
 * Used by jobs/backfill-playground-details.ts.
 *
 * Coverage in Rotterdam is thin (measured read-only on 26 Oct 2026, 882 OSM
 * playgrounds): min_age on 1, max_age on 3; equipment mapped inside 62 of the 775
 * playgrounds drawn as areas, and a `playground=*` value on 8 playgrounds
 * themselves. The import keeps whatever OSM has, so it grows as OSM does.
 *
 * In OSM, equipment is usually mapped as separate features (`playground=swing`,
 * `playground=slide`…) inside the playground's outline, not as tags on the
 * playground. Attaching them needs each playground's geometry and a
 * point-in-polygon test, which the places query (`out center`) doesn't provide.
 * Playgrounds mapped as a single node have no outline: they only get their own tags.
 */

import { osmIdFor, type OverpassElement } from './osm.js'

export interface GeoPoint {
  lat: number
  lon: number
}

/** An element as `out geom` returns it: ways carry their nodes, relations their members'. */
export interface GeometryElement extends OverpassElement {
  geometry?: GeoPoint[]
  members?: Array<{ type: string; role: string; geometry?: GeoPoint[] }>
}

/**
 * Two blocks: the playgrounds with their full geometry, then every equipment
 * feature with a representative point. Same bbox as the places query.
 */
export const playgroundDetailsQuery = (bbox: string) => `
[out:json][timeout:180];
nwr["leisure"="playground"](${bbox});
out geom;
nwr["playground"](${bbox});
out center tags;`

type Edge = [GeoPoint, GeoPoint]

/**
 * The outline of a way or multipolygon as a bag of edges. For a relation, every
 * member way counts, inner rings included: with the even-odd rule in contains(),
 * holes need no special case, and outer rings split over several ways need no
 * reassembly.
 */
export function edgesOf(el: GeometryElement): Edge[] {
  const lines = el.geometry ? [el.geometry] : (el.members ?? []).flatMap((m) => (m.geometry ? [m.geometry] : []))
  const edges: Edge[] = []
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) edges.push([line[i - 1], line[i]])
  }
  return edges
}

/** Even-odd ray casting: whether `point` lies inside the outline made of `edges`. */
export function contains(edges: Edge[], point: GeoPoint): boolean {
  let inside = false
  for (const [a, b] of edges) {
    if (a.lat > point.lat !== b.lat > point.lat) {
      const lonAtLat = a.lon + ((point.lat - a.lat) * (b.lon - a.lon)) / (b.lat - a.lat)
      if (point.lon < lonAtLat) inside = !inside
    }
  }
  return inside
}

/** An age in whole years, 0 to 18. Anything else ("3 years", "toddlers", 99) is unknown. */
export function parseAge(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,2}$/.test(value.trim())) return null
  const age = Number(value.trim())
  return age <= 18 ? age : null
}

/** OSM values that say "there is equipment" without saying which. */
const NOT_A_KIND = new Set(['yes', 'no'])

/**
 * The equipment kinds an element names: `playground=swing;slide` gives both.
 * Values are OSM's own words (swing, slide, sandpit, springy…), kept as they are
 * for the sheet to label; free text that isn't a plain key is dropped. A swing
 * tagged baby=yes is a baby swing, the one thing on a playground that is for
 * TinyHike's youngest users.
 */
export function equipmentKinds(tags: Record<string, string> | undefined): string[] {
  if (!tags?.playground) return []
  const kinds = tags.playground
    .split(';')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => /^[a-z][a-z0-9_]{0,39}$/.test(v) && !NOT_A_KIND.has(v))
    .map((v) => (v === 'swing' && tags.baby === 'yes' ? 'baby_swing' : v))
  return [...new Set(kinds)]
}

export interface PlaygroundDetails {
  minAge: number | null
  maxAge: number | null
  playEquipment: string[]
}

function centerOf(el: OverpassElement): GeoPoint | null {
  if (el.lat !== undefined && el.lon !== undefined) return { lat: el.lat, lon: el.lon }
  return el.center ? { lat: el.center.lat, lon: el.center.lon } : null
}

/**
 * Details per playground, keyed by Place.osmId. Typed ids only: the few rows left
 * with a legacy `osm:<id>` are not playgrounds, and a bare id number could name a
 * node and a way at once.
 */
export function playgroundDetails(elements: GeometryElement[]): Map<string, PlaygroundDetails> {
  // An element that is both a playground and equipment comes back in both blocks;
  // the copy with geometry is the one that has an outline.
  const playgrounds = new Map<string, GeometryElement>()
  const equipment: Array<{ point: GeoPoint; kinds: string[] }> = []
  for (const el of elements) {
    if (el.tags?.leisure === 'playground') {
      const key = osmIdFor(el)
      const known = playgrounds.get(key)
      if (!known || (!known.geometry && !known.members)) playgrounds.set(key, el)
      continue
    }
    const kinds = equipmentKinds(el.tags)
    const point = centerOf(el)
    if (kinds.length > 0 && point) equipment.push({ point, kinds })
  }

  const out = new Map<string, PlaygroundDetails>()
  for (const [key, pg] of playgrounds) {
    const kinds = new Set(equipmentKinds(pg.tags))
    const edges = edgesOf(pg)
    if (edges.length > 0) {
      for (const item of equipment) {
        if (contains(edges, item.point)) item.kinds.forEach((k) => kinds.add(k))
      }
    }
    const details: PlaygroundDetails = {
      minAge: parseAge(pg.tags?.min_age),
      maxAge: parseAge(pg.tags?.max_age),
      playEquipment: [...kinds].sort(),
    }
    // A reversed range is a mapping error: keep neither bound rather than guess.
    if (details.minAge !== null && details.maxAge !== null && details.minAge > details.maxAge) {
      details.minAge = null
      details.maxAge = null
    }
    out.set(key, details)
  }
  return out
}

/**
 * What to write to one place: only the fields it doesn't have yet (null age, empty
 * equipment list), the backfill's rule, so a value set by hand is never replaced.
 */
export function playgroundUpdate(
  details: PlaygroundDetails,
  place: { minAge: number | null; maxAge: number | null; playEquipment: string[] },
): Partial<PlaygroundDetails> {
  const data: Partial<PlaygroundDetails> = {}
  // Each bound is filled on its own, so check the range the row would end up with:
  // a max kept from an earlier run and a min from today's OSM can cross.
  const minAge = place.minAge ?? details.minAge
  const maxAge = place.maxAge ?? details.maxAge
  const rangeOk = minAge === null || maxAge === null || minAge <= maxAge
  if (rangeOk && place.minAge === null && details.minAge !== null) data.minAge = details.minAge
  if (rangeOk && place.maxAge === null && details.maxAge !== null) data.maxAge = details.maxAge
  if (place.playEquipment.length === 0 && details.playEquipment.length > 0) data.playEquipment = details.playEquipment
  return data
}
