import Mapbox from '@rnmapbox/maps'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

// The public token: Metro inlines it from mobile/.env, EAS builds from the EAS
// environment variable of the same name.
void Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? null)

export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="dark" />
    </>
  )
}
