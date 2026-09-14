import { useRef, useEffect, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useI18n } from '../lib/i18n.js'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

interface Place {
  id: string
  lat: number
  lng: number
  translations: Array<{ locale: string; name: string }>
}

const SOURCE_ID = 'places'

function toFeatureCollection(places: Place[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: places.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, name: p.translations[0]?.name ?? 'Place' },
    })),
  }
}

export default function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  // Latest places, readable inside the async `load` handler without stale closures.
  const placesRef = useRef<Place[]>([])
  const [styleReady, setStyleReady] = useState(false)
  const [bbox, setBbox] = useState('4.4,51.8,4.6,51.95') // Rotterdam default
  const { t, locale } = useI18n()

  // Same reason as placesRef: the map's click handlers are registered once, inside
  // `load`, and would otherwise capture the first render's navigate.
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  // 500 is the API's ceiling. At the default of 200 the Rotterdam seed (381 places)
  // was being silently cut by nearly half — the map looked complete and wasn't.
  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ['places', bbox, locale],
    queryFn: () => api.getWithHeaders<Place[]>(`/api/places?bbox=${bbox}&locale=${locale}&limit=500`),
  })

  const places = data?.data
  const truncated = data?.headers.get('X-Result-Truncated') === 'true'
  const total = data?.headers.get('X-Total-Count')

  // Init the map exactly once; tear it down on unmount (StrictMode double-mounts in dev).
  useEffect(() => {
    if (!mapRef.current || map.current) return
    const m = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [4.48, 51.92],
      zoom: 13,
    })
    map.current = m
    m.addControl(new mapboxgl.NavigationControl(), 'top-right')
    m.addControl(new mapboxgl.GeolocateControl({ trackUserLocation: true }), 'top-right')

    const handleMoveEnd = () => {
      const b = m.getBounds()
      if (b) setBbox(`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`)
    }
    m.on('moveend', handleMoveEnd)

    m.on('load', () => {
      m.addSource(SOURCE_ID, {
        type: 'geojson',
        data: toFeatureCollection(placesRef.current),
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 15,
      })

      // Cluster bubbles — radius grows in steps with the point count.
      m.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        // Colours mirror the design tokens in index.css (--grape / --berry).
        paint: {
          'circle-color': '#9b5de5',
          'circle-opacity': 0.92,
          'circle-radius': ['step', ['get', 'point_count'], 17, 25, 23, 100, 31],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      })
      m.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 14,
        },
        paint: { 'text-color': '#ffffff' },
      })
      // Individual (unclustered) places.
      m.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#ef476f',
          'circle-radius': 8,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      })

      // Click a cluster → zoom to its expansion level.
      m.on('click', 'clusters', (e) => {
        const feature = m.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0]
        if (!feature) return
        const clusterId = feature.properties?.cluster_id as number
        const src = m.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource
        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) return
          m.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], zoom })
        })
      })

      // Click a place → open its sheet. This is a client-side route change: the old
      // popup held a plain <a href>, which reloaded the whole app (and re-initialised
      // Mapbox) on every single place the user tapped.
      m.on('click', 'unclustered-point', (e) => {
        const feature = e.features?.[0]
        if (!feature) return
        const id = String(feature.properties?.id ?? '')
        if (!id) return
        // Keep the marker clear of the sheet, which covers the lower half.
        m.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], offset: [0, -110] })
        navigateRef.current(`/places/${encodeURIComponent(id)}`)
      })

      // Pointer affordance over interactive layers.
      for (const layer of ['clusters', 'unclustered-point']) {
        m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'))
        m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''))
      }

      setStyleReady(true)
    })

    return () => {
      m.remove()
      map.current = null
      setStyleReady(false)
    }
  }, [])

  // Push the current places into the source whenever they change (once the style is ready).
  useEffect(() => {
    placesRef.current = places ?? []
    if (!map.current || !styleReady) return
    const src = map.current.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
    src?.setData(toFeatureCollection(placesRef.current))
  }, [places, styleReady])

  return (
    <div className="map-page">
      <div ref={mapRef} className="map-canvas" />

      {(isLoading || isFetching) && <div className="map-pill">{t('map.loading')}</div>}

      {/* Even at the ceiling a dense viewport can overflow. Say so rather than
          quietly dropping pins the user has no way of knowing about. */}
      {!isFetching && truncated && (
        <div className="map-pill map-pill--warn">
          {t('map.truncated').replace('{total}', total ?? '?').replace('{shown}', String(places?.length ?? 0))}
        </div>
      )}

      {isError && (
        <div className="map-error" role="alert">
          {t('map.error')}
          {error instanceof Error ? ` ${error.message}` : ''}
        </div>
      )}

      {/* The place sheet renders here, over the map, without unmounting it. */}
      <Outlet />
    </div>
  )
}
