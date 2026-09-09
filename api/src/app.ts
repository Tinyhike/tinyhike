import 'dotenv/config'
import Fastify, { FastifyError, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
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

export interface BuildAppOptions {
  /** Inject a Prisma client (e.g. a mock in tests). If omitted, a real one is created. */
  prisma?: PrismaClient
  /** Fastify logger. Defaults to true; tests pass false to keep output quiet. */
  logger?: boolean
}

/**
 * Build the Fastify app with all plugins and routes registered, but WITHOUT
 * listening. This is the single source of truth for app wiring — the production
 * entrypoint (index.ts) and the test suite both build from here so what tests
 * exercise is exactly what ships.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true })
  const prisma = opts.prisma ?? new PrismaClient()
  const ownsPrisma = !opts.prisma

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
    origin: process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173',
    credentials: true,
  })
  // Cookie signing secret. The session cookie holds an independently-signed JWT, so
  // this only backs @fastify/cookie's optional signed-cookie feature; reuse JWT_SECRET
  // rather than introduce a separate (undocumented) COOKIE_SECRET env var.
  await app.register(cookie, { secret: process.env.JWT_SECRET ?? 'dev-cookie-secret' })
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

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(placesRoutes, { prefix: '/api/places' })
  await app.register(routesRoutes, { prefix: '/api/routes' })
  await app.register(photosRoutes, { prefix: '/api/photos' })
  await app.register(listsRoutes, { prefix: '/api/lists' })
  await app.register(adminRoutes, { prefix: '/api/admin' })

  app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }))

  // Only own the lifecycle of a Prisma client we created ourselves.
  if (ownsPrisma) {
    app.addHook('onClose', async () => {
      await prisma.$disconnect()
    })
  }

  await app.ready()
  return app
}
