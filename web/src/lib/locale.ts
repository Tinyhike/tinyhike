/**
 * Locales the content pipeline actually produces. `enrich.ts` writes one
 * PlaceTranslation per place for each of these, so anything else would return an
 * empty translations array and render a blank card.
 */
export const LOCALES = ['nl', 'fr', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'nl' // launch city is Rotterdam

/** Shown in the language switcher — endonyms, so each reads in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  nl: 'Nederlands',
  fr: 'Français',
  en: 'English',
}

const STORAGE_KEY = 'tinyhike.locale'

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * Best available locale for this visitor: an explicit choice wins, otherwise the
 * browser's preference list. Matching is on the language subtag only, so `fr-BE`
 * and `fr-CA` both resolve to `fr`.
 */
export function detectLocale(): Locale {
  const stored = readStoredLocale()
  if (stored) return stored

  for (const tag of navigator.languages ?? [navigator.language]) {
    const lang = tag.toLowerCase().split('-')[0]
    if (isLocale(lang)) return lang
  }
  return DEFAULT_LOCALE
}

export function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored && isLocale(stored) ? stored : null
  } catch {
    // Safari in private mode throws on localStorage access; fall back to detection.
    return null
  }
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    /* non-fatal: the choice just won't survive a reload */
  }
}
