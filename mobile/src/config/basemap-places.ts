// Which places of the basemap the map draws, and from which zoom (Jerome, 31 Oct
// 2026). The app draws them itself (components/BasemapPlaces.tsx), so a tap
// returns exactly the icon on screen. Edit this file to change what shows; where
// icons would overlap, the parents' categories win and the rest wait for zoom.
//
// A category is a Maki icon name, the `maki` field of `poi_label` in the tiles
// (mapbox.mapbox-streets-v8-lite). The full list of values:
// https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/#poi_label

/** From this zoom on, every category shows. */
export const ALL_CATEGORIES_FROM_ZOOM = 17

/** Below ALL_CATEGORIES_FROM_ZOOM, only what parents look for. */
export const PARENT_CATEGORIES: Record<string, readonly string[]> = {
  cafes: ['cafe'],
  restaurants: ['restaurant', 'restaurant-noodle', 'restaurant-pizza', 'restaurant-seafood'],
  bakeries: ['bakery'],
  iceCream: ['ice-cream'],
  parksAndPlaygrounds: ['park', 'garden', 'playground'],
  toilets: ['toilet'],
  pharmacies: ['pharmacy'],
  supermarkets: ['grocery'],
  // Children's shops can't be told apart: the tiles have no shop type, so a toy
  // shop (Intertoys) is a plain `shop`, like a phone repairer. They show from
  // ALL_CATEGORIES_FROM_ZOOM, with every shop.
  childrensShops: [],
  museumsAndLibraries: ['museum', 'library'],
}

/**
 * Transit stops are among the parents' categories: they show from zoom 12, with
 * Standard's own rule on top (bus stops from 17, metro entrances from 19). Set
 * to false and they show from ALL_CATEGORIES_FROM_ZOOM only.
 */
export const TRANSIT_WITH_PARENT_CATEGORIES = true
