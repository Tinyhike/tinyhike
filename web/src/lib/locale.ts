/**
 * Locales the content pipeline actually produces. `enrich.ts` writes one
 * PlaceTranslation per place for each of these, so anything else would return an
 * empty translations array and render a blank card.
 */
export const LOCALES = ['nl', 'fr', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'nl' // launch city is Rotterdam

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * Best available locale for this visitor, from the browser's preference list.
 * Matches on the language subtag only, so `fr-BE` and `fr-CA` both resolve to `fr`.
 */
export function getLocale(): Locale {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const lang = tag.toLowerCase().split('-')[0]
    if (isLocale(lang)) return lang
  }
  return DEFAULT_LOCALE
}
