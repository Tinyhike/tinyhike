import { buildApp } from './app.js'

// Production entrypoint: build the app (all wiring lives in app.ts) and listen.
const app = await buildApp()
const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
