import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: false, // served from public/manifest.json
      workbox: {
        // Take over immediately instead of waiting for every tab to close. Without
        // these, a returning visitor keeps the previous build until they shut all
        // their tabs — which is how a shipped fix can appear not to have shipped.
        skipWaiting: true,
        clientsClaim: true,
        // Drop precaches from older builds rather than accumulating them.
        cleanupOutdatedCaches: true,
        // Never let the worker serve a stale index.html for an API call.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.mapbox\.com\/styles\//,
            handler: 'CacheFirst',
            options: { cacheName: 'mapbox-tiles', expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 } },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
})
