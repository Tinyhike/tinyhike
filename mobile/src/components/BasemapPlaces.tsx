import { Images, StyleImport, SymbolLayer, VectorSource } from '@rnmapbox/maps'
import type { ComponentProps } from 'react'

import {
  ALL_CATEGORIES_FROM_ZOOM,
  PARENT_CATEGORIES,
  TRANSIT_WITH_PARENT_CATEGORIES,
} from '@/config/basemap-places'
import { colors } from '@/lib/colors'
import { PLACE_ICONS } from '@/lib/place-icons'

// The basemap's places, drawn by the app instead of by Standard. Standard is a
// protected style: queryRenderedFeatures returns nothing from its own layers
// (every tap came back empty on 30 Oct 2026). Its place and transit icons are
// hidden, and the same places are drawn here from the same tiles, in layers of
// our own, which a tap can query. Only what is drawn answers, so a tap returns
// the icon under the finger, collisions included.

export type PlacePressEvent = Parameters<NonNullable<ComponentProps<typeof VectorSource>['onPress']>>[0]
type Filter = NonNullable<ComponentProps<typeof SymbolLayer>['filter']>
type Style = NonNullable<ComponentProps<typeof SymbolLayer>['style']>

/** The tileset Standard draws its places and transit stops from (its `composite` source, checked 30 Oct 2026). */
const TILES = 'mapbox://mapbox.mapbox-streets-v8-lite'
/** The touch box around the finger, in dp: an icon it overlaps counts as tapped. */
const TOUCH_BOX_DP = 44

const parentMaki = [...new Set(Object.values(PARENT_CATEGORIES).flat())]

// What is drawn is decided by the categories (config/basemap-places.ts) and by
// collisions: an icon that would overlap one placed before it is not drawn, and
// `symbolSortKey` places the important ones first. Standard also thins places
// out by `filterrank`, but that rank is relative to each tile: in the zoom 13
// and 14 tiles most cafés and restaurants rank 5, the last, and Standard shows
// them from zoom 18 only. On a steep tilt, only near the centre, like Standard.
const tiltedEdge = (limits: [number, number, number, number]) => [
  'case',
  ['<=', ['pitch'], 40],
  true,
  ['step', ['pitch'], true, 40, ['<', ['distance-from-center'], limits[0]], 50, ['<', ['distance-from-center'], limits[1]], 55, ['<', ['distance-from-center'], limits[2]], 60, ['<=', ['distance-from-center'], limits[3]]],
]

// A stop with no name has nothing to show in the sheet: not drawn. Places with
// no name are drawn, icon only, like Standard does: most playgrounds, picnic
// sites and dog parks have none in the tiles (all 22 playgrounds of central
// Rotterdam's zoom 16 tiles), and leaving them out left the map with no green.
const named = ['!=', ['coalesce', ['get', 'name'], ''], '']

const placeFilter = [
  'all',
  ['match', ['get', 'maki_beta'], 'terminal', false, true],
  tiltedEdge([1.2, 1, 0.8, 0.6]),
  ['any', ['>=', ['zoom'], ALL_CATEGORIES_FROM_ZOOM], ['match', ['get', 'maki'], parentMaki, true, false]],
] as unknown as Filter

// Standard's transit-label filter: no bus stop below 17, no metro entrance below 19.
const transitFilter = [
  'all',
  named,
  ['step', ['zoom'], ['all', ['!=', ['get', 'mode'], 'bus'], ['!=', ['get', 'stop_type'], 'entrance']], 17, ['!=', ['get', 'stop_type'], 'entrance'], 19, true],
  tiltedEdge([1, 0.8, 0.4, -0.1]),
] as unknown as Filter

const label = {
  textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
  textSize: 12,
  textColor: colors.ink,
  textHaloColor: colors.paper,
  textHaloWidth: 1.2,
  textAnchor: 'top',
  textOffset: [0, 1.25],
  textMaxWidth: 9,
  // An icon whose name has no room still shows, alone.
  textOptional: true,
  // Standard lights the map; keep our colours as drawn.
  iconEmissiveStrength: 1,
  textEmissiveStrength: 1,
} satisfies Style

const placeStyle = {
  ...label,
  iconImage: ['coalesce', ['image', ['concat', 'place-', ['get', 'maki']]], ['image', 'place-marker']],
  textField: ['get', 'name'],
  // Lower first: the parents' categories ahead of the rest, then the tile's own ranking.
  symbolSortKey: ['+', ['number', ['get', 'filterrank'], 9], ['match', ['get', 'maki'], parentMaki, 0, 10]],
} as unknown as Style

const transitStyle = {
  ...label,
  iconImage: [
    'case',
    ['==', ['get', 'stop_type'], 'entrance'],
    'place-entrance',
    [
      'match',
      ['get', 'mode'],
      'metro_rail',
      'place-rail-metro',
      'rail',
      'place-rail',
      ['light_rail', 'tram', 'monorail', 'funicular'],
      'place-rail-light',
      'bus',
      'place-bus',
      'ferry',
      'place-ferry',
      'bicycle',
      'place-bicycle-share',
      'place-rail',
    ],
  ],
  // Like Standard: from 13 the metro and train names, from 14 all but buses, from 18 all.
  textField: [
    'step',
    ['zoom'],
    '',
    13,
    ['match', ['get', 'mode'], ['metro_rail', 'rail'], ['get', 'name'], ''],
    14,
    ['match', ['get', 'mode'], ['bicycle', 'bus'], '', ['get', 'name']],
    18,
    ['get', 'name'],
  ],
} as unknown as Style

type Props = {
  onPress: (event: PlacePressEvent) => void
}

/** The places of the basemap, as icons the parent can tap. Children of the MapView. */
export function BasemapPlaces({ onPress }: Props) {
  return (
    <>
      <StyleImport id="basemap" existing config={{ showPointOfInterestLabels: false, showTransitLabels: false }} />
      <Images images={PLACE_ICONS} />
      <VectorSource id="places" url={TILES} onPress={onPress} hitbox={{ width: TOUCH_BOX_DP, height: TOUCH_BOX_DP }}>
        <SymbolLayer id="places-poi" sourceLayerID="poi_label" slot="top" minZoomLevel={6} filter={placeFilter} style={placeStyle} />
        <SymbolLayer
          id="places-transit"
          sourceLayerID="transit_stop_label"
          slot="top"
          minZoomLevel={TRANSIT_WITH_PARENT_CATEGORIES ? 12 : ALL_CATEGORIES_FROM_ZOOM}
          filter={transitFilter}
          style={transitStyle}
        />
      </VectorSource>
    </>
  )
}
