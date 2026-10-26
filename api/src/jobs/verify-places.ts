/**
 * Verify places from the shell, until the admin UI exists.
 *
 * Same code path as PUT/DELETE /api/admin/places/:id/verification
 * (src/services/place-verification.ts). Verifying records the four points seen on
 * a visit, with the date and the admin. A verified place is public whatever its
 * category, which is how a café gets on the map. "no" answers are kept and shown:
 * they tell parents which cafés to avoid.
 *
 * Usage:  pnpm places:verify list [--category CAFE|PLAYGROUND|PARK|PICNIC_SITE|NONE]
 *                                  [--verified | --unverified] [--name <text>]
 *         pnpm places:verify verify <placeId> --step-free yes|no --stroller-room yes|no
 *                                  --changing-table yes|no --toilets yes|no [--by <email>]
 *         pnpm places:verify unverify <placeId> [--by <email>]
 *         pnpm places:verify add <node|way|relation>/<osmId> [--category CAFE]
 *
 * add brings in, hidden, a place the seeder never imported: it takes only
 * amenity=cafe, so a brunch place OSM files as a restaurant (By Jarmusch West,
 * node/11007237505) can't be verified until it is added. Name, position and the
 * stroller tags come from OSM (api.openstreetmap.org). The OSM link pasted from
 * the browser works too. An element already in the database is shown, not
 * added twice. --category defaults to the element's own when it is a hidden one.
 *
 * The four points: step-free = "entrée praticable en poussette"; stroller-room =
 * "place pour la poussette à l'intérieur"; changing-table = "table à langer";
 * toilets = "toilettes". yes/no, oui/non or ja/nee.
 *
 * --by names the admin who visited (or who withdraws the verification). Without
 * it, the only ADMIN account is used. Either way the account must be ADMIN in the
 * database.
 */

import 'dotenv/config'
import { parseArgs } from 'node:util'
import { PrismaClient, type PlaceCategory } from '@prisma/client'
import { DEFAULT_BBOX } from '../lib/osm.js'
import { parseOsmRef } from '../lib/osm-api.js'
import {
  addPlaceFromOsm,
  ADDABLE_CATEGORIES,
  listPlacesForVerification,
  verifyPlace,
  unverifyPlace,
  parseYesNo,
  PlaceVerificationError,
  type VerificationAnswers,
  type VerificationSummary,
} from '../services/place-verification.js'

const prisma = new PrismaClient()

const USAGE = `Usage:
  pnpm places:verify list [--category CAFE|PLAYGROUND|PARK|PICNIC_SITE|NONE] [--verified | --unverified] [--name <text>]
  pnpm places:verify verify <placeId> --step-free yes|no --stroller-room yes|no --changing-table yes|no --toilets yes|no [--by <email>]
  pnpm places:verify unverify <placeId> [--by <email>]
  pnpm places:verify add <node|way|relation>/<osmId> [--category ${ADDABLE_CATEGORIES.join('|')}]`

const CATEGORIES = ['PLAYGROUND', 'PARK', 'PICNIC_SITE', 'CAFE', 'NONE'] as const

class UsageError extends Error {}

function answer(flag: string, value: string | undefined): boolean {
  if (value === undefined) throw new UsageError(`verify needs --${flag} yes|no`)
  const parsed = parseYesNo(value)
  if (parsed === null) throw new UsageError(`--${flag} must be yes or no, not "${value}"`)
  return parsed
}

const mark = (v: boolean | null) => (v === null ? '?' : v ? 'yes' : 'no')

function print(p: VerificationSummary) {
  const state = p.verifiedAt ? `verified ${p.verifiedAt.toISOString().slice(0, 10)}` : 'not verified'
  console.log(`${p.id}  ${p.name ?? '(no name)'}`)
  console.log(`  ${p.category ?? 'no category'}, ${p.status}, ${state}, ${p.visible ? 'ON the map' : 'hidden'}`)
  console.log(
    `  step-free ${mark(p.points.stepFree)} · stroller room ${mark(p.points.strollerRoom)} · ` +
      `changing table ${mark(p.points.changingTable)} · toilets ${mark(p.points.toilets)}`,
  )
  console.log(`  https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=19/${p.lat}/${p.lng}`)
}

async function list(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      category: { type: 'string' },
      verified: { type: 'boolean' },
      unverified: { type: 'boolean' },
      name: { type: 'string' },
    },
  })
  const category = values.category?.toUpperCase()
  if (category !== undefined && !(CATEGORIES as readonly string[]).includes(category)) {
    throw new UsageError(`Unknown category "${values.category}"`)
  }
  if (values.verified && values.unverified) throw new UsageError('--verified or --unverified, not both')
  const verified = values.verified ? true : values.unverified ? false : undefined

  const { places, total } = await listPlacesForVerification(prisma, {
    category: category as PlaceCategory | 'NONE' | undefined,
    verified,
    name: values.name?.trim() || undefined,
    take: 500,
  })
  places.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  for (const p of places) {
    print(p)
    console.log('')
  }
  console.log(`${total} place(s) match${places.length < total ? `, ${places.length} shown` : ''}.`)
}

/** The admin who visited: --by <email>, or the only ADMIN account. */
async function verifierId(email: string | undefined): Promise<string> {
  if (email) {
    // Case-insensitive: accounts created before sign-in lowercased emails keep their case.
    const users = await prisma.user.findMany({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
      select: { id: true },
      take: 2,
    })
    if (users.length !== 1) {
      throw new UsageError(users.length === 0 ? `No account with the email ${email}` : `Several accounts match ${email}`)
    }
    const [user] = users
    return user.id
  }
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true }, take: 2 })
  if (admins.length !== 1) {
    throw new UsageError(admins.length === 0 ? 'No ADMIN account exists' : 'Several ADMIN accounts: say which with --by <email>')
  }
  return admins[0].id
}

async function verify(id: string | undefined, args: string[]) {
  if (!id || id.startsWith('--')) throw new UsageError('verify needs a place id')
  const { values } = parseArgs({
    args,
    options: {
      'step-free': { type: 'string' },
      'stroller-room': { type: 'string' },
      'changing-table': { type: 'string' },
      toilets: { type: 'string' },
      by: { type: 'string' },
    },
  })
  const answers: VerificationAnswers = {
    stepFree: answer('step-free', values['step-free']),
    strollerRoom: answer('stroller-room', values['stroller-room']),
    changingTable: answer('changing-table', values['changing-table']),
    toilets: answer('toilets', values.toilets),
  }
  const result = await verifyPlace(prisma, id, answers, await verifierId(values.by))
  console.log('Verified:')
  print(result)
}

async function unverify(id: string | undefined, args: string[]) {
  if (!id || id.startsWith('--')) throw new UsageError('unverify needs a place id')
  const { values } = parseArgs({ args, options: { by: { type: 'string' } } })
  const result = await unverifyPlace(prisma, id, await verifierId(values.by))
  console.log('Verification withdrawn (the four points are kept):')
  print(result)
}

async function add(input: string | undefined, args: string[]) {
  if (!input || input.startsWith('--')) throw new UsageError('add needs an OSM element, e.g. node/11007237505')
  const ref = parseOsmRef(input)
  if (!ref) {
    throw new UsageError(`"${input}" names no OSM element: write node/<id>, way/<id> or relation/<id>, or paste its openstreetmap.org link`)
  }
  const { values } = parseArgs({ args, options: { category: { type: 'string' } } })
  const category = values.category?.toUpperCase()
  if (category !== undefined && !(ADDABLE_CATEGORIES as string[]).includes(category)) {
    throw new UsageError(`add only creates hidden places: --category ${ADDABLE_CATEGORIES.join('|')}, not "${values.category}"`)
  }

  const { created, place } = await addPlaceFromOsm(prisma, ref, {
    category: category as PlaceCategory | undefined,
    // Same area as the seeder.
    area: process.env.BBOX ?? DEFAULT_BBOX,
  })
  console.log(created ? 'Added, hidden until verified:' : 'Already in the database, nothing added:')
  print(place)
  if (!place.verifiedAt) {
    console.log(
      `\nAfter the visit:\n  pnpm places:verify verify ${place.id} ` +
        '--step-free yes|no --stroller-room yes|no --changing-table yes|no --toilets yes|no',
    )
  }
}

async function main() {
  const argv = process.argv.slice(2)
  // `pnpm places:verify -- verify …` (the npm habit) passes the `--` through.
  if (argv[0] === '--') argv.shift()
  const [command, ...rest] = argv
  switch (command) {
    case 'list':
      return list(rest)
    case 'verify':
      return verify(rest[0], rest.slice(1))
    case 'unverify':
      return unverify(rest[0], rest.slice(1))
    case 'add':
      return add(rest[0], rest.slice(1))
    default:
      throw new UsageError(command ? `Unknown command "${command}"` : 'No command given')
  }
}

main()
  .catch((err: unknown) => {
    // parseArgs throws a TypeError with a code for an unknown or malformed option.
    const isArgError = err instanceof TypeError && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS')
    if (err instanceof UsageError || isArgError) {
      console.error(`${(err as Error).message}\n\n${USAGE}`)
    } else if (err instanceof PlaceVerificationError) {
      console.error(`${err.code}: ${err.message}`)
    } else {
      console.error('place verification failed:', err)
    }
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
