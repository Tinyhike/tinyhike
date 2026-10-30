import type { Locale } from './i18n'

// A basemap place's category, in the parent's language. The tiles Standard draws
// from (mapbox.mapbox-streets-v8-lite) give no category text, only the icon
// (`maki`) and a broad `class`; transit stops give their `mode`. The icon is the
// most precise, so it wins; the class covers icons missing from this table.

type Label = Record<Locale, string>

const BY_MAKI: Record<string, Label> = {
  restaurant: { nl: 'Restaurant', fr: 'Restaurant', en: 'Restaurant' },
  'restaurant-pizza': { nl: 'Pizzeria', fr: 'Pizzeria', en: 'Pizzeria' },
  'restaurant-noodle': { nl: 'Noedelrestaurant', fr: 'Restaurant de nouilles', en: 'Noodle restaurant' },
  'restaurant-seafood': { nl: 'Visrestaurant', fr: 'Restaurant de poisson', en: 'Seafood restaurant' },
  cafe: { nl: 'Café', fr: 'Café', en: 'Café' },
  'fast-food': { nl: 'Snackbar', fr: 'Restauration rapide', en: 'Fast food' },
  bar: { nl: 'Bar', fr: 'Bar', en: 'Bar' },
  beer: { nl: 'Kroeg', fr: 'Bar à bière', en: 'Pub' },
  'ice-cream': { nl: 'IJssalon', fr: 'Glacier', en: 'Ice cream' },
  bakery: { nl: 'Bakker', fr: 'Boulangerie', en: 'Bakery' },
  confectionery: { nl: 'Snoepwinkel', fr: 'Confiserie', en: 'Sweet shop' },
  grocery: { nl: 'Supermarkt', fr: 'Supermarché', en: 'Grocery' },
  convenience: { nl: 'Buurtwinkel', fr: 'Supérette', en: 'Convenience store' },
  'alcohol-shop': { nl: 'Slijterij', fr: 'Caviste', en: 'Liquor store' },
  shop: { nl: 'Winkel', fr: 'Magasin', en: 'Shop' },
  'clothing-store': { nl: 'Kledingwinkel', fr: 'Magasin de vêtements', en: 'Clothing store' },
  shoe: { nl: 'Schoenenwinkel', fr: 'Magasin de chaussures', en: 'Shoe shop' },
  'mobile-phone': { nl: 'Telefoonwinkel', fr: 'Magasin de téléphonie', en: 'Phone shop' },
  furniture: { nl: 'Meubelwinkel', fr: 'Magasin de meubles', en: 'Furniture store' },
  hardware: { nl: 'Bouwmarkt', fr: 'Quincaillerie', en: 'Hardware store' },
  florist: { nl: 'Bloemist', fr: 'Fleuriste', en: 'Florist' },
  gift: { nl: 'Cadeauwinkel', fr: 'Boutique de cadeaux', en: 'Gift shop' },
  'jewelry-store': { nl: 'Juwelier', fr: 'Bijouterie', en: 'Jewellery store' },
  optician: { nl: 'Opticien', fr: 'Opticien', en: 'Optician' },
  hairdresser: { nl: 'Kapper', fr: 'Coiffeur', en: 'Hairdresser' },
  laundry: { nl: 'Wasserette', fr: 'Laverie', en: 'Laundry' },
  pharmacy: { nl: 'Apotheek', fr: 'Pharmacie', en: 'Pharmacy' },
  doctor: { nl: 'Huisarts', fr: 'Médecin', en: 'Doctor' },
  dentist: { nl: 'Tandarts', fr: 'Dentiste', en: 'Dentist' },
  hospital: { nl: 'Ziekenhuis', fr: 'Hôpital', en: 'Hospital' },
  veterinary: { nl: 'Dierenarts', fr: 'Vétérinaire', en: 'Vet' },
  school: { nl: 'School', fr: 'École', en: 'School' },
  college: { nl: 'Hogeschool', fr: 'Établissement d’enseignement supérieur', en: 'College' },
  library: { nl: 'Bibliotheek', fr: 'Bibliothèque', en: 'Library' },
  museum: { nl: 'Museum', fr: 'Musée', en: 'Museum' },
  'art-gallery': { nl: 'Galerie', fr: 'Galerie d’art', en: 'Art gallery' },
  theatre: { nl: 'Theater', fr: 'Théâtre', en: 'Theatre' },
  cinema: { nl: 'Bioscoop', fr: 'Cinéma', en: 'Cinema' },
  music: { nl: 'Muziekzaal', fr: 'Salle de concert', en: 'Music venue' },
  attraction: { nl: 'Bezienswaardigheid', fr: 'Attraction', en: 'Attraction' },
  monument: { nl: 'Monument', fr: 'Monument', en: 'Monument' },
  castle: { nl: 'Kasteel', fr: 'Château', en: 'Castle' },
  viewpoint: { nl: 'Uitzichtpunt', fr: 'Point de vue', en: 'Viewpoint' },
  zoo: { nl: 'Dierentuin', fr: 'Zoo', en: 'Zoo' },
  park: { nl: 'Park', fr: 'Parc', en: 'Park' },
  garden: { nl: 'Tuin', fr: 'Jardin', en: 'Garden' },
  playground: { nl: 'Speeltuin', fr: 'Aire de jeux', en: 'Playground' },
  'dog-park': { nl: 'Hondenuitlaatplaats', fr: 'Parc à chiens', en: 'Dog park' },
  swimming: { nl: 'Zwembad', fr: 'Piscine', en: 'Swimming pool' },
  'fitness-centre': { nl: 'Sportschool', fr: 'Salle de sport', en: 'Gym' },
  stadium: { nl: 'Stadion', fr: 'Stade', en: 'Stadium' },
  pitch: { nl: 'Sportveld', fr: 'Terrain de sport', en: 'Sports pitch' },
  'place-of-worship': { nl: 'Gebedshuis', fr: 'Lieu de culte', en: 'Place of worship' },
  'religious-christian': { nl: 'Kerk', fr: 'Église', en: 'Church' },
  'religious-muslim': { nl: 'Moskee', fr: 'Mosquée', en: 'Mosque' },
  'religious-jewish': { nl: 'Synagoge', fr: 'Synagogue', en: 'Synagogue' },
  lodging: { nl: 'Hotel', fr: 'Hôtel', en: 'Hotel' },
  bank: { nl: 'Bank', fr: 'Banque', en: 'Bank' },
  post: { nl: 'Postkantoor', fr: 'Bureau de poste', en: 'Post office' },
  'town-hall': { nl: 'Stadhuis', fr: 'Mairie', en: 'Town hall' },
  police: { nl: 'Politie', fr: 'Police', en: 'Police' },
  'fire-station': { nl: 'Brandweer', fr: 'Pompiers', en: 'Fire station' },
  toilet: { nl: 'Toiletten', fr: 'Toilettes', en: 'Toilets' },
  information: { nl: 'Informatie', fr: 'Information', en: 'Information' },
  parking: { nl: 'Parkeerplaats', fr: 'Parking', en: 'Parking' },
  'parking-garage': { nl: 'Parkeergarage', fr: 'Parking couvert', en: 'Parking garage' },
  fuel: { nl: 'Tankstation', fr: 'Station-service', en: 'Fuel station' },
  'charging-station': { nl: 'Laadpaal', fr: 'Borne de recharge', en: 'Charging station' },
  bicycle: { nl: 'Fietsenwinkel', fr: 'Magasin de vélos', en: 'Bike shop' },
  car: { nl: 'Autobedrijf', fr: 'Garage', en: 'Car dealer' },
  harbor: { nl: 'Haven', fr: 'Port', en: 'Harbour' },
}

const BY_CLASS: Record<string, Label> = {
  food_and_drink: { nl: 'Eten en drinken', fr: 'Restauration', en: 'Food and drink' },
  food_and_drink_stores: { nl: 'Levensmiddelen', fr: 'Alimentation', en: 'Food shop' },
  store_like: { nl: 'Winkel', fr: 'Magasin', en: 'Shop' },
  park_like: { nl: 'Park', fr: 'Parc', en: 'Park' },
  arts_and_entertainment: { nl: 'Cultuur en uitgaan', fr: 'Culture et loisirs', en: 'Arts and entertainment' },
  sport_and_leisure: { nl: 'Sport en vrije tijd', fr: 'Sport et loisirs', en: 'Sport and leisure' },
  education: { nl: 'Onderwijs', fr: 'Enseignement', en: 'Education' },
  medical: { nl: 'Zorg', fr: 'Santé', en: 'Health' },
  religion: { nl: 'Gebedshuis', fr: 'Lieu de culte', en: 'Place of worship' },
  lodging: { nl: 'Logies', fr: 'Hébergement', en: 'Lodging' },
  commercial_services: { nl: 'Dienstverlening', fr: 'Services', en: 'Services' },
  public_facility: { nl: 'Openbare voorziening', fr: 'Service public', en: 'Public facility' },
  visitor_amenities: { nl: 'Voorziening', fr: 'Équipement', en: 'Visitor amenity' },
  motorist: { nl: 'Auto', fr: 'Automobile', en: 'Motoring' },
  historic: { nl: 'Historische plek', fr: 'Lieu historique', en: 'Historic site' },
  landmark: { nl: 'Bezienswaardigheid', fr: 'Monument', en: 'Landmark' },
}

const BY_TRANSIT_MODE: Record<string, Label> = {
  metro_rail: { nl: 'Metrostation', fr: 'Station de métro', en: 'Metro station' },
  rail: { nl: 'Treinstation', fr: 'Gare', en: 'Train station' },
  light_rail: { nl: 'Tramhalte', fr: 'Arrêt de tram', en: 'Tram stop' },
  tram: { nl: 'Tramhalte', fr: 'Arrêt de tram', en: 'Tram stop' },
  bus: { nl: 'Bushalte', fr: 'Arrêt de bus', en: 'Bus stop' },
  ferry: { nl: 'Veerhaven', fr: 'Embarcadère', en: 'Ferry terminal' },
}

const TRANSIT: Label = { nl: 'Openbaar vervoer', fr: 'Transports en commun', en: 'Public transport' }

/** The place's category in `locale`, or null when the tiles say nothing usable. */
export function poiCategory(maki: string | null, cls: string | null, locale: Locale): string | null {
  const label = (maki && BY_MAKI[maki]) || (cls && BY_CLASS[cls]) || null
  return label ? label[locale] : null
}

export function transitCategory(mode: string | null, locale: Locale): string {
  return ((mode && BY_TRANSIT_MODE[mode]) || TRANSIT)[locale]
}
