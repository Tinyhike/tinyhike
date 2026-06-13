import 'dotenv/config'
import Fastify, { FastifyError, FastifyRequest, FastifyReply } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { PrismaClient } from '@prisma/client'

import authRoutes from './routes/auth.js'
import placesRoutes from './routes/places.js'
import routesRoutes from './routes/routes.js'
import photosRoutes from './routes/photos.js'
import listsRoutes from './routes/lists.js'
import adminRoutes from './routes/admin.js'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

const app = Fastify({ logger: true })
const prisma = new PrismaClient()

app.decorate('prisma', prisma)

// Security headers. CSP defaults are tuned for HTML; this is a JSON API, so the
// strict default CSP is harmless and adds defense-in-depth.
await app.register(helmet)

// Global rate limit (per IP). Individual routes tighten this via `config.rateLimit`
// — see the auth and review endpoints. Generous default so map panning isn't throttled.
await app.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
})

await app.register(cors, {
  origin: process.env.WEB_URL ?? 'http://localhost:5173',
  credentials: true,
})
await app.register(cookie, { secret: process.env.COOKIE_SECRET! })
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

// Global error handler: surface client errors (4xx, incl. validation & rate limit),
// but never leak stack traces / internals for server errors.
app.setErrorHandler((error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
  const status = error.statusCode ?? 500
  if (status >= 500) {
    req.log.error({ err: error }, 'unhandled error')
    return reply.status(500).send({ error: 'InternalServerError', message: 'Something went wrong' })
  }
  return reply.status(status).send({ error: error.code ?? error.name ?? 'Error', message: error.message })
})

await app.register(authRoutes,   { prefix: '/api/auth' })
await app.register(placesRoutes, { prefix: '/api/places' })
await app.register(routesRoutes, { prefix: '/api/routes' })
await app.register(photosRoutes, { prefix: '/api/photos' })
await app.register(listsRoutes,  { prefix: '/api/lists' })
await app.register(adminRoutes,  { prefix: '/api/admin' })

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }))

app.addHook('onClose', async () => { await prisma.$disconnect() })

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
