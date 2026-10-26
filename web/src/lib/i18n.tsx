import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { DEFAULT_LOCALE, detectLocale, storeLocale, type Locale } from './locale.js'

/**
 * Hand-rolled i18n. react-i18next brings a plugin system, a backend loader and an
 * interpolation engine for a few hundred static strings — this is a Record and a
 * lookup, and it type-checks completeness, which the library doesn't. Placeholders
 * are filled with `.replace('{n}', …)` at the call site; counts go through `tn()`.
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
  'sheet.customersOnly': 'Alleen voor klanten',
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
  'auth.backPrev': 'Terug',
  'auth.badEmail': 'Dit e-mailadres lijkt niet te kloppen.',
  'auth.already': 'Je bent al ingelogd.',
  'auth.continue': 'Verder',

  'err.network': 'Geen verbinding. Controleer je internet en probeer het opnieuw.',
  'err.tooMany': 'Even rustig aan: te veel pogingen. Probeer het over een minuutje opnieuw.',
  'err.signedOut': 'Je bent niet meer ingelogd. Log opnieuw in.',
  'err.generic': 'Er ging iets mis. Probeer het later opnieuw.',

  'session.unknown': 'We konden niet controleren of je ingelogd bent.',
  'session.retry': 'Opnieuw proberen',
  'session.checking': 'Controleren…',

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

  'photo.add': '📷 Foto toevoegen',
  'photo.addAnother': '📷 Nog een foto toevoegen',
  'photo.signIn': 'Log in om een foto toe te voegen',
  'photo.badType': 'Dit bestand kunnen we niet lezen. Kies een JPEG-, PNG- of WebP-foto.',
  'photo.tooBig': 'Deze foto is te groot.',
  'photo.send': 'Versturen',
  'photo.cancel': 'Annuleren',
  'photo.cancelled': 'Versturen geannuleerd.',
  'photo.retry': 'Opnieuw proberen',
  'photo.sending': 'Je foto wordt verstuurd.',
  'photo.progressLabel': 'Voortgang van het versturen',
  'photo.preparing': 'Foto voorbereiden…',
  'photo.uploading': 'Versturen… {n}%',
  'photo.finishing': 'Bijna klaar…',
  'photo.done': 'Foto verstuurd! Zichtbaar zodra die is goedgekeurd.',
  'photo.error': 'Versturen is mislukt. Probeer het opnieuw.',
  'photo.stalled': 'De verbinding hapert, dus het versturen is gestopt. Probeer het opnieuw zodra je beter bereik hebt.',
  'photo.tooManyPending': 'Je hebt al veel foto’s die op goedkeuring wachten. Probeer het opnieuw zodra die bekeken zijn.',
  'photo.disabled': 'Foto’s toevoegen kan even niet. Probeer het later opnieuw.',
  'photo.altPreview': 'Voorbeeld van je foto',

  'rev.kicker': 'Oordeel van ouders',
  'rev.count.one': '{n} beoordeling',
  'rev.count.other': '{n} beoordelingen',
  'rev.confirmed.one': '{n} info bevestigd',
  'rev.confirmed.other': '{n} info’s bevestigd',
  'rev.anon': 'Een ouder',
  'rev.tagOnly': 'bevestigde info',
  'rev.showAll': 'Alle {n} beoordelingen tonen',
  'rev.showLess': 'Minder tonen',
  'rev.loadMore': 'Meer beoordelingen laden',
  'rev.loadingMore': 'Laden…',
  'rev.loadError': 'Meer beoordelingen laden is mislukt. Probeer het opnieuw.',
  'rev.empty.title': 'Nog geen beoordelingen',
  'rev.empty.sub': 'Ben je er geweest? Wees de eerste ouder die vertelt — 30 seconden is genoeg.',
  'rev.signin.text': 'Sterren en reacties vragen een account, zodat elke ouder één keer meetelt.',
  'rev.signin.cta': 'Log in om te beoordelen',
  'rev.signin.votesFree': '💡 De ja/nee-vragen over voorzieningen hierboven beantwoord je zonder account.',
  'rev.signin.draftKept': 'Je beoordeling is op dit apparaat bewaard en staat klaar zodra je weer bent ingelogd.',
  'rev.form.title': 'Jouw beoordeling',
  'rev.form.editing': 'Je hebt deze plek al beoordeeld. Pas je beoordeling hieronder aan.',
  'rev.form.mineError': 'We konden niet nagaan of je deze plek al hebt beoordeeld.',
  'rev.form.ratingLabel': 'Jouw sterren',
  'rev.form.commentLabel': 'Reactie (optioneel)',
  'rev.form.placeholder': 'Vertel andere ouders: toegang, kinderwagen, wat de kinderen leuk vonden…',
  'rev.form.hint': '💡 Je beoordeling verschijnt anoniem, als “{anon}”. Plaats je opnieuw, dan vervangt die je vorige beoordeling.',
  'rev.form.submit': 'Beoordeling plaatsen',
  'rev.form.update': 'Beoordeling bijwerken',
  'rev.form.sending': 'Versturen…',
  'rev.form.thanks': 'Bedankt! Je beoordeling staat online.',
  'rev.form.updated': 'Bedankt! Je beoordeling is bijgewerkt.',
  'rev.form.edit': 'Mijn beoordeling aanpassen',
  'rev.form.error': 'Versturen is mislukt. Probeer het later opnieuw.',
  'rev.form.needSomething': 'Geef een aantal sterren of schrijf een reactie.',
  'rev.stars.label.one': '{n} ster van de 5',
  'rev.stars.label.other': '{n} sterren van de 5',
  'rev.stars.avg': 'Gemiddeld {n} van de 5',

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

/**
 * Keys that come as a `.one` / `.other` pair, named without the suffix. A base is
 * only accepted when both halves exist, so `tn()` can never look up a missing form.
 */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer B}.one` ? (`${B}.other` extends MessageKey ? B : never) : never
}[MessageKey]

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
  'sheet.customersOnly': 'Réservé aux clients',
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
  'auth.backPrev': 'Retour',
  'auth.badEmail': 'Cette adresse e-mail ne semble pas valide.',
  'auth.already': 'Tu es déjà connecté.',
  'auth.continue': 'Continuer',

  'err.network': 'Pas de connexion. Vérifie ton réseau et réessaie.',
  'err.tooMany': 'Doucement : trop de tentatives. Réessaie dans une minute.',
  'err.signedOut': 'Tu n’es plus connecté. Reconnecte-toi.',
  'err.generic': 'Un problème est survenu. Réessaie plus tard.',

  'session.unknown': 'Impossible de vérifier si tu es connecté.',
  'session.retry': 'Réessayer',
  'session.checking': 'Vérification…',

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

  'photo.add': '📷 Ajouter une photo',
  'photo.addAnother': '📷 Ajouter une autre photo',
  'photo.signIn': 'Connecte-toi pour ajouter une photo',
  'photo.badType': 'Impossible de lire ce fichier. Choisis une photo JPEG, PNG ou WebP.',
  'photo.tooBig': 'Cette photo est trop lourde.',
  'photo.send': 'Envoyer',
  'photo.cancel': 'Annuler',
  'photo.cancelled': 'Envoi annulé.',
  'photo.retry': 'Réessayer',
  'photo.sending': 'Envoi de ta photo en cours.',
  'photo.progressLabel': 'Progression de l’envoi',
  'photo.preparing': 'Préparation de la photo…',
  'photo.uploading': 'Envoi… {n}%',
  'photo.finishing': 'Presque fini…',
  'photo.done': 'Photo envoyée ! Elle sera visible après modération.',
  'photo.error': 'Envoi impossible. Réessaie.',
  'photo.stalled': 'La connexion bloque, l’envoi s’est arrêté. Réessaie quand tu captes mieux.',
  'photo.tooManyPending': 'Tu as déjà beaucoup de photos en attente de modération. Réessaie quand elles auront été vues.',
  'photo.disabled': 'L’ajout de photos est en pause pour le moment. Réessaie plus tard.',
  'photo.altPreview': 'Aperçu de ta photo',

  'rev.kicker': 'Note des parents',
  'rev.count.one': '{n} avis',
  'rev.count.other': '{n} avis',
  'rev.confirmed.one': '{n} info confirmée',
  'rev.confirmed.other': '{n} infos confirmées',
  'rev.anon': 'Un parent',
  'rev.tagOnly': 'a confirmé des infos',
  'rev.showAll': 'Voir les {n} avis',
  'rev.showLess': 'Réduire',
  'rev.loadMore': 'Charger plus d’avis',
  'rev.loadingMore': 'Chargement…',
  'rev.loadError': 'Impossible de charger plus d’avis. Réessaie.',
  'rev.empty.title': 'Aucun avis pour l’instant',
  'rev.empty.sub': 'Tu y es allé ? Sois le premier parent à raconter — 30 secondes suffisent.',
  'rev.signin.text': 'Les étoiles et les commentaires demandent un compte, pour que chaque parent ne compte qu’une fois.',
  'rev.signin.cta': 'Connecte-toi pour donner ton avis',
  'rev.signin.votesFree': '💡 Les questions oui/non sur les équipements, plus haut, ne demandent pas de compte.',
  'rev.signin.draftKept': 'Ton avis est gardé sur cet appareil : il t’attendra quand tu te seras reconnecté.',
  'rev.form.title': 'Ton avis',
  'rev.form.editing': 'Tu as déjà donné ton avis sur ce lieu. Tu peux le modifier ci-dessous.',
  'rev.form.mineError': 'Impossible de vérifier si tu as déjà donné ton avis ici.',
  'rev.form.ratingLabel': 'Ta note',
  'rev.form.commentLabel': 'Commentaire (facultatif)',
  'rev.form.placeholder': 'Raconte aux autres parents : accès, poussette, ce qui a plu aux enfants…',
  'rev.form.hint': '💡 Ton avis apparaît anonymement, sous « {anon} ». Si tu publies à nouveau, il remplace ton avis précédent.',
  'rev.form.submit': 'Publier l’avis',
  'rev.form.update': 'Mettre à jour l’avis',
  'rev.form.sending': 'Envoi…',
  'rev.form.thanks': 'Merci ! Ton avis est en ligne.',
  'rev.form.updated': 'Merci ! Ton avis est mis à jour.',
  'rev.form.edit': 'Modifier mon avis',
  'rev.form.error': 'Envoi impossible. Réessaie plus tard.',
  'rev.form.needSomething': 'Ajoute une note en étoiles ou un commentaire.',
  'rev.stars.label.one': '{n} étoile sur 5',
  'rev.stars.label.other': '{n} étoiles sur 5',
  'rev.stars.avg': '{n} sur 5 en moyenne',

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
  'sheet.customersOnly': 'Customers only',
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
  'auth.backPrev': 'Go back',
  'auth.badEmail': 'That email address doesn’t look right.',
  'auth.already': 'You’re already signed in.',
  'auth.continue': 'Continue',

  'err.network': 'No connection. Check your network and try again.',
  'err.tooMany': 'Slow down: too many attempts. Try again in a minute.',
  'err.signedOut': 'You’re no longer signed in. Please sign in again.',
  'err.generic': 'Something went wrong. Try again later.',

  'session.unknown': 'We couldn’t check whether you’re signed in.',
  'session.retry': 'Try again',
  'session.checking': 'Checking…',

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

  'photo.add': '📷 Add a photo',
  'photo.addAnother': '📷 Add another photo',
  'photo.signIn': 'Sign in to add a photo',
  'photo.badType': 'We couldn’t read this file. Pick a JPEG, PNG or WebP photo.',
  'photo.tooBig': 'This photo is too large.',
  'photo.send': 'Upload',
  'photo.cancel': 'Cancel',
  'photo.cancelled': 'Upload cancelled.',
  'photo.retry': 'Try again',
  'photo.sending': 'Sending your photo.',
  'photo.progressLabel': 'Upload progress',
  'photo.preparing': 'Preparing your photo…',
  'photo.uploading': 'Uploading… {n}%',
  'photo.finishing': 'Almost done…',
  'photo.done': 'Photo sent! It will appear once approved.',
  'photo.error': 'Upload failed. Try again.',
  'photo.stalled': 'The connection stalled, so the upload stopped. Try again when you have better signal.',
  'photo.tooManyPending': 'You already have a lot of photos waiting for review. Try again once they’ve been checked.',
  'photo.disabled': 'Adding photos is paused for now. Try again later.',
  'photo.altPreview': 'Preview of your photo',

  'rev.kicker': 'Parents’ rating',
  'rev.count.one': '{n} review',
  'rev.count.other': '{n} reviews',
  'rev.confirmed.one': '{n} fact confirmed',
  'rev.confirmed.other': '{n} facts confirmed',
  'rev.anon': 'A parent',
  'rev.tagOnly': 'confirmed some facts',
  'rev.showAll': 'See all {n} reviews',
  'rev.showLess': 'Show less',
  'rev.loadMore': 'Load more reviews',
  'rev.loadingMore': 'Loading…',
  'rev.loadError': 'Couldn’t load more reviews. Try again.',
  'rev.empty.title': 'No reviews yet',
  'rev.empty.sub': 'Been there? Be the first parent to tell — 30 seconds is enough.',
  'rev.signin.text': 'Stars and comments need an account, so each parent counts once.',
  'rev.signin.cta': 'Sign in to review',
  'rev.signin.votesFree': '💡 The yes/no amenity questions above need no account.',
  'rev.signin.draftKept': 'Your review is kept on this device and will be waiting once you’re signed in again.',
  'rev.form.title': 'Your review',
  'rev.form.editing': 'You’ve already reviewed this place. You can edit your review below.',
  'rev.form.mineError': 'We couldn’t check whether you’ve already reviewed this place.',
  'rev.form.ratingLabel': 'Your rating',
  'rev.form.commentLabel': 'Comment (optional)',
  'rev.form.placeholder': 'Tell other parents: access, stroller, what the kids loved…',
  'rev.form.hint': '💡 Your review appears anonymously, as “{anon}”. Posting again replaces your earlier review.',
  'rev.form.submit': 'Post review',
  'rev.form.update': 'Update review',
  'rev.form.sending': 'Sending…',
  'rev.form.thanks': 'Thanks! Your review is live.',
  'rev.form.updated': 'Thanks! Your review has been updated.',
  'rev.form.edit': 'Edit my review',
  'rev.form.error': 'Could not send. Try again later.',
  'rev.form.needSomething': 'Add a star rating or a comment.',
  'rev.stars.label.one': '{n} star out of 5',
  'rev.stars.label.other': '{n} stars out of 5',
  'rev.stars.avg': '{n} out of 5 on average',

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
  /**
   * A count string: picks `<base>.one` or `<base>.other` with Intl.PluralRules and
   * fills `{n}` with the locale-formatted number. Only two forms because nl, fr and
   * en need no more (French 'one' covers 0 and 1, which is correct French).
   */
  tn: (base: PluralBase, n: number) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    storeLocale(next)
    document.documentElement.lang = next
  }, [])

  const value = useMemo<I18nValue>(() => {
    const t = (key: MessageKey) => MESSAGES[locale][key] ?? MESSAGES[DEFAULT_LOCALE][key]
    const plural = new Intl.PluralRules(locale)
    const number = new Intl.NumberFormat(locale)
    return {
      locale,
      setLocale,
      t,
      tn: (base, n) => {
        const form = plural.select(n) === 'one' ? 'one' : 'other'
        return t(`${base}.${form}`).replace('{n}', number.format(n))
      },
    }
  }, [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
