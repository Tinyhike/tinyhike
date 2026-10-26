import { describe, it, expect, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  listPlacesForVerification,
  verifyPlace,
  unverifyPlace,
  parseYesNo,
  PlaceVerificationError,
  VERIFICATION_POINTS,
} from '../src/services/place-verification.js'
import { TAG_KEYS } from '../src/lib/tags.js'
import { makePrismaMock, asPrisma, type PrismaMock } from './helpers.js'

const ADMIN = 'cadmin0000000000000000001'
const ANSWERS = { stepFree: false, strollerRoom: true, changingTable: true, toilets: false }

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    osmId: 'osm:node/1',
    lat: 51.9,
    lng: 4.4,
    status: 'APPROVED',
    category: 'CAFE',
    verifiedAt: null,
    wheelchairOk: null,
    isStrollerWide: null,
    hasChangingTable: null,
    hasToilets: null,
    translations: [],
    ...over,
  }
}

const missing = () =>
  new Prisma.PrismaClientKnownRequestError('Record to update not found', { code: 'P2025', clientVersion: 'test' })

describe('place verification', () => {
  let db: PrismaMock

  beforeEach(() => {
    db = makePrismaMock()
    db.user.findUnique.mockResolvedValue({ role: 'ADMIN' })
  })

  it('maps the four points to existing amenity tags', () => {
    expect(VERIFICATION_POINTS).toEqual({
      stepFree: 'wheelchairOk',
      strollerRoom: 'isStrollerWide',
      changingTable: 'hasChangingTable',
      toilets: 'hasToilets',
    })
    for (const tag of Object.values(VERIFICATION_POINTS)) expect(TAG_KEYS).toContain(tag)
  })

  describe('verifyPlace', () => {
    it('writes the four answers, the date and the admin, and nothing else (status untouched)', async () => {
      db.place.update.mockResolvedValueOnce(row({ verifiedAt: new Date() }))
      const before = Date.now()
      await verifyPlace(asPrisma(db), 'p1', ANSWERS, ADMIN)

      const arg = db.place.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
      expect(arg.where).toEqual({ id: 'p1' })
      expect(arg.data).toEqual({
        wheelchairOk: false,
        isStrollerWide: true,
        hasChangingTable: true,
        hasToilets: false,
        verifiedAt: expect.any(Date),
        verifiedById: ADMIN,
      })
      expect((arg.data.verifiedAt as Date).getTime()).toBeGreaterThanOrEqual(before)
    })

    it('verifies a café whose four answers are all no: a café to avoid is still shown', async () => {
      const allNo = { stepFree: false, strollerRoom: false, changingTable: false, toilets: false }
      db.place.update.mockResolvedValueOnce(
        row({ verifiedAt: new Date(), wheelchairOk: false, isStrollerWide: false, hasChangingTable: false, hasToilets: false }),
      )
      const result = await verifyPlace(asPrisma(db), 'p1', allNo, ADMIN)

      const arg = db.place.update.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data).toEqual({
        wheelchairOk: false,
        isStrollerWide: false,
        hasChangingTable: false,
        hasToilets: false,
        verifiedAt: expect.any(Date),
        verifiedById: ADMIN,
      })
      expect(result.visible).toBe(true)
      expect(result.points).toEqual(allNo)
    })

    it.each([[null], [{ role: 'MEMBER' }], [{ role: 'STEWARD' }]])(
      'refuses a verifier who is not an admin in the database (%j)',
      async (user) => {
        db.user.findUnique.mockResolvedValue(user)
        const err = await verifyPlace(asPrisma(db), 'p1', ANSWERS, ADMIN).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(PlaceVerificationError)
        expect(err).toMatchObject({ code: 'NotAdmin', statusCode: 403 })
        expect(db.place.update).not.toHaveBeenCalled()
      },
    )

    it('turns an unknown place into NotFound', async () => {
      db.place.update.mockRejectedValueOnce(missing())
      await expect(verifyPlace(asPrisma(db), 'nope', ANSWERS, ADMIN)).rejects.toMatchObject({
        code: 'NotFound',
        statusCode: 404,
      })
    })

    it('lets other database errors through', async () => {
      db.place.update.mockRejectedValueOnce(new Error('connection lost'))
      await expect(verifyPlace(asPrisma(db), 'p1', ANSWERS, ADMIN)).rejects.toThrow('connection lost')
    })

    it('never selects the verifier id back', async () => {
      db.place.update.mockResolvedValueOnce(row())
      await verifyPlace(asPrisma(db), 'p1', ANSWERS, ADMIN)
      const arg = db.place.update.mock.calls[0][0] as { select: Record<string, unknown> }
      expect(arg.select).not.toHaveProperty('verifiedById')
    })
  })

  describe('unverifyPlace', () => {
    it('clears only the date and the admin', async () => {
      db.place.update.mockResolvedValueOnce(row({ hasToilets: true }))
      const result = await unverifyPlace(asPrisma(db), 'p1', ADMIN)
      const arg = db.place.update.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data).toEqual({ verifiedAt: null, verifiedById: null })
      expect(result).toMatchObject({ visible: false, points: { toilets: true } })
    })

    it('turns an unknown place into NotFound', async () => {
      db.place.update.mockRejectedValueOnce(missing())
      await expect(unverifyPlace(asPrisma(db), 'nope', ADMIN)).rejects.toMatchObject({ code: 'NotFound' })
    })

    it('refuses an account that is no longer an admin in the database', async () => {
      db.user.findUnique.mockResolvedValue({ role: 'MEMBER' })
      await expect(unverifyPlace(asPrisma(db), 'p1', ADMIN)).rejects.toMatchObject({ code: 'NotAdmin', statusCode: 403 })
      expect(db.place.update).not.toHaveBeenCalled()
    })
  })

  describe('parseYesNo (the CLI answers)', () => {
    it.each(['yes', 'Y', 'oui', 'o', 'ja', 'J', 'true', ' yes '])('%j is yes', (v) => {
      expect(parseYesNo(v)).toBe(true)
    })
    it.each(['no', 'N', 'non', 'NEE', 'false'])('%j is no', (v) => {
      expect(parseYesNo(v)).toBe(false)
    })
    it.each(['', 'maybe', 'si', '1', '0', 'yesno'])('%j is neither', (v) => {
      expect(parseYesNo(v)).toBeNull()
    })
  })

  describe('listPlacesForVerification', () => {
    it('names a place in nl, then fr, then en, then whatever there is', async () => {
      db.place.findMany.mockResolvedValueOnce([
        row({ id: 'a', translations: [{ locale: 'en', name: 'Coffee' }, { locale: 'fr', name: 'Café' }] }),
        row({ id: 'b', translations: [{ locale: 'de', name: 'Kaffee' }] }),
        row({ id: 'c', translations: [] }),
      ])
      const { places } = await listPlacesForVerification(asPrisma(db), { take: 10 })
      expect(places.map((p) => p.name)).toEqual(['Café', 'Kaffee', null])
    })

    it('counts every match with the same filter', async () => {
      db.place.count.mockResolvedValueOnce(274)
      const { total } = await listPlacesForVerification(asPrisma(db), { category: 'CAFE', verified: false, take: 10 })
      expect(total).toBe(274)
      const listWhere = (db.place.findMany.mock.calls[0][0] as { where: unknown }).where
      expect(db.place.count).toHaveBeenCalledWith({ where: listWhere })
    })

    it('with no filter, lists everything', async () => {
      await listPlacesForVerification(asPrisma(db), { take: 10 })
      expect((db.place.findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({})
    })
  })
})
