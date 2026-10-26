import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Prisma } from '@prisma/client'
import { TAG_KEYS } from '../src/lib/tags.js'

describe('tag keys', () => {
  it('match the web client list exactly (same keys, same order)', () => {
    // api and web share no package, so compare the source: a tag added on one side
    // only would be rejected by the API or rendered raw by the web.
    const webSource = readFileSync(fileURLToPath(new URL('../../web/src/lib/tags.ts', import.meta.url)), 'utf8')
    const block = webSource.match(/export const TAG_KEYS = \[([\s\S]*?)\] as const/)
    expect(block).not.toBeNull()
    const webKeys = [...block![1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])
    expect(webKeys).toEqual([...TAG_KEYS])
  })

  it('are all real nullable Boolean columns of Place', () => {
    const place = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Place')!
    for (const key of TAG_KEYS) {
      const field = place.fields.find((f) => f.name === key)
      expect(field, key).toBeDefined()
      expect(field!.type).toBe('Boolean')
      expect(field!.isRequired).toBe(false)
    }
  })
})
