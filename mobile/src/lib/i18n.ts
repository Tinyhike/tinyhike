// The app's few strings in the PWA's three languages (web/src/lib/i18n.tsx, same
// tone: "tu" in French). No language switch yet: the device's language decides.

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

const MESSAGES = {
  nl: {
    'map.locate': 'Mijn locatie',
    'map.locateRefused': 'Locatie geweigerd. Tik om de instellingen te openen.',
    'sheet.close': 'Sluiten',
    'tap.loading': 'Plek zoeken…',
    'tap.none': 'Geen plek hier. Tik op het icoon van een plek op de kaart.',
    'tap.offline': 'Geen verbinding. Controleer je internet en probeer het opnieuw.',
    'tap.error': 'De kaartdienst antwoordt niet. Probeer het zo opnieuw.',
  },
  fr: {
    'map.locate': 'Ma position',
    'map.locateRefused': 'Position refusée. Touche pour ouvrir les réglages.',
    'sheet.close': 'Fermer',
    'tap.loading': 'Recherche du lieu…',
    'tap.none': 'Aucun lieu ici. Touche l’icône d’un lieu sur la carte.',
    'tap.offline': 'Pas de connexion. Vérifie ton réseau et réessaie.',
    'tap.error': 'Le service de carte ne répond pas. Réessaie dans un instant.',
  },
  en: {
    'map.locate': 'My location',
    'map.locateRefused': 'Location refused. Tap to open the settings.',
    'sheet.close': 'Close',
    'tap.loading': 'Looking up the place…',
    'tap.none': 'No place here. Tap the icon of a place on the map.',
    'tap.offline': 'No connection. Check your network and try again.',
    'tap.error': 'The map service is not answering. Try again in a moment.',
  },
} as const satisfies Record<Locale, Record<string, string>>

export type MessageKey = keyof (typeof MESSAGES)['en']

export function t(key: MessageKey): string {
  return MESSAGES[locale][key]
}
