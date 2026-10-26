import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

// Resend is mocked so no test can send an email. `send` resolves like the real SDK:
// { data, error }, never a rejection. JWT_SECRET is set before any import reads it
// (dotenv never overrides it), so /verify signs with a test-only key.
const { send } = vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-only-jwt-secret'
  return { send: vi.fn() }
})
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import { buildApp } from '../src/app.js'
import { NEXT_PATH } from '../src/routes/auth.js'
import { SESSION_COOKIE, signSession } from '../src/plugins/auth.js'
import { makePrismaMock, asPrisma } from './helpers.js'

/**
 * The shared mock plus user.findMany, which /magic uses to find an account stored
 * with different capitals or stray whitespace. Spread, so the vi.fn() references stay assertable.
 */
function makeAuthMock() {
  const mock = makePrismaMock()
  return { ...mock, user: { ...mock.user, findMany: vi.fn().mockResolvedValue([]) } }
}
type AuthMock = ReturnType<typeof makeAuthMock>

const BASE = 'https://app.example.test'
const TOKEN = 'a'.repeat(64)

/** Paths a crafted link could use to bounce a freshly signed-in parent off-site. */
const HOSTILE_NEXT = [
  '//evil.com',
  '/\\evil.com',
  '@evil.com',
  'https://evil.com',
  '/places/../x',
  '/places/abc?x=1',
  '.evil.com',
  '/places/abc#x',
  '/places/ABC',
  '/places/',
  '/profile/',
  '/%2F%2Fevil.com',
  '/places/abc\n',
  ' /profile',
]

describe('NEXT_PATH', () => {
  it.each(['/', '/profile', '/lists', '/places/ckz1abc2def3ghi4jkl5mno6p'])('accepts %s', (path) => {
    expect(NEXT_PATH.test(path)).toBe(true)
  })

  it.each(HOSTILE_NEXT)('refuses %j', (path) => {
    expect(NEXT_PATH.test(path)).toBe(false)
  })
})

describe('POST /api/auth/magic — rate limiting (Phase 0)', () => {
  let app: FastifyInstance
  afterEach(async () => {
    await app.close()
  })

  it('allows 5 requests then returns 429 on the 6th (5 / 5min per IP)', async () => {
    app = await buildApp({ prisma: asPrisma(makePrismaMock()), logger: false })

    const codes: number[] = []
    for (let i = 0; i < 6; i++) {
      // Invalid email → the handler returns 400, but the rate limiter runs first
      // as an onRequest hook, so the 6th request is blocked at 429 regardless.
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/magic',
        payload: { email: 'not-an-email' },
      })
      codes.push(res.statusCode)
    }

    expect(codes.slice(0, 5)).toEqual([400, 400, 400, 400, 400])
    expect(codes[5]).toBe(429)
  })

  it('the 429 body is shaped by the global error handler ({ error, message })', async () => {
    app = await buildApp({ prisma: asPrisma(makePrismaMock()), logger: false })

    let last = await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'x' } })
    for (let i = 0; i < 6; i++) {
      last = await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'x' } })
    }
    expect(last.statusCode).toBe(429)
    const body = last.json() as { error?: string; message?: string }
    expect(body.message).toBeTruthy()
    // never a raw stack trace
    expect(JSON.stringify(body)).not.toMatch(/at .*\(.*:\d+:\d+\)/)
  })
})

describe('magic link return path', () => {
  let app: FastifyInstance
  let prisma: AuthMock

  beforeEach(async () => {
    vi.stubEnv('PUBLIC_BASE_URL', BASE)
    send.mockReset()
    send.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    prisma = makeAuthMock()
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
  })
  afterEach(async () => {
    await app.close()
    vi.unstubAllEnvs()
  })

  /** The href of the link in the email Resend was asked to send. */
  function emailedLink(): string {
    const { html } = send.mock.calls[0][0] as { html: string }
    const href = html.match(/href="([^"]+)"/)?.[1] ?? ''
    return href.replace(/&amp;/g, '&')
  }

  describe('POST /api/auth/magic', () => {
    it('carries a valid next in the emailed link', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/magic',
        payload: { email: 'parent@example.nl', next: '/places/ckabc123' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
      const link = new URL(emailedLink())
      expect(link.origin + link.pathname).toBe(`${BASE}/api/auth/verify`)
      expect(link.searchParams.get('next')).toBe('/places/ckabc123')
      expect(link.searchParams.get('token')).toMatch(/^[0-9a-f]{64}$/)
    })

    it('leaves next out of the link when none was given', async () => {
      await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'parent@example.nl' } })
      expect(emailedLink()).toMatch(new RegExp(`^${BASE}/api/auth/verify\\?token=[0-9a-f]{64}$`))
    })

    it('trims and lowercases the email, so one address is one account', async () => {
      await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: '  Parent@Example.NL ' } })
      const arg = prisma.user.findMany.mock.calls[0][0] as { where: { email: { contains: string } } }
      expect(arg.where.email.contains).toBe('parent@example.nl')
      expect((send.mock.calls[0][0] as { to: string }).to).toBe('parent@example.nl')
    })

    // zod's .email() refuses these, though each is a real, deliverable address
    // that an existing account may use.
    it.each([
      ['jan@café.nl'],
      ['jan&piet@example.nl'],
      ['a!b@example.nl'],
      ['jan%x@example.nl'],
      ['jöran@example.nl'],
      ["o'brien@example.nl"],
      ['jan+tinyhike@example.co.uk'],
    ])('accepts the valid address %j', async (email) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email } })
      expect(res.statusCode).toBe(200)
      expect((send.mock.calls[0][0] as { to: string }).to).toBe(email)
    })

    describe('finding the account', () => {
      /** The userId the magic token was issued for. */
      const tokenUser = () => (prisma.magicToken.create.mock.calls[0][0] as { data: { userId: string } }).data.userId

      it('looks up every variant, oldest first, and reuses the lowercase account', async () => {
        prisma.user.findMany.mockResolvedValueOnce([{ id: 'u-exact', email: 'parent@example.nl' }])

        await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'parent@example.nl' } })

        expect(tokenUser()).toBe('u-exact')
        expect(prisma.user.create).not.toHaveBeenCalled()
        const arg = prisma.user.findMany.mock.calls[0][0] as { where: unknown; orderBy: unknown }
        expect(arg.where).toEqual({ email: { contains: 'parent@example.nl', mode: 'insensitive' } })
        expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
      })

      it('reuses an older account stored with capitals instead of opening a second one', async () => {
        prisma.user.findMany.mockResolvedValueOnce([{ id: 'u-old', email: 'Parent@Example.nl' }])

        const res = await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'parent@example.nl' } })

        expect(res.statusCode).toBe(200)
        expect(tokenUser()).toBe('u-old')
        expect(prisma.user.create).not.toHaveBeenCalled()
      })

      it('reuses an older account stored with stray whitespace', async () => {
        prisma.user.findMany.mockResolvedValueOnce([{ id: 'u-spaced', email: 'Parent@example.nl ' }])
        await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'parent@example.nl' } })
        expect(tokenUser()).toBe('u-spaced')
        expect(prisma.user.create).not.toHaveBeenCalled()
      })

      it('prefers the oldest variant over a newer lowercase duplicate, and logs both ids', async () => {
        // The account in use ('Marieke@…' on a phone) and an empty one opened
        // later from a laptop: the parent must land in the first.
        prisma.user.findMany.mockResolvedValueOnce([
          { id: 'u-first', email: 'PARENT@example.nl' },
          { id: 'u-second', email: 'parent@example.nl' },
        ])
        const warn = vi.spyOn(app.log, 'warn')

        await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'parent@example.nl' } })

        expect(tokenUser()).toBe('u-first')
        expect(warn).toHaveBeenCalledWith({ userIds: ['u-first', 'u-second'] }, expect.any(String))
      })

      it('keeps only true variants of what the lookup over-matches', async () => {
        // What ILIKE '%jan_de@example.nl%' also matches: different addresses.
        prisma.user.findMany.mockResolvedValueOnce([
          { id: 'u-other', email: 'janxde@example.nl' },
          { id: 'u-longer', email: 'marijan_de@example.nl' },
        ])
        prisma.user.create.mockResolvedValueOnce({ id: 'u-new' })

        await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'jan_de@example.nl' } })

        expect(tokenUser()).toBe('u-new')
        expect(prisma.user.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: { email: 'jan_de@example.nl' } }),
        )
      })

      it('creates the account, lowercased, when no variant exists', async () => {
        prisma.user.create.mockResolvedValueOnce({ id: 'u-new' })
        await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'New@Example.nl' } })
        expect(tokenUser()).toBe('u-new')
        expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: { email: 'new@example.nl' } }))
      })
    })

    it.each(HOSTILE_NEXT)('refuses next=%j with 400 and sends nothing', async (next) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/magic',
        payload: { email: 'parent@example.nl', next },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'BadRequest', message: 'Invalid return path' })
      expect(prisma.user.findMany).not.toHaveBeenCalled()
      expect(prisma.magicToken.create).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
    })

    it.each([
      ['not-an-email'],
      ['a'.repeat(250) + '@x.nl'],
      [''],
      ['jan@localhost'],
      ['jan piet@example.nl'],
      ['jan@piet@example.nl'],
      ['"jan"@example.nl'],
      ['jan\\@example.nl'],
      ['Jan <jan@example.nl>'],
      ['x<jan@example.nl>'],
      ['jan@example.nl,other@example.nl'],
      ['jan@[192.0.2.1]'],
    ])('refuses email %j with 400', async (email) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email } })
      expect(res.statusCode).toBe(400)
      expect(res.json().message).toBe('A valid email address is required')
      expect(send).not.toHaveBeenCalled()
    })

    it('still reports a failed send as 502 (the SDK resolves, it does not throw)', async () => {
      send.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'domain not verified' } })
      const res = await app.inject({ method: 'POST', url: '/api/auth/magic', payload: { email: 'parent@example.nl' } })
      expect(res.statusCode).toBe(502)
      expect(res.json().error).toBe('EmailFailed')
    })
  })

  describe('GET /api/auth/verify', () => {
    function validToken() {
      prisma.magicToken.findUnique.mockResolvedValueOnce({
        id: 't1',
        token: TOKEN,
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: 'u1', role: 'MEMBER' },
      })
    }

    it('signs in and returns the parent to a valid next', async () => {
      validToken()
      const res = await app.inject({
        method: 'GET',
        url: `/api/auth/verify?token=${TOKEN}&next=${encodeURIComponent('/places/ckabc123')}`,
      })

      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe(`${BASE}/places/ckabc123`)
      const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)
      expect(cookie?.value).toBeTruthy()
      expect(prisma.magicToken.update).toHaveBeenCalledTimes(1) // single use
    })

    it('goes to the map when there is no next', async () => {
      validToken()
      const res = await app.inject({ method: 'GET', url: `/api/auth/verify?token=${TOKEN}` })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe(`${BASE}/`)
    })

    it.each(HOSTILE_NEXT)('falls back to / for next=%j and still signs in', async (next) => {
      validToken()
      const res = await app.inject({
        method: 'GET',
        url: `/api/auth/verify?token=${TOKEN}&next=${encodeURIComponent(next)}`,
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe(`${BASE}/`)
      expect(res.cookies.some((c) => c.name === SESSION_COOKIE)).toBe(true)
    })

    it('falls back to / when next is repeated', async () => {
      validToken()
      const res = await app.inject({ method: 'GET', url: `/api/auth/verify?token=${TOKEN}&next=/profile&next=/lists` })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe(`${BASE}/`)
    })

    it('refuses a malformed token without touching the database', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/verify?token=nope&next=/profile' })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('InvalidToken')
      expect(prisma.magicToken.findUnique).not.toHaveBeenCalled()
    })

    it('refuses a missing token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/verify' })
      expect(res.statusCode).toBe(400)
    })

    it.each([
      ['unknown', null],
      ['used', { id: 't1', userId: 'u1', usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), user: { role: 'MEMBER' } }],
      ['expired', { id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() - 1), user: { role: 'MEMBER' } }],
    ])('refuses an %s token with 400 and no cookie', async (_label, row) => {
      prisma.magicToken.findUnique.mockResolvedValueOnce(row)
      const res = await app.inject({ method: 'GET', url: `/api/auth/verify?token=${TOKEN}&next=/profile` })
      expect(res.statusCode).toBe(400)
      expect(res.cookies.some((c) => c.name === SESSION_COOKIE)).toBe(false)
      expect(prisma.magicToken.update).not.toHaveBeenCalled()
    })
  })
})

describe('GET /api/auth/me', () => {
  let app: FastifyInstance
  let prisma: AuthMock

  beforeEach(async () => {
    prisma = makeAuthMock()
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  const signedIn = async () => ({ [SESSION_COOKIE]: await signSession({ sub: 'u1', role: 'MEMBER' }) })

  it('answers the public profile fields only', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'parent@example.nl',
      handle: null,
      role: 'MEMBER',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: await signedIn() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: 'u1', email: 'parent@example.nl', handle: null, role: 'MEMBER' })
  })

  it('is 401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
  })

  it('is 404 with a { error, message } body once the account is gone', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: await signedIn() })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'NotFound', message: 'User not found' })
  })
})
