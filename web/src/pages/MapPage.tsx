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

export default function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [bbox, setBbox] = useState('4.4,51.8,4.6,51.95') // Rotterdam default

  const { data: places } = useQuery<Place[]>({
    queryKey: ['places', bbox],
    queryFn: () => api.get(`/api/places?bbox=${bbox}&locale=nl`),
  })

  useEffect(() => {
    if (!mapRef.current || map.current) return
    map.current = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [4.48, 51.92],
      zoom: 13,
    })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.current.addControl(new mapboxgl.GeolocateControl({ trackUserLocation: true }), 'top-right')

    map.current.on('moveend', () => {
      const b = map.current!.getBounds()
      setBbox(`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`)
    })
  }, [])

  useEffect(() => {
    if (!map.current || !places) return
    places.forEach((p) => {
      const name = p.translations[0]?.name ?? 'Place'
      new mapboxgl.Marker({ color: '#2d6a4f' })
        .setLngLat([p.lng, p.lat])
        .setPopup(new mapboxgl.Popup().setHTML(`<strong>${name}</strong><br/><a href="/places/${p.id}">View</a>`))
        .addTo(map.current!)
    })
  }, [places])

  return <div ref={mapRef} style={{ width: '100%', height: '100vh' }} />
}
