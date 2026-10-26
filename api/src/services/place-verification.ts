/**
 * Place verification: an admin's visit, recorded (Jérôme, 26 Oct 2026).
 *
 * Verifying a place records four points seen on site and stamps the date and the
 * admin who verified it. A verified place is public whatever its category
 * (lib/place-visibility.ts): it is the only way a café reaches the map. Answers
 * may be "no". A verified café with a step at the door and no changing table is
 * worth showing: parents learn which cafés to avoid.
 *
 * The four points are written to the existing tri-state tags, so the place sheet
 * shows them like any other amenity, with no web change. A visit is first-hand,
 * so it overwrites whatever OSM or a tag vote said before.
 *
 * Verification is not approval. `status` moderates a parent's proposal; approving
 * one does not verify it. The two are separate actions (Jérôme, 26 Oct).
 *
 * Shared by the CLI (jobs/verify-places.ts, `pnpm places:verify`) and the admin
 * routes (PUT/DELETE /api/admin/places/:id/verification), the same way
 * photo-moderation.ts is shared, so both write the same columns.
 */

import { Prisma, type PlaceCategory, type PrismaClient } from '@prisma/client'
import type { TagKey } from '../lib/tags.js'
import { isPublicPlace } from '../lib/place-visibility.js'

export const VERIFICATION_POINTS = {
  // "Entrée praticable en poussette": the step-free tag ("Sans marche", "Step-free").
  stepFree: 'wheelchairOk',
  // "Place pour la poussette à l'intérieur" ("Passage large", "Wide for strollers").
  strollerRoom: 'isStrollerWide',
  // "Table à langer".
  changingTable: 'hasChangingTable',
  // "Toilettes".
  toilets: 'hasToilets',
} as const satisfies Record<string, TagKey>

export type VerificationPoint = keyof typeof VERIFICATION_POINTS
export type VerificationAnswers = Record<VerificationPoint, boolean>

export const VERIFICATION_POINT_KEYS = Object.keys(VERIFICATION_POINTS) as VerificationPoint[]

export type PlaceVerificationErrorCode = 'NotFound' | 'NotAdmin'

const STATUS_FOR: Record<PlaceVerificationErrorCode, number> = {
  NotFound: 404,
  // The session says ADMIN but the account no longer is one (the JWT lives 30 days).
  NotAdmin: 403,
}

export class PlaceVerificationError extends Error {
  readonly statusCode: number
  constructor(
    readonly code: PlaceVerificationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PlaceVerificationError'
    this.statusCode = STATUS_FOR[code]
  }
}

const SUMMARY_SELECT = {
  id: true,
  osmId: true,
  lat: true,
  lng: true,
  status: true,
  category: true,
  verifiedAt: true,
  wheelchairOk: true,
  isStrollerWide: true,
  hasChangingTable: true,
  hasToilets: true,
  translations: { select: { locale: true, name: true } },
} satisfies Prisma.PlaceSelect

type SummaryRow = Prisma.PlaceGetPayload<{ select: typeof SUMMARY_SELECT }>

/** A place as the admin sees it while verifying. No verifier id: the CLI and the admin UI don't need it. */
export interface VerificationSummary {
  id: string
  name: string | null
  category: PlaceCategory | null
  status: SummaryRow['status']
  osmId: string | null
  lat: number
  lng: number
  verifiedAt: Date | null
  /** Whether the public sees it, i.e. whether it is on the map. */
  visible: boolean
  points: Record<VerificationPoint, boolean | null>
}

const NAME_LOCALES = ['nl', 'fr', 'en']

function toSummary(row: SummaryRow): VerificationSummary {
  const name =
    NAME_LOCALES.map((locale) => row.translations.find((t) => t.locale === locale)?.name).find(Boolean) ??
    row.translations[0]?.name ??
    null
  return {
    id: row.id,
    name,
    category: row.category,
    status: row.status,
    osmId: row.osmId,
    lat: row.lat,
    lng: row.lng,
    verifiedAt: row.verifiedAt,
    visible: isPublicPlace(row),
    points: {
      stepFree: row.wheelchairOk,
      strollerRoom: row.isStrollerWide,
      changingTable: row.hasChangingTable,
      toilets: row.hasToilets,
    },
  }
}

function isMissingRow(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
}

export interface ListOptions {
  /** A category, or 'NONE' for places with no category. */
  category?: PlaceCategory | 'NONE'
  verified?: boolean
  /** Case-insensitive match on any translated name. */
  name?: string
  take: number
}

/** Places to verify (or already verified), with how many match in total. */
export async function listPlacesForVerification(
  prisma: PrismaClient,
  { category, verified, name, take }: ListOptions,
): Promise<{ places: VerificationSummary[]; total: number }> {
  const where: Prisma.PlaceWhereInput = {
    ...(category === 'NONE' ? { category: null } : category ? { category } : {}),
    ...(verified === undefined ? {} : { verifiedAt: verified ? { not: null } : null }),
    ...(name ? { translations: { some: { name: { contains: name, mode: 'insensitive' } } } } : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.place.findMany({ where, select: SUMMARY_SELECT, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take }),
    prisma.place.count({ where }),
  ])
  return { places: rows.map(toSummary), total }
}

/**
 * Whether this account is an admin, checked against the database rather than the
 * session: a JWT keeps its role for 30 days after an account is demoted, and the
 * CLI has no session at all. Every write that changes what the public sees
 * (verify, unverify, a category change) goes through it.
 */
export async function assertAdmin(prisma: PrismaClient, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role !== 'ADMIN') throw new PlaceVerificationError('NotAdmin', 'Only an admin can do this')
}

const YES = new Set(['yes', 'y', 'oui', 'o', 'ja', 'j', 'true'])
const NO = new Set(['no', 'n', 'non', 'nee', 'false'])

/** A yes/no answer typed on the CLI, in English, French or Dutch; null if it is neither. */
export function parseYesNo(value: string): boolean | null {
  const v = value.trim().toLowerCase()
  if (YES.has(v)) return true
  if (NO.has(v)) return false
  return null
}

/**
 * Record a visit: the four answers, now, by this admin. Verifying an already
 * verified place records the new visit (answers, date and admin replaced). It
 * never touches `status`: approving a proposal is a separate action.
 */
export async function verifyPlace(
  prisma: PrismaClient,
  placeId: string,
  answers: VerificationAnswers,
  verifierId: string,
): Promise<VerificationSummary> {
  await assertAdmin(prisma, verifierId)

  const tags = Object.fromEntries(
    VERIFICATION_POINT_KEYS.map((point) => [VERIFICATION_POINTS[point], answers[point]]),
  ) as Record<(typeof VERIFICATION_POINTS)[VerificationPoint], boolean>

  try {
    const row = await prisma.place.update({
      where: { id: placeId },
      data: { ...tags, verifiedAt: new Date(), verifiedById: verifierId },
      select: SUMMARY_SELECT,
    })
    return toSummary(row)
  } catch (err) {
    if (isMissingRow(err)) throw new PlaceVerificationError('NotFound', 'Place not found')
    throw err
  }
}

/**
 * Withdraw a verification: the place is hidden again unless its category is
 * public. The four answers stay on the place, since they were seen on site; a
 * new visit replaces them.
 */
export async function unverifyPlace(
  prisma: PrismaClient,
  placeId: string,
  adminId: string,
): Promise<VerificationSummary> {
  await assertAdmin(prisma, adminId)
  try {
    const row = await prisma.place.update({
      where: { id: placeId },
      data: { verifiedAt: null, verifiedById: null },
      select: SUMMARY_SELECT,
    })
    return toSummary(row)
  } catch (err) {
    if (isMissingRow(err)) throw new PlaceVerificationError('NotFound', 'Place not found')
    throw err
  }
}
