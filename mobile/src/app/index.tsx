import { Camera, LocationPuck, MapView } from '@rnmapbox/maps'
import * as Location from 'expo-location'
import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PlaceSheet } from '@/components/PlaceSheet'
import { placeAtTap, type BasemapPlace, type RenderedFeature } from '@/lib/basemap-place'
import { colors } from '@/lib/colors'

// The PWA's opening view (web/src/pages/MapPage.tsx).
const ROTTERDAM: [number, number] = [4.48, 51.92]
const OPENING_ZOOM = 13
// A finger covers more than one pixel: query a square this many dp around the tap.
const TAP_SLOP = 16

type MapPress = {
  geometry: { coordinates: number[] }
  properties: { screenPointX: number; screenPointY: number }
}

export default function MapScreen() {
  const map = useRef<MapView>(null)
  const camera = useRef<Camera>(null)
  const insets = useSafeAreaInsets()
  const [place, setPlace] = useState<BasemapPlace | null>(null)
  const [showPuck, setShowPuck] = useState(false)
  const [locationRefused, setLocationRefused] = useState(false)

  // Allowed on an earlier launch: show the position at once, without asking.
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then((permission) => setShowPuck(permission.granted))
      .catch(() => setShowPuck(false))
  }, [])

  async function onPress(press: MapPress) {
    const { screenPointX: x, screenPointY: y } = press.properties
    const [lng, lat] = press.geometry.coordinates
    const found = await map.current?.queryRenderedFeaturesInRect([y - TAP_SLOP, x - TAP_SLOP, y + TAP_SLOP, x + TAP_SLOP])
    const features = (found?.features ?? []) as RenderedFeature[]
    if (__DEV__) {
      // Milestone 1a step 1 hinges on what the Standard style returns here: Metro's log shows it.
      console.log('[tap]', JSON.stringify(features.slice(0, 12).map((f) => ({ geometry: f.geometry?.type, properties: f.properties }))))
    }
    setPlace(placeAtTap(features, [lng, lat]))
  }

  // The position is asked for the first time the parent wants it, like the PWA's locate button.
  async function showMyPosition() {
    let permission = await Location.getForegroundPermissionsAsync()
    if (!permission.granted && permission.canAskAgain) {
      permission = await Location.requestForegroundPermissionsAsync()
    }
    if (!permission.granted) {
      setLocationRefused(true)
      return
    }
    setLocationRefused(false)
    setShowPuck(true)
    const position = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync())
    camera.current?.setCamera({
      centerCoordinate: [position.coords.longitude, position.coords.latitude],
      zoomLevel: 15,
      animationDuration: 800,
    })
  }

  if (!process.env.EXPO_PUBLIC_MAPBOX_TOKEN) {
    return (
      <View style={[styles.missing, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.missingText}>No Mapbox token: set EXPO_PUBLIC_MAPBOX_TOKEN in mobile/.env, then restart Metro.</Text>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <MapView
        ref={map}
        style={styles.screen}
        styleURL="mapbox://styles/mapbox/standard"
        scaleBarEnabled={false}
        onPress={(press) => void onPress(press as MapPress)}
      >
        <Camera ref={camera} defaultSettings={{ centerCoordinate: ROTTERDAM, zoomLevel: OPENING_ZOOM }} />
        {showPuck ? <LocationPuck puckBearingEnabled pulsing={{ isEnabled: true }} /> : null}
      </MapView>

      <View style={[styles.controls, { top: insets.top + 12 }]}>
        <Pressable
          onPress={() => void showMyPosition()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>Ma position</Text>
        </Pressable>
        {locationRefused ? (
          <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button" style={styles.note}>
            <Text style={styles.noteText}>Position refusée. Toucher pour ouvrir les réglages.</Text>
          </Pressable>
        ) : null}
      </View>

      {place ? <PlaceSheet place={place} onClose={() => setPlace(null)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { position: 'absolute', right: 12, alignItems: 'flex-end', gap: 8 },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: colors.paper,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  buttonPressed: { backgroundColor: '#f2f5f6' },
  buttonText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  note: { maxWidth: 240, padding: 10, borderRadius: 12, backgroundColor: colors.paper, elevation: 4 },
  noteText: { fontSize: 13, color: colors.inkSoft },
  missing: { flex: 1, paddingHorizontal: 24, backgroundColor: colors.paper },
  missingText: { fontSize: 16, color: colors.ink },
})
