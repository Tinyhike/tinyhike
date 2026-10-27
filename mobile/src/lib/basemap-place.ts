// What a tap on the basemap found: a place drawn by the Mapbox style itself (a
// café, a restaurant, a playground), not one of ours. No API call in milestone
// 1a step 1: the name and category come from the map tiles.

export type BasemapPlace = {
  name: string
  category: string | null
}

/** The part of a queried rendered feature this file reads. */
export type RenderedFeature = {
  geometry?: { type: string; coordinates?: unknown } | null
  properties?: Record<string, unknown> | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

// "food_and_drink" → "Food and drink"
function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * A place among the features rendered under the finger: a point with a name and
 * a `maki` icon, as POIs are in Mapbox tiles (roads and areas have no icon,
 * neighbourhood labels have no `maki`). The one closest to the tap wins.
 */
export function placeAtTap(features: RenderedFeature[], tap: [number, number]): BasemapPlace | null {
  let best: { place: BasemapPlace; distance: number } | null = null
  for (const feature of features) {
    const props = feature.properties ?? {}
    const name = text(props.name)
    const maki = text(props.maki)
    const coords = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null
    if (!name || !maki || !Array.isArray(coords) || coords.length < 2) continue
    const [lng, lat] = coords as [number, number]
    // Degrees of longitude shrink with latitude; this is enough to rank a few neighbours.
    const dx = (lng - tap[0]) * Math.cos((tap[1] * Math.PI) / 180)
    const dy = lat - tap[1]
    const distance = dx * dx + dy * dy
    if (best && best.distance <= distance) continue
    // Most specific first: the tiles' English category ("Brunch restaurant"), the
    // type ("Restaurant"), then the icon or the broad class.
    const raw = text(props.category_en) ?? text(props.type) ?? maki ?? text(props.class)
    best = { place: { name, category: raw ? humanize(raw) : null }, distance }
  }
  return best?.place ?? null
}
