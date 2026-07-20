import { useRef, useEffect, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'

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

// Escape OSM/user-sourced text before injecting into popup HTML (avoids injection).
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
}

export default function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  // Latest places, readable inside the async `load` handler without stale closures.
  const placesRef = useRef<Place[]>([])
  const [styleReady, setStyleReady] = useState(false)
  const [bbox, setBbox] = useState('4.4,51.8,4.6,51.95') // Rotterdam default

  const { data: places, isLoading, isFetching, isError, error } = useQuery<Place[]>({
    queryKey: ['places', bbox],
    queryFn: () => api.get(`/api/places?bbox=${bbox}&locale=nl`),
  })

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
        paint: {
          'circle-color': '#2d6a4f',
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 16, 25, 22, 100, 30],
          'circle-stroke-width': 2,
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
          'text-size': 13,
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
          'circle-color': '#40916c',
          'circle-radius': 7,
          'circle-stroke-width': 2,
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

      // Click a place → popup with an escaped name and a link to its detail page.
      m.on('click', 'unclustered-point', (e) => {
        const feature = e.features?.[0]
        if (!feature) return
        const coords = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number]
        const name = escapeHtml(String(feature.properties?.name ?? 'Place'))
        const id = encodeURIComponent(String(feature.properties?.id ?? ''))
        new mapboxgl.Popup()
          .setLngLat(coords)
          .setHTML(`<strong>${name}</strong><br/><a href="/places/${id}">View</a>`)
          .addTo(m)
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
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {(isLoading || isFetching) && <div style={pillStyle}>Chargement des lieux…</div>}

      {isError && (
        <div style={errorStyle} role="alert">
          Impossible de charger les lieux.
          {error instanceof Error ? ` (${error.message})` : ''}
        </div>
      )}
    </div>
  )
}

const pillStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(255,255,255,0.95)',
  color: '#1b4332',
  padding: '6px 14px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 500,
  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
  pointerEvents: 'none',
}

const errorStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  maxWidth: '90%',
  background: '#fde8e8',
  color: '#9b1c1c',
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
}
