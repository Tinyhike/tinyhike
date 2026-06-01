import 'dotenv/config'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
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

await app.register(cors, {
  origin: process.env.WEB_URL ?? 'http://localhost:5173',
  credentials: true,
})
await app.register(cookie, { secret: process.env.COOKIE_SECRET! })
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

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
