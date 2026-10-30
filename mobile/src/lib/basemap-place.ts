import type { Locale } from './i18n'
import { poiCategory, transitCategory } from './place-category'

// What a tap on the basemap found: a place the Mapbox Standard style draws (a
// café, a shop, a metro stop), not one of ours. Standard is a protected style:
// queryRenderedFeatures returns nothing from it (every tap came back empty on
// 30 Oct 2026), and @rnmapbox/maps has no featureset API. So the app asks the
// Tilequery API for the places near the tapped point, in the very tiles Standard
// draws them from, and keeps the ones Standard shows at this zoom. No API of ours.

/** The tileset behind Standard's place and transit labels (its `composite` source, checked 30 Oct 2026). */
const TILESET = 'mapbox.mapbox-streets-v8-lite'
const LAYERS = ['poi_label', 'transit_stop_label']
/** Half a fingertip: a place whose icon is this close to the tap counts as tapped. */
const FINGER_RADIUS_DP = 22
const MAX_RADIUS_M = 500
/** Enough candidates to survive the visibility filter in a dense street. */
const LIMIT = 20
const TIMEOUT_MS = 8000
/** Standard's `densityPointOfInterestLabels`, at its default (the style's schema). */
const POI_DENSITY = 3

export type BasemapPlace = {
  name: string
  category: string | null
}

/** What the map showed when the parent tapped. */
export type Viewpoint = {
  zoom: number
  pitch: number
}

export type TapLookup =
  | { kind: 'place'; place: BasemapPlace }
  | { kind: 'none' }
  | { kind: 'offline' }
  | { kind: 'error' }

/** The part of a Tilequery feature this file reads. */
export type TilequeryFeature = {
  properties?: Record<string, unknown> | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Metres covered by one dp at this zoom and latitude (Mapbox zoom levels count 512-dp tiles). */
export function metresPerDp(zoom: number, latitude: number): number {
  return (40075016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom)
}

/** The search radius around the tap, in metres: a fixed fingertip on screen, whatever the zoom. */
export function tapRadius(zoom: number, latitude: number): number {
  return Math.min(MAX_RADIUS_M, Math.max(1, Math.round(FINGER_RADIUS_DP * metresPerDp(zoom, latitude))))
}

// Standard's poi-label filter: a place shows when its `filterrank` is at most a
// threshold that grows with the zoom, depends on the class (and on the pitch),
// plus the density setting.
function zoomStep(zoom: number): number {
  return zoom < 16 ? -2 : zoom < 18 ? -1 : 0
}

function classOffset(cls: string | null, pitch: number): number {
  if (pitch <= 15) {
    switch (cls) {
      case 'park_like':
        return 4
      case 'store_like':
        return 3
      case 'visitor_amenities':
        return 2
      case 'lodging':
        return 1
      default:
        return 2
    }
  }
  switch (cls) {
    case 'park_like':
      return 4
    case 'food_and_drink':
    case 'visitor_amenities':
    case 'lodging':
      return 1
    case 'religion':
      return 0
    default:
      return 2
  }
}

/**
 * Whether Standard draws this feature at this zoom and pitch: its poi-label and
 * transit-label filters (style of 30 Oct 2026), without the indoor floors (off by
 * default) and the far edge of a steep tilt. Collisions between labels are not
 * known here; picking the place nearest the finger makes up for them.
 */
export function isShownByStandard(layer: string | null, props: Record<string, unknown>, view: Viewpoint): boolean {
  if (layer === 'poi_label') {
    if (view.zoom < 6) return false
    if (props.maki_beta === 'terminal') return false
    if (props.type === 'Toilets' && view.zoom < 17) return false
    const rank = props.filterrank
    if (typeof rank !== 'number') return false
    return rank <= zoomStep(view.zoom) + classOffset(text(props.class), view.pitch) + POI_DENSITY
  }
  if (layer === 'transit_stop_label') {
    if (view.zoom < 12) return false
    if (props.stop_type === 'entrance') return view.zoom >= 19
    if (props.mode === 'bus') return view.zoom >= 17
    return true
  }
  return false
}

function tilequeryOf(props: Record<string, unknown>): { layer: string | null; distance: number } {
  const tq = props.tilequery
  if (typeof tq !== 'object' || tq === null) return { layer: null, distance: Infinity }
  const { layer, distance } = tq as Record<string, unknown>
  return { layer: text(layer), distance: typeof distance === 'number' ? distance : Infinity }
}

/** The named place Standard shows nearest the tap, with its category in `locale`. */
export function nearestShownPlace(features: TilequeryFeature[], view: Viewpoint, locale: Locale): BasemapPlace | null {
  let best: { place: BasemapPlace; distance: number } | null = null
  for (const feature of features) {
    const props = feature.properties ?? {}
    const name = text(props.name)
    const { layer, distance } = tilequeryOf(props)
    if (!name || !isShownByStandard(layer, props, view)) continue
    if (best && best.distance <= distance) continue
    const category =
      layer === 'transit_stop_label'
        ? transitCategory(text(props.mode), locale)
        : poiCategory(text(props.maki), text(props.class), locale)
    best = { place: { name, category }, distance }
  }
  return best?.place ?? null
}

/** Asks Tilequery which place is under the finger. Never throws: offline and errors are results. */
export async function lookUpPlace(
  [lng, lat]: [number, number],
  view: Viewpoint,
  locale: Locale,
  token: string,
): Promise<TapLookup> {
  const url =
    `https://api.mapbox.com/v4/${TILESET}/tilequery/${lng.toFixed(6)},${lat.toFixed(6)}.json` +
    `?radius=${tapRadius(view.zoom, lat)}&limit=${LIMIT}&layers=${LAYERS.join(',')}` +
    `&access_token=${encodeURIComponent(token)}`
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, { signal: abort.signal })
  } catch {
    // No network, or no answer in time: the same thing for the parent.
    return { kind: 'offline' }
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) return { kind: 'error' }
  let features: TilequeryFeature[]
  try {
    const body: unknown = await response.json()
    const list = (body as { features?: unknown } | null)?.features
    features = Array.isArray(list) ? (list as TilequeryFeature[]) : []
  } catch {
    return { kind: 'error' }
  }
  if (__DEV__) {
    // What Tilequery returned, and what Standard shows of it: Metro's log.
    const seen = features.map((f) => {
      const props = f.properties ?? {}
      const { layer, distance } = tilequeryOf(props)
      return `${Math.round(distance)} m ${String(props.name)} (${String(props.maki ?? props.mode)}, rank ${String(props.filterrank)})${isShownByStandard(layer, props, view) ? '' : ' hidden'}`
    })
    console.log('[tap]', `zoom ${view.zoom.toFixed(1)}, radius ${tapRadius(view.zoom, lat)} m:`, seen.join(' | ') || 'nothing')
  }
  const place = nearestShownPlace(features, view, locale)
  return place ? { kind: 'place', place } : { kind: 'none' }
}
