/**
 * One element from the OSM editing API (api.openstreetmap.org), for adding a
 * single place by hand (`pnpm places:verify add`, services/place-verification.ts).
 *
 * Not Overpass: Overpass searches the whole map and is often at capacity (502s
 * on 26 Oct 2026); the editing API answers a lookup by id directly. One request
 * per add, made by a person, is well within its usage policy.
 */

import type { OverpassElement } from './osm.js'

const OSM_API = 'https://api.openstreetmap.org/api/0.6'

export type OsmType = 'node' | 'way' | 'relation'

export interface OsmRef {
  type: OsmType
  id: number
}

/**
 * `node/11007237505`, our own `osm:node/11007237505`, or the element's
 * openstreetmap.org link pasted from the browser (`#map=…` and the like ignored).
 */
const REF = /^(?:https?:\/\/(?:www\.)?openstreetmap\.org\/|osm:)?(node|way|relation)\/(\d{1,15})(?:[/?#].*)?$/

/** The element an admin typed, or null when it names none. */
export function parseOsmRef(input: string): OsmRef | null {
  const match = REF.exec(input.trim())
  if (!match) return null
  const id = Number(match[2])
  return id > 0 ? { type: match[1] as OsmType, id } : null
}

/** A node carries its own position; a way or a relation needs `/full` to bring its nodes. */
export function osmApiUrl({ type, id }: OsmRef): string {
  return `${OSM_API}/${type}/${id}${type === 'node' ? '' : '/full'}.json`
}

interface OsmApiElement {
  type: string
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

/**
 * The element in the shape the Overpass code uses (lib/osm.ts). A node keeps its
 * lat/lon. A way or relation gets the centre of its nodes' bounding box, which is
 * what Overpass's `out center` gives, so a place added by hand sits where the
 * seeder would have put it. null when the answer doesn't contain the element.
 */
export function elementFromOsmApi(ref: OsmRef, elements: OsmApiElement[]): OverpassElement | null {
  const target = elements.find((e) => e.type === ref.type && e.id === ref.id)
  if (!target) return null
  const element: OverpassElement = { type: ref.type, id: ref.id, tags: target.tags ?? {} }

  if (ref.type === 'node') {
    if (target.lat != null && target.lon != null) Object.assign(element, { lat: target.lat, lon: target.lon })
    return element
  }

  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  for (const e of elements) {
    if (e.type !== 'node' || e.lat == null || e.lon == null) continue
    south = Math.min(south, e.lat)
    north = Math.max(north, e.lat)
    west = Math.min(west, e.lon)
    east = Math.max(east, e.lon)
  }
  if (south !== Infinity) element.center = { lat: (south + north) / 2, lon: (west + east) / 2 }
  return element
}

/** Fetch one element; null when OSM has no such element (404) or it was deleted (410). */
export async function fetchOsmElement(ref: OsmRef): Promise<OverpassElement | null> {
  const res = await fetch(osmApiUrl(ref), {
    headers: { 'User-Agent': 'TinyHike/1.0 (hello@tinyhike.com)', Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (res.status === 404 || res.status === 410) return null
  if (!res.ok) throw new Error(`OSM API HTTP ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 160)}`)
  const data = (await res.json()) as { elements?: OsmApiElement[] }
  return elementFromOsmApi(ref, data.elements ?? [])
}
