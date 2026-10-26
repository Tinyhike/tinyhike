/**
 * Who may see a place: the one rule, shared by every route that reads, lists or
 * contributes to places (places, photos, lists, admin stats, enrichment).
 *
 * Jérôme's decision of 26 Oct 2026: the map shows playgrounds, parks and picnic
 * sites, plus any place an admin has verified on a visit. Cafés stay in the
 * database, hidden until verified; so do places whose category is unknown (a
 * parent's proposal, or an OSM element that no longer matches any category).
 *
 * The rule is an allowlist and fails closed: a null category, or one added to the
 * enum later, stays hidden until someone verifies the place.
 */

import type { PlaceCategory, PlaceStatus, Prisma } from '@prisma/client'
import type { SessionPayload } from '../plugins/auth.js'

export const VISIBLE_CATEGORIES = ['PLAYGROUND', 'PARK', 'PICNIC_SITE'] as const satisfies readonly PlaceCategory[]

/**
 * "Anyone may see this place", as a Prisma filter. Every public query starts from
 * it, so the map, the counts and any future search agree with canSeePlace().
 */
export const publicPlaceWhere = {
  status: 'APPROVED',
  OR: [{ category: { in: [...VISIBLE_CATEGORIES] } }, { verifiedAt: { not: null } }],
} satisfies Prisma.PlaceWhereInput

/**
 * The Prisma twin of canSeePlace(): what this caller may see. Admins see
 * everything; a signed-in parent also sees what they submitted.
 */
export function visiblePlaceWhere(session: SessionPayload | undefined): Prisma.PlaceWhereInput {
  if (session?.role === 'ADMIN') return {}
  if (session) return { OR: [publicPlaceWhere, { submittedById: session.sub }] }
  return publicPlaceWhere
}

/** The columns the rule reads. Select them for a check, and strip them before replying. */
export const VISIBILITY_SELECT = {
  id: true,
  status: true,
  category: true,
  verifiedAt: true,
  submittedById: true,
} satisfies Prisma.PlaceSelect

export interface VisibilityFields {
  status: PlaceStatus
  category: PlaceCategory | null
  verifiedAt: Date | null
  submittedById: string | null
}

export function isPublicPlace(place: Omit<VisibilityFields, 'submittedById'>): boolean {
  if (place.status !== 'APPROVED') return false
  // Loose `!=`: a row that didn't load verifiedAt (undefined) is not verified.
  if (place.verifiedAt != null) return true
  return place.category != null && (VISIBLE_CATEGORIES as readonly PlaceCategory[]).includes(place.category)
}

/**
 * Public places, plus, for a signed-in caller, the places they submitted (still
 * pending, rejected, or approved but hidden), and everything for an admin.
 * Everyone else gets the same 404 as for a place that does not exist.
 */
export function canSeePlace(place: VisibilityFields, session: SessionPayload | undefined): boolean {
  if (isPublicPlace(place)) return true
  if (!session) return false
  return session.role === 'ADMIN' || place.submittedById === session.sub
}

/**
 * Columns that never leave the API in a public payload: who submitted a place,
 * who verified it, and when (Jérôme: the verification's date and author are kept,
 * never shown). updatedAt goes with them: a verification is a write to the place
 * row, and nothing public writes it afterwards, so updatedAt would publish the
 * verification instant to the millisecond. Pass as `omit` when the rule does not
 * need them.
 */
export const PRIVATE_PLACE_OMIT = {
  submittedById: true,
  verifiedById: true,
  verifiedAt: true,
  updatedAt: true,
} as const satisfies Prisma.PlaceOmit

type PrivateColumn = keyof typeof PRIVATE_PLACE_OMIT

/** The same columns, removed from a row that had to load them for canSeePlace(). */
export function withoutPrivateColumns<T extends Partial<Record<PrivateColumn, unknown>>>(
  place: T,
): Omit<T, PrivateColumn> {
  const {
    submittedById: _submittedById,
    verifiedById: _verifiedById,
    verifiedAt: _verifiedAt,
    updatedAt: _updatedAt,
    ...rest
  } = place
  return rest
}
