import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  // The dev server's address and the API it proxies to come from web/.env
  // (DEPLOY.md, "Dev environment"): 127.0.0.1 only, which an SSH tunnel reaches,
  // and the dev checkout's API on :3100. 5173 is the port the Mapbox token allows.
  const env = loadEnv(mode, process.cwd(), '')

  return {
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
      host: env.DEV_HOST || '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: env.DEV_API_TARGET || 'http://127.0.0.1:3000', changeOrigin: true } },
    },
  }
})
