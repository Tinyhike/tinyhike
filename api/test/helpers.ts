import { vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

/**
 * Minimal Prisma stub for route tests — just the models the tested routes touch.
 * Returned object keeps the vi.fn() references so tests can assert on calls.
 * Cast to PrismaClient when passing to buildApp (tests never hit a real DB).
 */
export function makePrismaMock() {
  return {
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
    review: { create: vi.fn().mockResolvedValue({ id: 'r1' }) },
  }
}

export type PrismaMock = ReturnType<typeof makePrismaMock>

/** Pass a mock where a PrismaClient is expected (test-only cast). */
export function asPrisma(mock: PrismaMock): PrismaClient {
  return mock as unknown as PrismaClient
}
