// The app's strings (messages.ts) in the PWA's three languages. No language
// switch yet: the device's language decides.

import { en, fr, nl, type MessageKey } from './messages'

export type { MessageKey }

export const LOCALES = ['nl', 'fr', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'nl' // launch city is Rotterdam, like the PWA

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * The device's language, read through Intl (Hermes ships it), so no native
 * module and no new development build. `fr-BE` resolves to `fr`.
 */
function deviceLocale(): Locale {
  try {
    const lang = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().split('-')[0]
    return isLocale(lang) ? lang : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

export const locale: Locale = deviceLocale()

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { nl, fr, en }

export function t(key: MessageKey): string {
  return MESSAGES[locale][key] ?? MESSAGES[DEFAULT_LOCALE][key]
}

/** Keys that come as a `.one` / `.other` pair, named without the suffix (as on the web). */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer B}.one` ? (`${B}.other` extends MessageKey ? B : never) : never
}[MessageKey]

/**
 * Whether `n` takes the singular. Intl.PluralRules when the engine has it; the
 * rule of the three languages otherwise (French counts 0 as singular).
 */
function isOne(n: number): boolean {
  if (typeof Intl.PluralRules === 'function') return new Intl.PluralRules(locale).select(n) === 'one'
  return locale === 'fr' ? n < 2 : n === 1
}

/** A count in words: `tn('rev.count', 3)` is "3 avis". */
export function tn(base: PluralBase, n: number): string {
  const key = `${base}.${isOne(n) ? 'one' : 'other'}` as MessageKey
  return t(key).replace('{n}', new Intl.NumberFormat(locale).format(n))
}
