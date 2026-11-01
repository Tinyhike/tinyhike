import type { Locale } from './i18n'
import { poiCategory, transitCategory } from './place-category'

// What a tap on the map found: a place of the basemap (a café, a shop, a metro
// stop), not one of ours. The app draws these icons itself
// (components/BasemapPlaces.tsx); a tap hands over the drawn ones its touch box
// overlaps, and the one nearest the finger wins.

export type BasemapPlace = {
  /** Null for the many places the tiles leave unnamed (most playgrounds). */
  name: string | null
  category: string | null
}

export type TapLookup = { kind: 'place'; place: BasemapPlace } | { kind: 'none' }

/** The part of a tapped feature this file reads. */
export type TappedFeature = {
  geometry?: { type: string; coordinates?: unknown } | null
  properties?: Record<string, unknown> | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function pointOf(feature: TappedFeature): [number, number] | null {
  const geometry = feature.geometry
  if (geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null
  const [lng, lat] = geometry.coordinates as unknown[]
  return typeof lng === 'number' && typeof lat === 'number' ? [lng, lat] : null
}

/** Squared distance on the ground, enough to rank icons a fingertip apart. */
function distance2([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const dx = (lng2 - lng1) * Math.cos((lat1 * Math.PI) / 180)
  const dy = lat2 - lat1
  return dx * dx + dy * dy
}

/** The place whose icon is nearest the tap, with its category in `locale`. */
export function placeAtTap(features: TappedFeature[], tap: [number, number], locale: Locale): BasemapPlace | null {
  let best: { place: BasemapPlace; d: number } | null = null
  for (const feature of features) {
    const props = feature.properties ?? {}
    const name = text(props.name)
    const at = pointOf(feature)
    if (!at) continue
    const d = distance2(tap, at)
    if (best && best.d <= d) continue
    // Transit stops carry a stop type; places carry a Maki icon and a class.
    const category =
      text(props.stop_type) !== null
        ? transitCategory(text(props.mode), locale)
        : poiCategory(text(props.maki), text(props.class), locale)
    best = { place: { name, category }, d }
  }
  return best?.place ?? null
}
