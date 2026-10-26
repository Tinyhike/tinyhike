import { vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

/**
 * Minimal Prisma stub for route tests — just the models the tested routes touch.
 * Returned object keeps the vi.fn() references so tests can assert on calls.
 * Cast to PrismaClient when passing to buildApp (tests never hit a real DB).
 *
 * A mock does not apply `select`/`omit`: a privacy test must assert on the
 * arguments passed to Prisma, not on the shape the mock happens to return.
 */
export function makePrismaMock() {
  const mock = {
    place: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'p1' }),
      update: vi.fn().mockResolvedValue({ id: 'p1' }),
      count: vi.fn().mockResolvedValue(0),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'u1', email: 'x@y.z', role: 'MEMBER' }),
    },
    magicToken: {
      create: vi.fn().mockResolvedValue({ id: 't1' }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 't1' }),
    },
    route: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    photo: {
      create: vi.fn().mockResolvedValue({ id: 'ph1', status: 'PENDING' }),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: 'ph1' }),
      count: vi.fn().mockResolvedValue(0),
    },
    review: {
      create: vi.fn().mockResolvedValue({ id: 'r1' }),
      update: vi.fn().mockResolvedValue({ id: 'r1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _avg: { score: null }, _count: { score: 0 } }),
    },
    list: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Interactive transactions run the callback against the same mock, so code
    // under test behaves identically inside and outside a transaction.
    $transaction: vi.fn(),
  }
  mock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof mock) => unknown)(mock) : Promise.all(arg as unknown[]),
  )
  return mock
}

export type PrismaMock = ReturnType<typeof makePrismaMock>

/** Pass a mock where a PrismaClient is expected (test-only cast). */
export function asPrisma(mock: PrismaMock): PrismaClient {
  return mock as unknown as PrismaClient
}
