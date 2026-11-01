// What the app copies from the PWA must stay what the PWA says: the 19
// amenities (keys, groups, emoji, order), the strings both show, and the
// palette. Run with `pnpm test` in mobile/ (Node's own test runner; Node strips
// the TypeScript types of the files it loads).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { webColorTokens, webMessages, webTags } from './web-source.mjs'
import * as appMessages from '../src/lib/messages.ts'
import { TAG_KEYS, TAGS } from '../src/lib/tags.ts'
import { palette } from '../src/theme.ts'

const LOCALES = ['nl', 'fr', 'en']

test('the 19 amenities are the PWA’s: keys, order, groups and emoji', () => {
  const web = webTags()
  assert.deepEqual([...TAG_KEYS], web.TAG_KEYS)
  assert.deepEqual(
    TAGS.map((tag) => ({ ...tag })),
    web.TAGS,
  )
})

test('every string the app shares with the PWA reads the same, in nl, fr and en', () => {
  const web = webMessages()
  const shared = Object.keys(appMessages.nl).filter((key) => key in web.nl)
  // The sheet's amenities and reviews, at least, come from the PWA.
  assert.ok(shared.length >= 60, `only ${shared.length} shared keys`)
  for (const locale of LOCALES) {
    for (const key of shared) {
      assert.equal(appMessages[locale][key], web[locale][key], `${locale} ${key}`)
    }
  }
})

test('every amenity and group has its label, as on the web', () => {
  const web = webMessages()
  for (const key of Object.keys(web.nl).filter((k) => k.startsWith('tag.') || k.startsWith('tagGroup.'))) {
    assert.ok(key in appMessages.nl, `missing ${key}`)
  }
})

test('the app defines a string in every language', () => {
  const keys = Object.keys(appMessages.nl)
  for (const locale of ['fr', 'en']) {
    assert.deepEqual(Object.keys(appMessages[locale]).sort(), [...keys].sort(), locale)
  }
})

test('the theme’s palette is the web’s tokens', () => {
  const web = webColorTokens()
  assert.deepEqual(
    Object.fromEntries(Object.entries(palette).map(([name, value]) => [name, value.toLowerCase()])),
    web,
  )
})
