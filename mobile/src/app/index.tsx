import { Camera, LocationPuck, MapView } from '@rnmapbox/maps'
import * as Location from 'expo-location'
import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PlaceSheet, type SheetState } from '@/components/PlaceSheet'
import { lookUpPlace, type Viewpoint } from '@/lib/basemap-place'
import { colors } from '@/lib/colors'
import { locale, t } from '@/lib/i18n'

// The PWA's opening view (web/src/pages/MapPage.tsx).
const ROTTERDAM: [number, number] = [4.48, 51.92]
const OPENING_ZOOM = 13

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? ''

type MapPress = {
  geometry: { coordinates: number[] }
}

export default function MapScreen() {
  const camera = useRef<Camera>(null)
  // Zoom and pitch decide which places Standard shows; updated when the map settles.
  const view = useRef<Viewpoint>({ zoom: OPENING_ZOOM, pitch: 0 })
  // Only the latest tap may fill the sheet: an older answer arriving late is dropped.
  const lastTap = useRef(0)
  const insets = useSafeAreaInsets()
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [showPuck, setShowPuck] = useState(false)
  const [locationRefused, setLocationRefused] = useState(false)

  // Allowed on an earlier launch: show the position at once, without asking.
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then((permission) => setShowPuck(permission.granted))
      .catch(() => setShowPuck(false))
  }, [])

  async function onPress(press: MapPress) {
    const [lng, lat] = press.geometry.coordinates
    const tap = ++lastTap.current
    setSheet({ kind: 'loading' })
    const result = await lookUpPlace([lng, lat], view.current, locale, TOKEN)
    if (tap === lastTap.current) setSheet(result)
  }

  function closeSheet() {
    lastTap.current += 1
    setSheet(null)
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

  if (!TOKEN) {
    return (
      <View style={[styles.missing, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.missingText}>No Mapbox token: set EXPO_PUBLIC_MAPBOX_TOKEN in mobile/.env, then restart Metro.</Text>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <MapView
        style={styles.screen}
        styleURL="mapbox://styles/mapbox/standard"
        scaleBarEnabled={false}
        onPress={(press) => void onPress(press as MapPress)}
        onMapIdle={(state) => {
          view.current = { zoom: state.properties.zoom, pitch: state.properties.pitch }
        }}
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
          <Text style={styles.buttonText}>{t('map.locate')}</Text>
        </Pressable>
        {locationRefused ? (
          <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button" style={styles.note}>
            <Text style={styles.noteText}>{t('map.locateRefused')}</Text>
          </Pressable>
        ) : null}
      </View>

      {sheet ? <PlaceSheet state={sheet} onClose={closeSheet} /> : null}
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
