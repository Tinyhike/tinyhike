import { FastifyInstance } from 'fastify'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'crypto'
import { requireAuth } from '../plugins/auth.js'

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

export default async function photosRoutes(app: FastifyInstance) {
  // POST /api/photos/presign — get R2 upload URL
  app.post<{ Body: { contentType: string; placeId?: string; routeId?: string } }>(
    '/presign',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { contentType, placeId, routeId } = req.body
      if (!contentType.startsWith('image/')) {
        return reply.status(400).send({ error: 'Images only' })
      }
      const ext = contentType.split('/')[1]
      const key = `uploads/${crypto.randomUUID()}.${ext}`

      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: contentType }),
        { expiresIn: 300 },
      )

      const photo = await app.prisma.photo.create({
        data: {
          r2Key: key,
          r2Url: `${process.env.R2_PUBLIC_URL}/${key}`,
          status: 'PENDING',
          placeId,
          routeId,
          uploadedById: req.session!.sub,
        },
      })

      return { uploadUrl: url, photoId: photo.id }
    },
  )

  // POST /api/photos/:id/confirm — mark as uploaded, queue for moderation
  app.post<{ Params: { id: string } }>(
    '/:id/confirm',
    { preHandler: requireAuth },
    async (req, reply) => {
      const photo = await app.prisma.photo.findUnique({ where: { id: req.params.id } })
      if (!photo || photo.uploadedById !== req.session!.sub) {
        return reply.status(404).send({ error: 'Not found' })
      }
      return app.prisma.photo.update({ where: { id: photo.id }, data: { status: 'PENDING' } })
    },
  )
}
