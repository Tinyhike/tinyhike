import { FastifyInstance } from 'fastify'
import { Resend } from 'resend'
import crypto from 'crypto'
import { signSession, requireAuth } from '../plugins/auth.js'

const resend = new Resend(process.env.RESEND_API_KEY)
const MAGIC_TTL_MIN = 15

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/magic — send magic link
  app.post<{ Body: { email: string } }>('/magic', async (req, reply) => {
    const { email } = req.body
    if (!email?.includes('@')) return reply.status(400).send({ error: 'Invalid email' })

    let user = await app.prisma.user.findUnique({ where: { email } })
    if (!user) user = await app.prisma.user.create({ data: { email } })

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + MAGIC_TTL_MIN * 60 * 1000)
    await app.prisma.magicToken.create({ data: { token, userId: user.id, expiresAt } })

    const link = `${process.env.API_URL}/api/auth/verify?token=${token}`
    await resend.emails.send({
      from: `TinyHike <hello@${process.env.EMAIL_DOMAIN}>`,
      to: email,
      subject: 'Your TinyHike login link',
      html: `<p><a href="${link}">Click here to sign in</a> — valid ${MAGIC_TTL_MIN} min.</p>`,
    })

    return { ok: true }
  })

  // GET /api/auth/verify?token=… — consume magic link, set cookie
  app.get<{ Querystring: { token: string } }>('/verify', async (req, reply) => {
    const { token } = req.query
    const magic = await app.prisma.magicToken.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!magic || magic.usedAt || magic.expiresAt < new Date()) {
      return reply.status(400).send({ error: 'Invalid or expired token' })
    }

    await app.prisma.magicToken.update({ where: { id: magic.id }, data: { usedAt: new Date() } })

    const jwt = await signSession({ sub: magic.userId, role: magic.user.role })
    reply
      .setCookie('session', jwt, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      })
      .redirect(process.env.WEB_URL + '/?auth=ok')
  })

  // GET /api/auth/me
  app.get('/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = await app.prisma.user.findUnique({ where: { id: req.session!.sub } })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    return { id: user.id, email: user.email, handle: user.handle, role: user.role }
  })

  // POST /api/auth/logout
  app.post('/logout', async (_req, reply) => {
    reply.clearCookie('session', { path: '/' }).send({ ok: true })
  })
}
