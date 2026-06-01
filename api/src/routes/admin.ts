import { FastifyInstance } from 'fastify'
import { requireAdmin } from '../plugins/auth.js'

export default async function adminRoutes(app: FastifyInstance) {
  // GET /api/admin/stats
  app.get('/stats', { preHandler: requireAdmin }, async () => {
    const [places, pendingPlaces, photos, pendingPhotos, users] = await Promise.all([
      app.prisma.place.count(),
      app.prisma.place.count({ where: { status: 'PENDING' } }),
      app.prisma.photo.count(),
      app.prisma.photo.count({ where: { status: 'PENDING' } }),
      app.prisma.user.count(),
    ])
    return { places, pendingPlaces, photos, pendingPhotos, users }
  })

  // PATCH /api/admin/places/:id — approve / reject
  app.patch<{ Params: { id: string }; Body: { status: 'APPROVED' | 'REJECTED' } }>(
    '/places/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { status } = req.body
      if (!['APPROVED', 'REJECTED'].includes(status)) {
        return reply.status(400).send({ error: 'Invalid status' })
      }
      return app.prisma.place.update({ where: { id: req.params.id }, data: { status } })
    },
  )

  // POST /api/admin/seed — bulk upsert OSM places
  app.post<{ Body: { places: Array<{ osmId: string; lat: number; lng: number; name: string; locale?: string }> } }>(
    '/seed',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { places } = req.body
      let created = 0

      for (const p of places) {
        const existing = await app.prisma.place.findUnique({ where: { osmId: p.osmId } })
        if (existing) continue
        await app.prisma.place.create({
          data: {
            lat: p.lat,
            lng: p.lng,
            osmId: p.osmId,
            source: 'OSM',
            status: 'PENDING',
            translations: { create: { locale: p.locale ?? 'nl', name: p.name } },
          },
        })
        created++
      }

      return { created }
    },
  )
}
