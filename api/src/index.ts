import { buildApp } from './app.js'

// Entrypoint: build the app (all wiring lives in app.ts) and listen. The default
// host is 127.0.0.1: production listens on 127.0.0.1:3000 and only nginx, on the
// same machine, reaches it (app.ts relies on that for trustProxy). An empty HOST=
// falls back to it too, since an empty host would bind every interface. The dev
// checkout sets HOST=127.0.0.1 and PORT=3100 in its own .env (DEPLOY.md, "Dev
// environment"); a container would have to set HOST=0.0.0.0.
const app = await buildApp()
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST || '127.0.0.1'
await app.listen({ port, host })
