import { FastifyInstance } from 'fastify'
import { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth, optionalAuth } from '../plugins/auth.js'
import { clientKey } from '../lib/client-key.js'
import { TAG_KEYS } from '../lib/tags.js'
import {
  canSeePlace,
  publicPlaceWhere,
  withoutPrivateColumns,
  PRIVATE_PLACE_OMIT,
  VISIBILITY_SELECT,
} from '../lib/place-visibility.js'

const PlaceSubmitSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  locale: z.string().default('en'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  tips: z.string().max(300).optional(),
  // What the parent says the place is. A moderator approves the proposal; a café
  // (or no category) still stays hidden until verified.
  category: z.enum(['PLAYGROUND', 'PARK', 'PICNIC_SITE', 'CAFE']).optional(),
})

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

/** Written reviews shown with the place detail; older ones come from GET /:id/reviews. */
const DETAIL_REVIEWS = 20
const DEFAULT_REVIEW_PAGE = 20
const MAX_REVIEW_PAGE = 50

/**
 * The public face of a review. Explicit select: the raw row carries userId, and
 * the user relation would carry email — neither belongs in a public response.
 * Every review payload (detail, pagination, POST) goes through this select and
 * then toReviewItem(), so they cannot drift apart.
 */
const REVIEW_SELECT = {
  id: true,
  score: true,
  comment: true,
  tagsConfirmed: true,
  tagsDisputed: true,
  anonymous: true,
  createdAt: true,
  user: { select: { handle: true } },
} satisfies Prisma.ReviewSelect

type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SELECT }>

export interface ReviewItem {
  id: string
  score: number | null
  comment: string | null
  tagsConfirmed: string[]
  tagsDisputed: string[]
  anonymous: boolean
  createdAt: Date
  user: { handle: string | null } | null
}

/**
 * Builds the response field by field rather than spreading the row, so a column
 * added to REVIEW_SELECT later is not published by accident.
 */
function toReviewItem(r: ReviewRow): ReviewItem {
  return {
    id: r.id,
    score: r.score,
    comment: r.comment,
    tagsConfirmed: r.tagsConfirmed,
    tagsDisputed: r.tagsDisputed,
    anonymous: r.anonymous,
    createdAt: r.createdAt,
    // An anonymous review keeps its author out of the payload entirely.
    user: r.anonymous || !r.user ? null : { handle: r.user.handle },
  }
}

/**
 * A "written" review carries stars and/or a comment: that is what the feed lists
 * and counts. A one-tap amenity vote (tags only) is not a review a parent reads;
 * mixed into the feed, those rows would push real reviews out of the window.
 * Same predicate as the partial unique index "Review_one_written_per_user_per_place".
 */
const WRITTEN = { OR: [{ score: { not: null } }, { comment: { not: null } }] } satisfies Prisma.ReviewWhereInput
const TAG_ONLY = { score: null, comment: null } satisfies Prisma.ReviewWhereInput

// Newest first; id breaks createdAt ties so cursor pagination never skips or
// repeats a row.
const REVIEW_ORDER = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.ReviewOrderByWithRelationInput[]

const NOT_FOUND = { error: 'NotFound', message: 'Place not found' } as const

/**
 * A comment counts only if a reader can see something in it. Letters, digits,
 * punctuation and symbols (emoji included) are visible. Spaces, format characters
 * (zero-width space and joiners, word joiner, soft hyphen, bidi marks), variation
 * selectors and combining marks with no base are not. String.prototype.trim()
 * removes only the spaces, so a denylist of invisible characters would always miss
 * one. A few code points are classed as letters or symbols yet render blank:
 * the Hangul fillers and the braille blank. Those are removed before the test.
 */
const BLANK_LETTERS = /[\u115F\u1160\u3164\uFFA0\u2800]/gu
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u
function hasVisibleText(s: string): boolean {
  return VISIBLE.test(s.replace(BLANK_LETTERS, ''))
}

/** Tag votes are column names, never free text: anything else would render as a "✓ confirmed" chip. */
const TagList = z
  .array(z.enum(TAG_KEYS))
  .max(TAG_KEYS.length)
  .refine((tags) => new Set(tags).size === tags.length, { message: 'Duplicate tag' })
  .default([])

const ReviewSchema = z
  .object({
    // Optional: a tag confirmation ("yes, there's a changing table") is a review
    // with only tagsConfirmed/tagsDisputed. Forcing a star rating on it would
    // either block the lightest contribution or pollute the score average.
    score: z.number().int().min(1).max(5).optional(),
    tagsConfirmed: TagList,
    tagsDisputed: TagList,
    // Trimmed first, so the 500 limit counts the text that is kept. A comment
    // with no visible character counts as no comment at all, which lets the
    // "must carry something" refine below reject a blank-only review.
    comment: z
      .string()
      .trim()
      .max(500)
      .transform((s) => (hasVisibleText(s) ? s : undefined))
      .optional(),
    // Display-only: userId is still stored for dedupe and moderation. Defaults to
    // anonymous because nothing in the app lets a parent set a handle yet.
    anonymous: z.boolean().default(true),
  })
  .refine(
    (r) => r.score !== undefined || r.comment !== undefined || r.tagsConfirmed.length > 0 || r.tagsDisputed.length > 0,
    { message: 'A review must carry a score, a comment, or at least one tag vote' },
  )
  // The same tag both confirmed and disputed is a contradiction, not a vote.
  .refine((r) => !r.tagsConfirmed.some((tag) => r.tagsDisputed.includes(tag)), {
    message: 'A tag cannot be both confirmed and disputed',
  })

const ReviewPageQuery = z.object({
  // Review ids are cuids. Anything else cannot be a cursor this API handed out.
  cursor: z
    .string()
    .regex(/^[a-z0-9]{1,40}$/)
    .optional(),
  take: z.coerce.number().int().min(1).max(MAX_REVIEW_PAGE).default(DEFAULT_REVIEW_PAGE),
})

interface WrittenReviewData {
  score: number | null
  comment: string | null
  tagsConfirmed: string[]
  tagsDisputed: string[]
  anonymous: boolean
}

/**
 * One written review per parent per place: update the caller's existing one, or
 * create it. Posting again replaces the score and the comment entirely.
 *
 * Two concurrent first posts from the same parent can both find nothing and both
 * insert; the partial unique index lets only one win and the loser gets P2002.
 * A unique violation aborts a Postgres transaction, so the retry runs in a fresh
 * one, where findFirst now sees the winner's row and updates it.
 */
async function saveWrittenReview(
  prisma: PrismaClient,
  placeId: string,
  userId: string,
  data: WrittenReviewData,
): Promise<{ row: ReviewRow; created: boolean }> {
  const attempt = () =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.review.findFirst({
        where: { placeId, userId, ...WRITTEN },
        orderBy: REVIEW_ORDER,
        select: { id: true },
      })
      if (existing) {
        // Re-dated: the feed is ordered and dated by createdAt, and a revised
        // opinion is the parent's latest one. Keeping the first date would leave
        // today's 1 star labelled "a year ago" and buried below newer reviews.
        // A client paging through the feed may then meet this row twice; the web
        // de-duplicates reviews by id.
        const row = await tx.review.update({
          where: { id: existing.id },
          data: { ...data, createdAt: new Date() },
          select: REVIEW_SELECT,
        })
        return { row, created: false }
      }
      const row = await tx.review.create({ data: { placeId, userId, ...data }, select: REVIEW_SELECT })
      return { row, created: true }
    })

  try {
    return await attempt()
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return attempt()
    throw err
  }
}

export default async function placesRoutes(app: FastifyInstance) {
  // GET /api/places?bbox=west,south,east,north&locale=nl&limit=200
  app.get<{ Querystring: { bbox?: string; locale?: string; limit?: string } }>('/', async (req, reply) => {
    const { bbox, locale = 'nl', limit: rawLimit } = req.query
    // Public places only (lib/place-visibility.ts): unverified cafés never reach the
    // map, and the X-Total-Count below counts with the same filter.
    const where: Prisma.PlaceWhereInput = { ...publicPlaceWhere }

    let limit = DEFAULT_LIMIT
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        return reply.status(400).send({ error: 'BadRequest', message: `limit must be an integer between 1 and ${MAX_LIMIT}` })
      }
      limit = parsed
    }

    // bbox filter (lat/lng range). Validate before use so malformed input can't
    // silently produce NaN bounds and a broken/empty filter.
    if (bbox) {
      const parts = bbox.split(',').map(Number)
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        return reply.status(400).send({ error: 'BadRequest', message: 'bbox must be "west,south,east,north" numbers' })
      }
      const [west, south, east, north] = parts
      if (west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) {
        return reply.status(400).send({ error: 'BadRequest', message: 'bbox out of range or inverted' })
      }
      where.lat = { gte: south, lte: north }
      where.lng = { gte: west, lte: east }
    }

    // Fetch one more than asked for: if it comes back, the viewport holds more
    // places than we're returning. Cheaper than a COUNT on every map pan, and the
    // client needs to know — silently dropping pins reads as missing data.
    const rows = await app.prisma.place.findMany({
      where,
      // Who submitted or verified a place is internal: joined with a public list
      // owner's id it would attribute every contribution to a named parent. The
      // verification date stays private too.
      omit: PRIVATE_PLACE_OMIT,
      include: {
        translations: { where: { locale } },
        // Explicit select: a Photo row also carries uploadedById, r2Key and the
        // moderator's note.
        photos: { where: { status: 'APPROVED' }, take: 1, select: { id: true, r2Url: true } },
        _count: { select: { reviews: true } },
      },
      take: limit + 1,
    })

    const truncated = rows.length > limit
    const places = truncated ? rows.slice(0, limit) : rows

    reply.header('X-Result-Truncated', String(truncated))
    if (truncated) {
      // Only now is the exact total worth a second query.
      reply.header('X-Total-Count', String(await app.prisma.place.count({ where })))
    } else {
      reply.header('X-Total-Count', String(places.length))
    }

    return places
  })

  // GET /api/places/:id?locale=nl
  // optionalAuth: a place the public can't see (pending, or an unverified café)
  // is visible to the parent who submitted it and to admins, so the session is
  // read when there is one.
  app.get<{ Params: { id: string }; Querystring: { locale?: string } }>(
    '/:id',
    { preHandler: optionalAuth },
    async (req, reply) => {
      const place = await app.prisma.place.findUnique({
        where: { id: req.params.id },
        include: {
          translations: true,
          photos: { where: { status: 'APPROVED' }, select: { id: true, r2Url: true, createdAt: true } },
          reviews: { where: WRITTEN, orderBy: REVIEW_ORDER, take: DETAIL_REVIEWS, select: REVIEW_SELECT },
        },
      })
      if (!place || !canSeePlace(place, req.session)) return reply.status(404).send(NOT_FOUND)

      const [reviewCount, voteCount, agg] = await Promise.all([
        app.prisma.review.count({ where: { placeId: place.id, ...WRITTEN } }),
        app.prisma.review.count({ where: { placeId: place.id, ...TAG_ONLY } }),
        // The average over ALL rated reviews, not just the 20 loaded — and only over
        // reviews that carry a score: tag-only confirmations aren't ratings.
        app.prisma.review.aggregate({
          where: { placeId: place.id, score: { not: null } },
          _avg: { score: true },
          _count: { score: true },
        }),
      ])

      // submittedById and verifiedAt are loaded for the visibility check above and
      // stripped here, with verifiedById and updatedAt: canSeePlace needs the first
      // two, the public needs none of them.
      const { reviews, ...columns } = place
      const last = reviews.at(-1)
      return {
        ...withoutPrivateColumns(columns),
        reviews: reviews.map(toReviewItem),
        reviewCount,
        voteCount,
        scoreAvg: agg._avg.score,
        scoreCount: agg._count.score,
        nextCursor: last && reviewCount > reviews.length ? last.id : null,
      }
    },
  )

  // GET /api/places/:id/reviews?cursor=<reviewId>&take=20 — older written reviews,
  // in the same order as the detail's first page.
  app.get<{ Params: { id: string } }>('/:id/reviews', { preHandler: optionalAuth }, async (req, reply) => {
    const query = ReviewPageQuery.safeParse(req.query)
    if (!query.success) {
      return reply
        .status(400)
        .send({ error: 'BadRequest', message: 'Invalid cursor or page size', details: query.error.flatten() })
    }
    const { cursor, take } = query.data

    const place = await app.prisma.place.findUnique({ where: { id: req.params.id }, select: VISIBILITY_SELECT })
    if (!place || !canSeePlace(place, req.session)) return reply.status(404).send(NOT_FOUND)

    if (cursor) {
      // Prisma treats an unknown cursor as "nothing after it" and returns an empty
      // page, which reads as "no more reviews". A cursor from another place, or a
      // tag-only row, is a client bug: say so.
      const anchor = await app.prisma.review.findFirst({
        where: { id: cursor, placeId: place.id, ...WRITTEN },
        select: { id: true },
      })
      if (!anchor) return reply.status(400).send({ error: 'BadRequest', message: 'Unknown cursor' })
    }

    // One extra row tells whether another page exists without a COUNT.
    const rows = await app.prisma.review.findMany({
      where: { placeId: place.id, ...WRITTEN },
      orderBy: REVIEW_ORDER,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: REVIEW_SELECT,
    })
    const page = rows.slice(0, take)
    const last = page.at(-1)
    return {
      reviews: page.map(toReviewItem),
      nextCursor: last && rows.length > take ? last.id : null,
    }
  })

  // GET /api/places/:id/my-review — the caller's own written review, to prefill
  // the form: posting again updates it rather than adding a second one. A place
  // the caller can't see is a 404 here too, review or not.
  app.get<{ Params: { id: string } }>('/:id/my-review', { preHandler: requireAuth }, async (req, reply) => {
    const place = await app.prisma.place.findUnique({ where: { id: req.params.id }, select: VISIBILITY_SELECT })
    if (!place || !canSeePlace(place, req.session)) return reply.status(404).send(NOT_FOUND)

    const mine = await app.prisma.review.findFirst({
      where: { placeId: place.id, userId: req.session!.sub, ...WRITTEN },
      orderBy: REVIEW_ORDER,
      select: { score: true, comment: true },
    })
    return mine ?? null
  })

  // POST /api/places — authenticated user submission
  app.post('/', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = PlaceSubmitSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Invalid place', details: parsed.error.flatten() })
    }
    const { lat, lng, locale, name, description, tips, category } = parsed.data

    const place = await app.prisma.place.create({
      data: {
        lat,
        lng,
        category,
        source: 'USER',
        status: 'PENDING',
        submittedById: req.session!.sub,
        translations: { create: { locale, name, description, tips } },
      },
      include: { translations: true },
    })
    return reply.status(201).send(place)
  })

  // POST /api/places/:id/reviews
  // Stars and comments need an account (one written review per parent per place);
  // a one-tap amenity vote does not. optionalAuth reads the session when there is
  // one, and never turns a stale cookie into a 401 for a tag vote.
  app.post<{ Params: { id: string } }>(
    '/:id/reviews',
    {
      // The largest legitimate body (a 500-character comment and every tag key) is
      // well under 4 KB. The cap keeps a request bounded even if a field is ever
      // added without its own length limit.
      bodyLimit: 8192,
      preHandler: optionalAuth,
      // 30/min: the amenity list invites a quick run of one-tap votes, each its own
      // POST, and a review on top must still get through.
      config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (req) => clientKey(req.ip) } },
    },
    async (req, reply) => {
      const parsed = ReviewSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Invalid review', details: parsed.error.flatten() })
      }
      const { score, comment, tagsConfirmed, tagsDisputed } = parsed.data
      const session = req.session
      const written = score !== undefined || comment !== undefined

      // Without an account, nothing stops one client from posting a rating over
      // and over and dragging a place's average wherever it likes.
      if (written && !session) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Sign in to rate or comment' })
      }

      const place = await app.prisma.place.findUnique({ where: { id: req.params.id }, select: VISIBILITY_SELECT })
      if (!place || !canSeePlace(place, session)) return reply.status(404).send(NOT_FOUND)

      // A row with no userId has no author to show, so it is always anonymous.
      const anonymous = session ? parsed.data.anonymous : true

      if (!written) {
        // Tag-only vote: each one is its own row, signed in or not.
        const row = await app.prisma.review.create({
          data: { placeId: place.id, userId: session?.sub ?? null, tagsConfirmed, tagsDisputed, anonymous },
          select: REVIEW_SELECT,
        })
        return reply.status(201).send(toReviewItem(row))
      }

      // A written review always has a session here: the 401 above returned otherwise.
      const { row, created } = await saveWrittenReview(app.prisma, place.id, session!.sub, {
        score: score ?? null,
        comment: comment ?? null,
        tagsConfirmed,
        tagsDisputed,
        anonymous,
      })
      return reply.status(created ? 201 : 200).send(toReviewItem(row))
    },
  )
}
