import { describe, it, expect } from 'vitest'
import type { PlaceAccess, PlaceCategory, PlaceStatus } from '@prisma/client'
import {
  canSeePlace,
  isPublicPlace,
  publicPlaceWhere,
  visiblePlaceWhere,
  withoutPrivateColumns,
  VISIBLE_ACCESS,
  VISIBLE_CATEGORIES,
} from '../src/lib/place-visibility.js'

const VERIFIED = new Date('2026-10-26T10:00:00Z')

function place(
  over: { status?: PlaceStatus; category?: PlaceCategory | null; access?: PlaceAccess; verifiedAt?: Date | null; submittedById?: string | null } = {},
) {
  return {
    status: 'APPROVED' as PlaceStatus,
    category: 'PLAYGROUND' as PlaceCategory | null,
    access: 'OPEN' as PlaceAccess,
    verifiedAt: null,
    submittedById: 'u-submitter',
    ...over,
  }
}

const ANON = undefined
const MEMBER = { sub: 'u-member', role: 'MEMBER' }
const SUBMITTER = { sub: 'u-submitter', role: 'MEMBER' }
const ADMIN = { sub: 'u-admin', role: 'ADMIN' }

describe('the decision of 26 Oct 2026', () => {
  it('shows playgrounds, parks and picnic sites; cafés only once verified', () => {
    expect(VISIBLE_CATEGORIES).toEqual(['PLAYGROUND', 'PARK', 'PICNIC_SITE'])
  })

  it('and, the same day: a place OSM marks private only once verified; customers-only stays', () => {
    expect(VISIBLE_ACCESS).toEqual(['OPEN', 'CUSTOMERS'])
  })
})

describe('isPublicPlace', () => {
  it.each([
    ['PLAYGROUND', null, true],
    ['PARK', null, true],
    ['PICNIC_SITE', null, true],
    ['CAFE', null, false],
    [null, null, false],
    ['CAFE', VERIFIED, true],
    [null, VERIFIED, true],
  ] as const)('approved %s, verifiedAt %s → %s', (category, verifiedAt, expected) => {
    expect(isPublicPlace(place({ category, verifiedAt }))).toBe(expected)
  })

  it.each(['PENDING', 'REJECTED'] as const)('a %s place is never public, verified or not', (status) => {
    expect(isPublicPlace(place({ status }))).toBe(false)
    expect(isPublicPlace(place({ status, category: 'CAFE', verifiedAt: VERIFIED }))).toBe(false)
  })

  it('fails closed on a row that did not load the columns', () => {
    expect(isPublicPlace({ status: 'APPROVED' } as never)).toBe(false)
    expect(isPublicPlace({ status: 'APPROVED', category: 'PLAYGROUND', verifiedAt: null } as never)).toBe(false)
  })

  it.each([
    ['PLAYGROUND', 'OPEN', null, true],
    ['PLAYGROUND', 'CUSTOMERS', null, true],
    ['PLAYGROUND', 'PRIVATE', null, false],
    ['PARK', 'PRIVATE', null, false],
    ['PLAYGROUND', 'PRIVATE', VERIFIED, true],
    ['CAFE', 'CUSTOMERS', null, false],
    ['CAFE', 'PRIVATE', VERIFIED, true],
  ] as const)('approved %s with access %s, verifiedAt %s → %s', (category, access, verifiedAt, expected) => {
    expect(isPublicPlace(place({ category, access, verifiedAt }))).toBe(expected)
  })

  it('fails closed on an access value added to the enum later', () => {
    expect(isPublicPlace(place({ access: 'MEMBERS' as PlaceAccess }))).toBe(false)
  })

  it('fails closed on a category added to the enum later', () => {
    expect(isPublicPlace(place({ category: 'RESTAURANT' as PlaceCategory }))).toBe(false)
  })
})

describe('canSeePlace', () => {
  const sessions = { ANON, MEMBER, SUBMITTER, ADMIN }

  it.each([
    // [what, place, who sees it]
    ['a playground', place(), ['ANON', 'MEMBER', 'SUBMITTER', 'ADMIN']],
    ['an unverified café', place({ category: 'CAFE', submittedById: null }), ['ADMIN']],
    ['a verified café', place({ category: 'CAFE', verifiedAt: VERIFIED, submittedById: null }), ['ANON', 'MEMBER', 'SUBMITTER', 'ADMIN']],
    ['a place with no category', place({ category: null, submittedById: null }), ['ADMIN']],
    ['a pending proposal', place({ status: 'PENDING', category: null }), ['SUBMITTER', 'ADMIN']],
    ['a rejected proposal', place({ status: 'REJECTED' }), ['SUBMITTER', 'ADMIN']],
    ['an approved café a parent proposed', place({ category: 'CAFE' }), ['SUBMITTER', 'ADMIN']],
    ['a private playground', place({ access: 'PRIVATE', submittedById: null }), ['ADMIN']],
    ['a private playground an admin verified', place({ access: 'PRIVATE', verifiedAt: VERIFIED, submittedById: null }), ['ANON', 'MEMBER', 'SUBMITTER', 'ADMIN']],
    ['a customers-only playground', place({ access: 'CUSTOMERS', submittedById: null }), ['ANON', 'MEMBER', 'SUBMITTER', 'ADMIN']],
  ] as const)('%s is seen by %j', (_what, p, seenBy) => {
    for (const [name, session] of Object.entries(sessions)) {
      expect(canSeePlace(p, session), name).toBe((seenBy as readonly string[]).includes(name))
    }
  })
})

describe('publicPlaceWhere / visiblePlaceWhere', () => {
  it('is the Prisma form of isPublicPlace', () => {
    expect(publicPlaceWhere).toEqual({
      status: 'APPROVED',
      OR: [
        { category: { in: ['PLAYGROUND', 'PARK', 'PICNIC_SITE'] }, access: { in: ['OPEN', 'CUSTOMERS'] } },
        { verifiedAt: { not: null } },
      ],
    })
  })

  it('narrows by caller like canSeePlace', () => {
    expect(visiblePlaceWhere(ANON)).toEqual(publicPlaceWhere)
    expect(visiblePlaceWhere(MEMBER)).toEqual({ OR: [publicPlaceWhere, { submittedById: 'u-member' }] })
    expect(visiblePlaceWhere(ADMIN)).toEqual({})
  })
})

describe('withoutPrivateColumns', () => {
  it('drops who submitted and verified a place, and when (updatedAt too); keeps the rest', () => {
    const row = {
      id: 'p1',
      category: 'CAFE',
      submittedById: 'u1',
      verifiedById: 'u2',
      verifiedAt: VERIFIED,
      updatedAt: VERIFIED,
      createdAt: VERIFIED,
      hasToilets: true,
    }
    expect(withoutPrivateColumns(row)).toEqual({ id: 'p1', category: 'CAFE', createdAt: VERIFIED, hasToilets: true })
  })
})
