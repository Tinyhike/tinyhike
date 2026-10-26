import { buildApp } from './app.js'

// Entrypoint: build the app (all wiring lives in app.ts) and listen. Production
// listens on 0.0.0.0:3000 behind nginx; the dev checkout sets HOST=127.0.0.1 and
// PORT=3100 in its own .env (DEPLOY.md, "Dev environment").
const app = await buildApp()
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
await app.listen({ port, host })
