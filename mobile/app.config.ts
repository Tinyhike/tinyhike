import type { ConfigContext, ExpoConfig } from 'expo/config'

// Two variants of one app, so both can live on one phone (Jerome, 27 Oct 2026):
// the development build (APP_VARIANT=development, set by the "development"
// profile in eas.json) is com.tinyhike.app.dev, "TinyHike (dev)"; anything else
// is the real app, com.tinyhike.app.
const isDev = process.env.APP_VARIANT === 'development'

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isDev ? 'TinyHike (dev)' : 'TinyHike',
  slug: 'tinyhike',
  // The EAS project, on Jerome's Expo account: https://expo.dev/accounts/jerry010/projects/tinyhike
  owner: 'jerry010',
  scheme: isDev ? 'tinyhike-dev' : 'tinyhike',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: isDev ? 'com.tinyhike.app.dev' : 'com.tinyhike.app',
  },
  android: {
    package: isDev ? 'com.tinyhike.app.dev' : 'com.tinyhike.app',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    '@rnmapbox/maps',
    [
      'expo-location',
      {
        // Foreground only: the map shows where you are, nothing runs in the background.
        locationWhenInUsePermission: 'TinyHike shows where you are on the map.',
      },
    ],
  ],
  extra: {
    ...config.extra,
    eas: { projectId: '639c9d74-7290-4ef4-9f83-2cb8f612f265' },
  },
})
