import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { DEFAULT_LOCALE, detectLocale, storeLocale, type Locale } from './locale.js'

/**
 * Hand-rolled i18n. react-i18next brings a plugin system, a backend loader and an
 * interpolation engine for what is currently ~40 static strings — this is a Record
 * and a lookup, and it type-checks completeness, which the library doesn't.
 */
const nl = {
  'nav.map': 'Kaart',
  'nav.lists': 'Lijsten',
  'nav.profile': 'Profiel',

  'map.loading': 'Plekken laden…',
  'map.error': 'Plekken laden is mislukt.',
  'map.truncated': '{shown} van {total} plekken — zoom in om alles te zien',

  'sheet.close': 'Sluiten',
  'sheet.untitled': 'Naamloze plek',
  'sheet.loading': 'Plek laden',
  'sheet.notFound': 'Deze plek bestaat niet of is niet meer zichtbaar.',
  'sheet.error': 'Deze plek laden is mislukt.',
  'sheet.backToMap': 'Terug naar de kaart',

  'lists.title': 'Openbare lijsten',
  'lists.empty': 'Nog geen openbare lijsten.',
  'lists.error': 'Lijsten laden is mislukt.',
  'lists.places': 'plekken',

  'profile.title': 'Profiel',
  'profile.signedOut': 'Je bent niet ingelogd.',
  'profile.signIn': 'Inloggen',
  'profile.signOut': 'Uitloggen',
  'profile.language': 'Taal',

  'auth.title': 'Inloggen bij TinyHike',
  'auth.subtitle': 'Geen wachtwoord — we sturen je een link per e-mail.',
  'auth.email': 'E-mailadres',
  'auth.send': 'Stuur de link',
  'auth.sending': 'Versturen…',
  'auth.checkInbox': 'Check je inbox',
  'auth.sentTo': 'We hebben een inloglink gestuurd naar',
  'auth.validFor': 'De link is 15 minuten geldig.',
  'auth.spam': 'Niets ontvangen? Kijk even in je spam.',
  'auth.tooMany': 'Te veel pogingen. Probeer het over een paar minuten opnieuw.',
  'auth.failed': 'Versturen is mislukt.',
  'auth.back': 'Terug naar de kaart',

  'amen.title': 'Wat deze plek biedt',
  'amen.toConfirm': '{n} nog te bevestigen',
  'amen.confirmChip': 'Bevestigen',
  'amen.showAll': 'Alle {n} voorzieningen tonen',
  'amen.showLess': 'Minder tonen',
  'amen.votePrompt': 'Ben je er geweest? Is dit er?',
  'amen.voteYes': 'Ja',
  'amen.voteNo': 'Nee',
  'amen.voteCancel': 'Annuleren',
  'amen.voteThanks': 'Bedankt voor je bijdrage!',
  'amen.voteError': 'Versturen is mislukt. Probeer het later opnieuw.',

  'tagGroup.baby': 'Voor de baby',
  'tagGroup.stroller': 'Met de kinderwagen',
  'tagGroup.onsite': 'Ter plaatse',

  'tag.hasChangingTable': 'Verschoontafel',
  'tag.hasHighchair': 'Kinderstoel',
  'tag.isBreastfeedingFriendly': 'Borstvoeding welkom',
  'tag.napFriendly': 'Dutje mogelijk',
  'tag.wheelchairOk': 'Drempelvrij',
  'tag.smooth': 'Vlakke ondergrond',
  'tag.isStrollerWide': 'Brede doorgang',
  'tag.hasElevator': 'Lift',
  'tag.hasPlayground': 'Speeltoestellen',
  'tag.hasPlayCorner': 'Speelhoek',
  'tag.hasOutdoorSeating': 'Terras',
  'tag.hasToilets': 'Toiletten',
  'tag.hasCafe': 'Café',
  'tag.hasParking': 'Parkeren',
  'tag.shaded': 'Schaduw',
  'tag.enclosed': 'Omheind',
  'tag.isQuiet': 'Rustig',
  'tag.freeEntry': 'Gratis toegang',
  'tag.dogFriendly': 'Honden welkom',
} as const

export type MessageKey = keyof typeof nl

const fr: Record<MessageKey, string> = {
  'nav.map': 'Carte',
  'nav.lists': 'Listes',
  'nav.profile': 'Profil',

  'map.loading': 'Chargement des lieux…',
  'map.error': 'Impossible de charger les lieux.',
  'map.truncated': '{shown} lieux sur {total} — zoome pour tout voir',

  'sheet.close': 'Fermer',
  'sheet.untitled': 'Lieu sans nom',
  'sheet.loading': 'Chargement du lieu',
  'sheet.notFound': 'Ce lieu n’existe pas ou n’est plus publié.',
  'sheet.error': 'Impossible de charger ce lieu.',
  'sheet.backToMap': 'Retour à la carte',

  'lists.title': 'Listes publiques',
  'lists.empty': 'Aucune liste publique pour le moment.',
  'lists.error': 'Impossible de charger les listes.',
  'lists.places': 'lieux',

  'profile.title': 'Profil',
  'profile.signedOut': 'Tu n’es pas connecté.',
  'profile.signIn': 'Se connecter',
  'profile.signOut': 'Se déconnecter',
  'profile.language': 'Langue',

  'auth.title': 'Se connecter à TinyHike',
  'auth.subtitle': 'Pas de mot de passe — on t’envoie un lien par e-mail.',
  'auth.email': 'Adresse e-mail',
  'auth.send': 'Recevoir le lien',
  'auth.sending': 'Envoi…',
  'auth.checkInbox': 'Regarde ta boîte mail',
  'auth.sentTo': 'Un lien de connexion a été envoyé à',
  'auth.validFor': 'Il est valable 15 minutes.',
  'auth.spam': 'Rien reçu ? Pense à vérifier les spams.',
  'auth.tooMany': 'Trop de tentatives. Réessaie dans quelques minutes.',
  'auth.failed': 'Envoi impossible.',
  'auth.back': 'Retour à la carte',

  'amen.title': 'Ce que propose ce lieu',
  'amen.toConfirm': '{n} infos à confirmer',
  'amen.confirmChip': 'À confirmer',
  'amen.showAll': 'Afficher les {n} équipements',
  'amen.showLess': 'Réduire',
  'amen.votePrompt': 'Tu y es allé ? C’est là ?',
  'amen.voteYes': 'Oui',
  'amen.voteNo': 'Non',
  'amen.voteCancel': 'Annuler',
  'amen.voteThanks': 'Merci pour ta contribution !',
  'amen.voteError': 'Envoi impossible. Réessaie plus tard.',

  'tagGroup.baby': 'Pour bébé',
  'tagGroup.stroller': 'Accès poussette',
  'tagGroup.onsite': 'Sur place',

  'tag.hasChangingTable': 'Table à langer',
  'tag.hasHighchair': 'Chaise haute',
  'tag.isBreastfeedingFriendly': 'Allaitement bienvenu',
  'tag.napFriendly': 'Sieste possible',
  'tag.wheelchairOk': 'Sans marche',
  'tag.smooth': 'Sol roulable',
  'tag.isStrollerWide': 'Passage large',
  'tag.hasElevator': 'Ascenseur',
  'tag.hasPlayground': 'Jeux enfants',
  'tag.hasPlayCorner': 'Coin jeux',
  'tag.hasOutdoorSeating': 'Terrasse',
  'tag.hasToilets': 'Toilettes',
  'tag.hasCafe': 'Café',
  'tag.hasParking': 'Parking',
  'tag.shaded': 'Ombragé',
  'tag.enclosed': 'Clôturé',
  'tag.isQuiet': 'Calme',
  'tag.freeEntry': 'Entrée gratuite',
  'tag.dogFriendly': 'Chiens admis',
}

const en: Record<MessageKey, string> = {
  'nav.map': 'Map',
  'nav.lists': 'Lists',
  'nav.profile': 'Profile',

  'map.loading': 'Loading places…',
  'map.error': 'Could not load places.',
  'map.truncated': '{shown} of {total} places — zoom in to see them all',

  'sheet.close': 'Close',
  'sheet.untitled': 'Unnamed place',
  'sheet.loading': 'Loading place',
  'sheet.notFound': 'This place doesn’t exist, or is no longer published.',
  'sheet.error': 'Could not load this place.',
  'sheet.backToMap': 'Back to the map',

  'lists.title': 'Public lists',
  'lists.empty': 'No public lists yet.',
  'lists.error': 'Could not load lists.',
  'lists.places': 'places',

  'profile.title': 'Profile',
  'profile.signedOut': 'You’re not signed in.',
  'profile.signIn': 'Sign in',
  'profile.signOut': 'Sign out',
  'profile.language': 'Language',

  'auth.title': 'Sign in to TinyHike',
  'auth.subtitle': 'No password — we’ll email you a link.',
  'auth.email': 'Email address',
  'auth.send': 'Send the link',
  'auth.sending': 'Sending…',
  'auth.checkInbox': 'Check your inbox',
  'auth.sentTo': 'We sent a sign-in link to',
  'auth.validFor': 'It’s valid for 15 minutes.',
  'auth.spam': 'Nothing there? Have a look in your spam folder.',
  'auth.tooMany': 'Too many attempts. Try again in a few minutes.',
  'auth.failed': 'Could not send the link.',
  'auth.back': 'Back to the map',

  'amen.title': 'What this place offers',
  'amen.toConfirm': '{n} waiting to be confirmed',
  'amen.confirmChip': 'Confirm',
  'amen.showAll': 'Show all {n} amenities',
  'amen.showLess': 'Show less',
  'amen.votePrompt': 'Been there? Is this available?',
  'amen.voteYes': 'Yes',
  'amen.voteNo': 'No',
  'amen.voteCancel': 'Cancel',
  'amen.voteThanks': 'Thanks for contributing!',
  'amen.voteError': 'Could not send. Try again later.',

  'tagGroup.baby': 'For baby',
  'tagGroup.stroller': 'With the stroller',
  'tagGroup.onsite': 'On site',

  'tag.hasChangingTable': 'Changing table',
  'tag.hasHighchair': 'High chair',
  'tag.isBreastfeedingFriendly': 'Breastfeeding friendly',
  'tag.napFriendly': 'Nap friendly',
  'tag.wheelchairOk': 'Step-free',
  'tag.smooth': 'Smooth ground',
  'tag.isStrollerWide': 'Wide for strollers',
  'tag.hasElevator': 'Lift',
  'tag.hasPlayground': 'Playground',
  'tag.hasPlayCorner': 'Play corner',
  'tag.hasOutdoorSeating': 'Outdoor seating',
  'tag.hasToilets': 'Toilets',
  'tag.hasCafe': 'Café',
  'tag.hasParking': 'Parking',
  'tag.shaded': 'Shaded',
  'tag.enclosed': 'Fenced',
  'tag.isQuiet': 'Quiet',
  'tag.freeEntry': 'Free entry',
  'tag.dogFriendly': 'Dogs welcome',
}

// Typing fr/en as Record<MessageKey, string> means dropping a key is a build error,
// so a locale can never silently fall back to another language.
const MESSAGES: Record<Locale, Record<MessageKey, string>> = { nl, fr, en }

interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: MessageKey) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    storeLocale(next)
    document.documentElement.lang = next
  }, [])

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => MESSAGES[locale][key] ?? MESSAGES[DEFAULT_LOCALE][key],
    }),
    [locale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
