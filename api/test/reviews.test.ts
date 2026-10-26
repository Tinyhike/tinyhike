import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'

// Before any import reads it: plugins/auth.ts derives its key at load time, and
// dotenv never overrides a variable that is already set.
vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-only-jwt-secret'
})

import { buildApp } from '../src/app.js'
import { signSession, SESSION_COOKIE } from '../src/plugins/auth.js'
import { makePrismaMock, asPrisma, type PrismaMock } from './helpers.js'

const WRITTEN = { OR: [{ score: { not: null } }, { comment: { not: null } }] }
const URL = '/api/places/p1/reviews'

async function cookiesFor(sub: string, role = 'MEMBER') {
  return { [SESSION_COOKIE]: await signSession({ sub, role }) }
}

/** What Prisma returns for REVIEW_SELECT, echoing the data that was written. */
function echoRow(data: Record<string, unknown>, id = 'r-new') {
  return {
    id,
    score: data.score ?? null,
    comment: data.comment ?? null,
    tagsConfirmed: data.tagsConfirmed ?? [],
    tagsDisputed: data.tagsDisputed ?? [],
    anonymous: data.anonymous ?? true,
    createdAt: new Date('2026-10-23T09:00:00Z'),
    user: data.userId ? { handle: null } : null,
  }
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: Prisma.prismaVersion.client,
  })
}

describe('POST /api/places/:id/reviews', () => {
  let app: FastifyInstance
  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = makePrismaMock()
    prisma.place.findUnique.mockResolvedValue({
      id: 'p1',
      status: 'APPROVED',
      category: 'PLAYGROUND',
      verifiedAt: null,
      submittedById: null,
    })
    prisma.review.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => echoRow(data))
    prisma.review.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      echoRow(data, where.id),
    )
    app = await buildApp({ prisma: asPrisma(prisma), logger: false })
  })
  afterEach(async () => {
    await app.close()
  })

  const createData = (i = 0) => (prisma.review.create.mock.calls[i][0] as { data: Record<string, unknown> }).data

  describe('stars and comments need an account', () => {
    it.each([
      ['a score', { score: 5 }],
      ['a comment', { comment: 'Lovely park' }],
      ['a score with tags', { score: 2, tagsConfirmed: ['shaded'] }],
    ])('answers 401 for %s without a session', async (_label, payload) => {
      const res = await app.inject({ method: 'POST', url: URL, payload })
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'Unauthorized', message: 'Sign in to rate or comment' })
      expect(prisma.review.create).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('answers 401 for a score sent with a garbage cookie', async () => {
      const res = await app.inject({ method: 'POST', url: URL, payload: { score: 5 }, cookies: { [SESSION_COOKIE]: 'garbage' } })
      expect(res.statusCode).toBe(401)
      expect(prisma.review.create).not.toHaveBeenCalled()
    })
  })

  describe('tag-only votes stay one-tap and anonymous', () => {
    it('stores a vote with a garbage cookie as anonymous, never a 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        payload: { tagsConfirmed: ['hasChangingTable'] },
        cookies: { [SESSION_COOKIE]: 'garbage' },
      })
      expect(res.statusCode).toBe(201)
      expect(createData()).toEqual({
        placeId: 'p1',
        userId: null,
        tagsConfirmed: ['hasChangingTable'],
        tagsDisputed: [],
        anonymous: true,
      })
    })

    it('forces anonymous without a session, whatever the body says', async () => {
      await app.inject({ method: 'POST', url: URL, payload: { tagsDisputed: ['shaded'], anonymous: false } })
      expect(createData().anonymous).toBe(true)
      expect(createData().userId).toBeNull()
    })

    it('stores the userId of a signed-in voter, as a new row every time', async () => {
      const cookies = await cookiesFor('u1')
      const first = await app.inject({ method: 'POST', url: URL, payload: { tagsConfirmed: ['shaded'] }, cookies })
      const second = await app.inject({ method: 'POST', url: URL, payload: { tagsConfirmed: ['enclosed'] }, cookies })

      expect(first.statusCode).toBe(201)
      expect(second.statusCode).toBe(201)
      expect(createData(0).userId).toBe('u1')
      expect(createData(1).userId).toBe('u1')
      // Tag votes are not the one-per-parent written review.
      expect(prisma.review.update).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('answers with the public ReviewItem, never the userId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        payload: { tagsConfirmed: ['shaded'], anonymous: false },
        cookies: await cookiesFor('u1'),
      })
      const body = res.json()
      expect(Object.keys(body).sort()).toEqual(
        ['anonymous', 'comment', 'createdAt', 'id', 'score', 'tagsConfirmed', 'tagsDisputed', 'user'].sort(),
      )
      expect(res.body).not.toContain('u1')
      const select = (prisma.review.create.mock.calls[0][0] as { select: Record<string, unknown> }).select
      expect(select).not.toHaveProperty('userId')
    })
  })

  describe('one written review per parent per place', () => {
    it('creates the first one (201), signed and anonymous by default', async () => {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        payload: { score: 4, comment: '  Great slide  ' },
        cookies: await cookiesFor('u1'),
      })

      expect(res.statusCode).toBe(201)
      expect(createData()).toEqual({
        placeId: 'p1',
        userId: 'u1',
        score: 4,
        comment: 'Great slide', // trimmed
        tagsConfirmed: [],
        tagsDisputed: [],
        anonymous: true,
      })
      expect(res.json()).toMatchObject({ id: 'r-new', score: 4, comment: 'Great slide', anonymous: true, user: null })
      const lookup = prisma.review.findFirst.mock.calls[0][0] as { where: unknown }
      expect(lookup.where).toEqual({ placeId: 'p1', userId: 'u1', ...WRITTEN })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })

    it('updates the existing one (200) and replaces score and comment entirely', async () => {
      prisma.review.findFirst.mockResolvedValueOnce({ id: 'r-mine' })

      const before = Date.now()
      const res = await app.inject({ method: 'POST', url: URL, payload: { score: 2 }, cookies: await cookiesFor('u1') })

      expect(res.statusCode).toBe(200)
      expect(prisma.review.create).not.toHaveBeenCalled()
      const arg = prisma.review.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
      expect(arg.where).toEqual({ id: 'r-mine' })
      // The old comment is gone: an absent field becomes null, not "unchanged".
      // And the row is re-dated, so the revised opinion sorts and reads as today's.
      expect(arg.data).toEqual({
        score: 2,
        comment: null,
        tagsConfirmed: [],
        tagsDisputed: [],
        anonymous: true,
        createdAt: expect.any(Date),
      })
      expect((arg.data.createdAt as Date).getTime()).toBeGreaterThanOrEqual(before)
      expect((arg.data.createdAt as Date).getTime()).toBeLessThanOrEqual(Date.now())
      expect(res.json().id).toBe('r-mine')
    })

    it('turns a lost insert race (P2002) into an update of the winning row', async () => {
      // Both requests saw nothing; this one's insert loses to the partial unique index.
      prisma.review.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'r-winner' })
      prisma.review.create.mockRejectedValueOnce(p2002())

      const res = await app.inject({ method: 'POST', url: URL, payload: { score: 5 }, cookies: await cookiesFor('u1') })

      expect(res.statusCode).toBe(200)
      expect(prisma.$transaction).toHaveBeenCalledTimes(2) // the retry runs in a fresh transaction
      const arg = prisma.review.update.mock.calls[0][0] as { where: unknown }
      expect(arg.where).toEqual({ id: 'r-winner' })
    })

    it('does not swallow other database errors', async () => {
      prisma.review.create.mockRejectedValueOnce(new Error('connection lost'))
      const res = await app.inject({ method: 'POST', url: URL, payload: { score: 5 }, cookies: await cookiesFor('u1') })
      expect(res.statusCode).toBe(500)
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })

    it('drops a blank comment that rides along with a score', async () => {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        payload: { score: 3, comment: '   ' },
        cookies: await cookiesFor('u1'),
      })
      expect(res.statusCode).toBe(201)
      expect(createData().comment).toBeNull()
    })

    it('honours anonymous: false from a signed-in parent', async () => {
      await app.inject({ method: 'POST', url: URL, payload: { score: 3, anonymous: false }, cookies: await cookiesFor('u1') })
      expect(createData().anonymous).toBe(false)
    })
  })

  describe('validation', () => {
    it.each([
      ['an unknown tag', { tagsConfirmed: ['Gratis-ijs-bij-www.spam.example'] }],
      ['a duplicate tag', { tagsConfirmed: ['shaded', 'shaded'] }],
      ['a tag both confirmed and disputed', { tagsConfirmed: ['shaded'], tagsDisputed: ['shaded'] }],
      ['a whitespace-only comment', { comment: '  \n\t  ' }],
      ['a zero-width-only comment', { comment: '\u200B\u200C \u200D\uFEFF' }],
      // Invisible characters String.trim() leaves in place. Each one alone used
      // to be stored as a comment and shown as an empty review.
      ['a word-joiner-only comment', { comment: '\u2060' }],
      ['a left-to-right-mark-only comment', { comment: '\u200E' }],
      ['a right-to-left-mark-only comment', { comment: '\u200F' }],
      ['a bidi-override-only comment', { comment: '\u202E' }],
      ['a soft-hyphen-only comment', { comment: '\u00AD' }],
      ['a Mongolian-vowel-separator-only comment', { comment: '\u180E' }],
      ['a variation-selector-only comment', { comment: '\uFE0F' }],
      ['a combining-grapheme-joiner-only comment', { comment: '\u034F' }],
      ['a lone combining accent', { comment: '\u0301' }],
      // Classed as letters or symbols by Unicode, yet they render blank.
      ['a Hangul-filler-only comment', { comment: '\u3164' }],
      ['a Hangul-choseong-filler-only comment', { comment: '\u115F' }],
      ['a Hangul-jungseong-filler-only comment', { comment: '\u1160' }],
      ['a halfwidth-Hangul-filler-only comment', { comment: '\uFFA0' }],
      ['a braille-blank-only comment', { comment: '\u2800' }],
      ['a mix of invisible characters and spaces', { comment: ' \u2060\u00AD \u3164\u2800\u200E\u3000 ' }],
      ['an empty body', {}],
      ['a score out of range', { score: 6 }],
      ['a fractional score', { score: 4.5 }],
      ['a comment over 500 characters', { comment: 'a'.repeat(501) }],
    ])('rejects %s with 400 and writes nothing', async (_label, payload) => {
      // Signed in, so a 400 can't be a 401 in disguise.
      const res = await app.inject({ method: 'POST', url: URL, payload, cookies: await cookiesFor('u1') })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: 'BadRequest', message: 'Invalid review' })
      expect(res.json().details).toBeDefined()
      expect(prisma.review.create).not.toHaveBeenCalled()
      expect(prisma.review.update).not.toHaveBeenCalled()
    })

    it.each([
      ['an emoji-only comment', '👍'],
      ['an emoji with a variation selector', '\u2764\uFE0F'],
      ['a word with a soft hyphen in it', 'stroller\u00ADfriendly'],
      ['a Korean comment', '좋아요'],
      ['a single digit', '5'],
    ])('keeps %s as a comment', async (_label, comment) => {
      const res = await app.inject({ method: 'POST', url: URL, payload: { comment }, cookies: await cookiesFor('u1') })
      expect(res.statusCode).toBe(201)
      expect(createData().comment).toBe(comment)
    })

    it('counts the 500-character limit after trimming', async () => {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        payload: { comment: `   ${'a'.repeat(500)}   ` },
        cookies: await cookiesFor('u1'),
      })
      expect(res.statusCode).toBe(201)
    })

    it('rejects an oversize body with 413 before it is parsed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        payload: { tagsConfirmed: ['shaded'], padding: 'x'.repeat(9000) },
      })
      expect(res.statusCode).toBe(413)
      expect(prisma.review.create).not.toHaveBeenCalled()
    })
  })

  describe('place visibility', () => {
    it('is 404 for an unknown place', async () => {
      prisma.place.findUnique.mockResolvedValueOnce(null)
      const res = await app.inject({ method: 'POST', url: URL, payload: { tagsConfirmed: ['shaded'] } })
      expect(res.statusCode).toBe(404)
      expect(prisma.review.create).not.toHaveBeenCalled()
    })

    it('is 404 for a PENDING place, except for its submitter', async () => {
      prisma.place.findUnique.mockResolvedValue({ id: 'p1', status: 'PENDING', submittedById: 'u-submitter' })

      const stranger = await app.inject({ method: 'POST', url: URL, payload: { tagsConfirmed: ['shaded'] } })
      expect(stranger.statusCode).toBe(404)

      const own = await app.inject({
        method: 'POST',
        url: URL,
        payload: { tagsConfirmed: ['shaded'] },
        cookies: await cookiesFor('u-submitter'),
      })
      expect(own.statusCode).toBe(201)
    })
  })

  describe('rate limit', () => {
    const from = (ip: string) => ({ 'x-forwarded-for': ip })

    it('allows 30 per minute per client, with an IPv6 /64 counted as one client', async () => {
      for (let i = 1; i <= 30; i++) {
        const res = await app.inject({
          method: 'POST',
          url: URL,
          payload: { tagsConfirmed: ['shaded'] },
          headers: from(`2001:db8:5:6::${i.toString(16)}`),
        })
        expect(res.statusCode).toBe(201)
      }
      const sameNet = await app.inject({
        method: 'POST',
        url: URL,
        payload: { tagsConfirmed: ['shaded'] },
        headers: from('2001:db8:5:6:abcd::9'),
      })
      expect(sameNet.statusCode).toBe(429)

      const elsewhere = await app.inject({
        method: 'POST',
        url: URL,
        payload: { tagsConfirmed: ['shaded'] },
        headers: from('203.0.113.7'),
      })
      expect(elsewhere.statusCode).toBe(201)
    })
  })
})
