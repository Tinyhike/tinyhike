/**
 * OpenStreetMap ingestion: the Overpass query, the fetch, and the translation from
 * OSM tags to TinyHike's stroller booleans.
 *
 * Shared by `jobs/seed-osm.ts` (new places) and `jobs/backfill-osm-tags.ts`
 * (existing ones), so the query and the mapping can't drift apart between them.
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export interface OverpassElement {
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/** Rotterdam default. Overpass order is south,west,north,east. */
export const DEFAULT_BBOX = '51.8,4.4,51.95,4.6'

/**
 * `nwr` is node+way+relation. The original query asked for playgrounds only as
 * nodes and parks only as nodes-or-ways, which misses most of them: in OSM a
 * playground is normally drawn as an area. Sampled over Delfshaven, 10 of the 12
 * parks and playgrounds present were ways — none of them reachable by that query.
 * `out center` gives areas a representative point, which is all the map needs.
 */
export const overpassQuery = (bbox: string) => `
[out:json][timeout:90];
(
  nwr["leisure"~"^(park|playground)$"](${bbox});
  nwr["amenity"="cafe"](${bbox});
  nwr["tourism"="picnic_site"](${bbox});
);
out center tags;`

/** Overpass is a free, frequently-saturated public service; these mean "try later". */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])
const MAX_ATTEMPTS = 5

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function fetchOverpass(bbox: string): Promise<OverpassElement[]> {
  let lastError = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      // Overpass (Apache) returns 406 to requests with no User-Agent. Must be set.
      headers: { 'User-Agent': 'TinyHike/1.0 (hello@tinyhike.com)' },
      body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
    })

    // Guard before parsing: Overpass serves HTML error pages (406/429/504) that would
    // otherwise crash JSON.parse with a misleading "Unexpected token '<'".
    if (!res.ok) {
      lastError = `HTTP ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 160)}`
      if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) {
        throw new Error(`Overpass ${lastError}`)
      }
      // Back off generously: hammering a saturated public instance is what earns
      // a longer ban, and this runs unattended from cron.
      const waitMs = 15_000 * attempt
      console.warn(`Overpass ${res.status}, retrying in ${waitMs / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})…`)
      await sleep(waitMs)
      continue
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      throw new Error(`Overpass returned non-JSON (${contentType}): ${(await res.text()).slice(0, 200)}`)
    }

    const data = (await res.json()) as { elements: OverpassElement[] }
    return data.elements
  }

  throw new Error(`Overpass unavailable after ${MAX_ATTEMPTS} attempts — last error: ${lastError}`)
}

/** Representative point for an element — `out center` supplies it for ways/relations. */
export function elementCoords(el: OverpassElement): { lat: number; lng: number } | null {
  const lat = el.lat ?? el.center?.lat
  const lng = el.lon ?? el.center?.lon
  return lat != null && lng != null ? { lat, lng } : null
}

/**
 * OSM ids are only unique *within* a type — node 123 and way 123 are unrelated
 * objects. The original seeder stored `osm:<id>`, which was survivable while the
 * query returned almost only nodes, but collides as soon as ways and relations are
 * included, and `Place.osmId` is unique, so a collision is a hard failure.
 */
export function osmIdFor(el: OverpassElement & { type?: string }): string {
  return `osm:${el.type ?? 'node'}/${el.id}`
}

/** The pre-typing id format, still on every row seeded before this change. */
export function legacyOsmId(el: OverpassElement): string {
  return `osm:${el.id}`
}

/**
 * Whether a legacy row is really the same feature as this element.
 *
 * A legacy `osm:123` could be node 123 or way 123, and we didn't record which. The
 * coordinates disambiguate: ~1e-4 degrees is roughly 10 m, far tighter than the gap
 * between two unrelated features that happen to share an id number.
 */
export function isSameFeature(el: OverpassElement, place: { lat: number; lng: number }): boolean {
  const coords = elementCoords(el)
  if (!coords) return false
  return Math.abs(coords.lat - place.lat) < 1e-4 && Math.abs(coords.lng - place.lng) < 1e-4
}

/** The kinds of place the Overpass query selects for. */
export type PlaceKind = 'playground' | 'park' | 'cafe' | 'picnic_site'

/** Which of our four kinds this element is, or null if it's none of them. */
export function kindOf(tags: Record<string, string> | undefined): PlaceKind | null {
  if (!tags) return null
  if (tags.leisure === 'playground') return 'playground'
  if (tags.leisure === 'park') return 'park'
  if (tags.amenity === 'cafe') return 'cafe'
  if (tags.tourism === 'picnic_site') return 'picnic_site'
  return null
}

/**
 * Fallback names for features OSM leaves unnamed.
 *
 * Most playgrounds in OSM have no name — 7 of the 12 around Delfshaven — and they
 * are exactly what a parent is looking for. Dropping them to keep every pin
 * individually identifiable made the map emptier where it mattered most, so an
 * unnamed playground is listed as "Speeltuin" rather than not at all. Several pins
 * then share a label, which the location on the map already disambiguates.
 */
export const GENERIC_NAMES: Record<PlaceKind, Record<'nl' | 'fr' | 'en', string>> = {
  playground: { nl: 'Speeltuin', fr: 'Aire de jeux', en: 'Playground' },
  park: { nl: 'Park', fr: 'Parc', en: 'Park' },
  cafe: { nl: 'Café', fr: 'Café', en: 'Café' },
  picnic_site: { nl: 'Picknickplek', fr: 'Aire de pique-nique', en: 'Picnic area' },
}

/**
 * Translation rows for a place, either from its real OSM name or from the generic
 * fallback. A real name is a proper noun, so it is kept as-is and written to `nl`
 * only — enrichment then supplies fr/en. A generic name is written in all three,
 * so every locale reads naturally without waiting on Claude.
 */
export function translationsFor(
  name: string | undefined,
  kind: PlaceKind | null,
): Array<{ locale: string; name: string }> {
  if (name) return [{ locale: 'nl', name }]
  if (!kind) return []
  return Object.entries(GENERIC_NAMES[kind]).map(([locale, generic]) => ({ locale, name: generic }))
}

/** The stroller booleans on Place. All tri-state: true / false / null = unknown. */
export interface StrollerTags {
  napFriendly?: boolean
  shaded?: boolean
  smooth?: boolean
  enclosed?: boolean
  freeEntry?: boolean
  hasToilets?: boolean
  hasParking?: boolean
  hasCafe?: boolean
  hasPlayground?: boolean
  dogFriendly?: boolean
  wheelchairOk?: boolean
}

const SMOOTH_SURFACES = new Set(['asphalt', 'paved', 'concrete', 'paving_stones', 'concrete:plates'])
const ROUGH_SURFACES = new Set(['grass', 'gravel', 'sand', 'dirt', 'ground', 'earth', 'cobblestone', 'unpaved', 'wood', 'pebblestone'])
const ENCLOSING_BARRIERS = new Set(['fence', 'wall', 'hedge', 'gate', 'bollard'])

/**
 * Translate one element's OSM tags into the stroller booleans we can honestly infer.
 *
 * The guiding rule is **absence of a tag is not a "no"**. An OSM playground with no
 * `toilets` key doesn't mean there are no toilets — it means nobody recorded it. So
 * a field is only set when OSM states something explicit, and is otherwise left
 * out entirely (staying null = "unknown"). Guessing here would be worse than having
 * no data: a parent who walks to a park because we claimed step-free access has been
 * actively misled.
 *
 * Three tags are deliberately never inferred, because OSM has no equivalent:
 * `napFriendly` and `shaded` are judgements, and `enclosed` needs a barrier that is
 * almost never mapped on the point itself. They belong to Claude enrichment or to
 * user reviews (`Review.tagsConfirmed` / `tagsDisputed`).
 */
export function mapOsmTags(tags: Record<string, string> | undefined): StrollerTags {
  if (!tags) return {}
  const out: StrollerTags = {}

  // wheelchair=limited is left unknown on purpose: for a stroller it could mean a
  // single kerb or a flight of steps, and we can't tell which.
  if (tags.wheelchair === 'yes') out.wheelchairOk = true
  else if (tags.wheelchair === 'no') out.wheelchairOk = false

  if (tags.toilets === 'yes' || tags.amenity === 'toilets' || tags['toilets:wheelchair']) out.hasToilets = true
  else if (tags.toilets === 'no') out.hasToilets = false

  if (tags.leisure === 'playground' || tags.playground) out.hasPlayground = true

  if (tags.amenity === 'cafe') out.hasCafe = true

  if (tags.amenity === 'parking' || tags.parking) out.hasParking = true

  // Only the explicit `fee` key. Dutch parks are free in practice, but inferring it
  // would be inventing data — the exact habit that left every tag null to begin with.
  if (tags.fee === 'no') out.freeEntry = true
  else if (tags.fee === 'yes') out.freeEntry = false

  if (tags.dog === 'yes' || tags.dog === 'leashed') out.dogFriendly = true
  else if (tags.dog === 'no') out.dogFriendly = false

  if (tags.surface) {
    if (SMOOTH_SURFACES.has(tags.surface)) out.smooth = true
    else if (ROUGH_SURFACES.has(tags.surface)) out.smooth = false
  }

  if (tags.barrier && ENCLOSING_BARRIERS.has(tags.barrier)) out.enclosed = true

  return out
}

/**
 * Narrow a mapping to the fields still unset on a place, so a re-run can add newly
 * mapped OSM data without ever overwriting a value a human put there.
 */
export function onlyMissing<T extends Record<string, unknown>>(mapped: StrollerTags, current: T): StrollerTags {
  const out: StrollerTags = {}
  for (const [key, value] of Object.entries(mapped) as Array<[keyof StrollerTags, boolean]>) {
    if (current[key] === null || current[key] === undefined) out[key] = value
  }
  return out
}
