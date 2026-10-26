import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { Resend } from 'resend'
import crypto from 'crypto'
import { z } from 'zod'
import { signSession, requireAuth, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '../plugins/auth.js'

const resend = new Resend(process.env.RESEND_API_KEY)
const MAGIC_TTL_MIN = 15

/**
 * Where a magic link may send the parent after sign-in: an allowlist of in-app
 * paths, not "anything starting with /". The redirect is PUBLIC_BASE_URL + next,
 * so a value such as '@evil.com' would build https://app.tinyhike.com@evil.com
 * (host evil.com), and '//evil.com' or '/\\evil.com' is protocol-relative
 * wherever the path is used on its own. Place ids are cuids: lowercase letters and
 * digits only, so '..', '?', '#' and '%' never pass.
 */
export const NEXT_PATH = /^\/(places\/[a-z0-9]{1,40}|profile|lists)?$/

/**
 * A structural check, not a full RFC parser: one '@', a dot in the domain, and
 * none of the characters that only occur in quoted local parts or [IP] domain
 * literals ("(),:;<>[]\\ and whitespace). zod's .email() is stricter and refuses
 * addresses that are valid and in use: IDN domains ('jan@café.nl'), non-ASCII
 * local parts, and atext such as '&', '!' or '%'. A parent whose account uses one
 * of those would be locked out. Whether an address can really receive mail is
 * Resend's call, reported through the 502 below. Excluding the backslash also
 * keeps the insensitive lookup in findOrCreateUser away from ILIKE's escape
 * character.
 */
const EMAIL_SHAPE = /^[^\s@"(),:;<>[\]\\]+@[^\s@"(),:;<>[\]\\]+\.[^\s@"(),:;<>[\]\\]+$/

const MagicBody = z.object({
  email: z.string().trim().toLowerCase().max(254).regex(EMAIL_SHAPE),
  next: z.string().regex(NEXT_PATH).optional(),
})

const VerifyQuery = z.object({
  // crypto.randomBytes(32).toString('hex') below: 64 lowercase hex characters.
  token: z.string().regex(/^[0-9a-f]{64}$/),
  // The link is in the parent's mail, where anything may have rewritten it. A bad
  // next costs them the deep link, never the sign-in: it falls back to '/'.
  next: z.string().regex(NEXT_PATH).optional().catch(undefined),
})

/**
 * The account for an address, matched without regard to case or surrounding
 * whitespace. New accounts are stored trimmed and lowercased, but older ones were
 * stored exactly as typed ('Marieke@x.nl', a phone keyboard capitalises the first
 * letter and autocomplete appends a space), and the unique index on User.email is
 * case-sensitive. An exact lookup would miss such an account and open a second,
 * empty one beside it, leaving the parent's lists, submitted places and reviews
 * (and an ADMIN role) on the first, with no error anywhere.
 *
 * Every variant is fetched, the lowercase one included, and the OLDEST wins: that
 * is the account the parent has been using. Taking an exact lowercase match first
 * would instead send them to a newer, empty duplicate whenever one exists. The
 * User table is small, so the scan this needs is cheap.
 */
async function findOrCreateUser(
  prisma: PrismaClient,
  email: string,
  log: FastifyBaseLogger,
): Promise<{ id: string }> {
  // `contains` + insensitive runs as ILIKE '%…%' on Postgres: it also finds rows
  // stored with stray whitespace, and it over-matches ('ba@x.nl' for 'a@x.nl';
  // '%' and '_', valid in an address, may act as wildcards). The exact comparison
  // below keeps only true variants, whatever SQL Prisma emits.
  const candidates = await prisma.user.findMany({
    where: { email: { contains: email, mode: 'insensitive' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, email: true },
  })
  const variants = candidates.filter((u) => u.email.trim().toLowerCase() === email)
  if (variants.length > 1) {
    // Ids only: the address itself stays out of the logs.
    log.warn(
      { userIds: variants.map((u) => u.id) },
      'several accounts share one email address; signing in to the oldest, merge the others',
    )
  }
  if (variants.length > 0) return { id: variants[0].id }

  return prisma.user.create({ data: { email }, select: { id: true } })
}

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/magic — send magic link
  // Strict limit: prevents email enumeration and Resend abuse.
  app.post(
    '/magic',
    { config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } },
    async (req, reply) => {
    const parsed = MagicBody.safeParse(req.body)
    if (!parsed.success) {
      const badEmail = parsed.error.flatten().fieldErrors.email !== undefined
      return reply.status(400).send({
        error: 'BadRequest',
        message: badEmail ? 'A valid email address is required' : 'Invalid return path',
      })
    }
    // Lowercased so 'Marieke@x.nl' and 'marieke@x.nl' are one account, not two.
    const { email, next } = parsed.data
    const user = await findOrCreateUser(app.prisma, email, req.log)

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + MAGIC_TTL_MIN * 60 * 1000)
    await app.prisma.magicToken.create({ data: { token, userId: user.id, expiresAt } })

    // Deliberately PUBLIC_BASE_URL, not API_BASE_URL: /verify sets a host-only session
    // cookie, so it must run on the same host the web app lives on. nginx proxies
    // /api/* on app.tinyhike.com, so this stays same-origin and the cookie is usable
    // after the redirect below. Pointing at api.tinyhike.com would set the cookie on a
    // host the app never calls, and login would silently fail.
    // `next` travels in the link rather than in the browser's storage: the mail app
    // usually opens the link in another browser context (an in-app browser, or
    // Safari instead of the installed PWA) that cannot see the original tab.
    // Tampering with it only affects whoever holds the secret token.
    const link =
      `${process.env.PUBLIC_BASE_URL}/api/auth/verify?token=${token}` +
      (next ? `&next=${encodeURIComponent(next)}` : '')
    // The Resend SDK does NOT reject on API errors — it resolves with
    // { data: null, error: {...} }. Awaiting it without inspecting the result
    // reports success for every failed send: unverified domain, bad key, rejected
    // recipient. That's how this endpoint answered 200 "check your inbox" while
    // delivering nothing and logging nothing.
    const { error } = await resend.emails.send({
      from: `TinyHike <${process.env.RESEND_FROM_EMAIL}>`,
      to: email,
      subject: 'Your TinyHike login link',
      // '&' escaped: the link sits in an HTML attribute.
      html: `<p><a href="${link.replace(/&/g, '&amp;')}">Click here to sign in</a> — valid ${MAGIC_TTL_MIN} min.</p>`,
    })

    if (error) {
      // The from-address is config, not a secret, and it's the usual culprit
      // (sending domain not verified), so log it alongside the provider's reason.
      req.log.error({ err: error, from: process.env.RESEND_FROM_EMAIL }, 'magic link email failed')
      return reply.status(502).send({
        error: 'EmailFailed',
        message: 'We could not send the sign-in email. Please try again shortly.',
      })
    }

    return { ok: true }
  })

  // GET /api/auth/verify?token=…&next=… — consume magic link, set cookie, then
  // return the parent to where they asked to sign in (validated `next`, else '/').
  app.get(
    '/verify',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const query = VerifyQuery.safeParse(req.query)
    if (!query.success) {
      return reply.status(400).send({ error: 'InvalidToken', message: 'Invalid or expired sign-in link' })
    }
    const { token, next } = query.data
    const magic = await app.prisma.magicToken.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!magic || magic.usedAt || magic.expiresAt < new Date()) {
      return reply.status(400).send({ error: 'InvalidToken', message: 'Invalid or expired sign-in link' })
    }

    await app.prisma.magicToken.update({ where: { id: magic.id }, data: { usedAt: new Date() } })

    const jwt = await signSession({ sub: magic.userId, role: magic.user.role })
    reply
      .setCookie(SESSION_COOKIE, jwt, { ...SESSION_COOKIE_OPTIONS, maxAge: 60 * 60 * 24 * 30 })
      .redirect(process.env.PUBLIC_BASE_URL + (next ?? '/'))
  })

  // GET /api/auth/me
  app.get('/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = await app.prisma.user.findUnique({ where: { id: req.session!.sub } })
    if (!user) return reply.status(404).send({ error: 'NotFound', message: 'User not found' })
    return { id: user.id, email: user.email, handle: user.handle, role: user.role }
  })

  // POST /api/auth/logout
  app.post('/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS).send({ ok: true })
  })
}
