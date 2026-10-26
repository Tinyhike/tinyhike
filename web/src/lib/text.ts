/**
 * The API's rule for "this comment says something" (api/src/routes/places.ts),
 * mirrored so the form can stop an empty review before sending it. Letters,
 * digits, punctuation and symbols (emoji included) are visible. Spaces, format
 * characters (zero-width space, word joiner, bidi marks) and lone combining marks
 * are not, and String.prototype.trim() only removes the spaces. A few code points
 * are classed as letters or symbols yet render blank (the Hangul fillers and the
 * braille blank): those are removed before the test.
 */
const BLANK_LETTERS = /[ᅟᅠㅤﾠ⠀]/gu
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u

export function hasVisibleText(s: string): boolean {
  return VISIBLE.test(s.replace(BLANK_LETTERS, ''))
}
