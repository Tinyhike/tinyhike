# Plan : masquer les cafés non vérifiés

**Statut : exécuté le 26 octobre 2026**, après le feu vert de Jérôme. Ses décisions sont au §7 et le résultat au §8. Le §9 propose un affichage des âges et des jeux (non codé). Le §10 propose d'élargir l'import aux restaurants de brunch (non appliqué). Les §0 à §6 sont la proposition soumise à Jérôme ; ses décisions (§7) et le résultat (§8) la remplacent là où ils diffèrent. Les écarts sont signalés en ligne par « **Exécuté :** ».

Décision de Jérôme (26/10) : la carte n'affiche que les aires de jeux, les parcs et les lieux vérifiés. Les cafés restent en base, masqués tant qu'ils ne sont pas vérifiés.

---

## 0. Ce que disent les données (relevé du 26/10, lecture seule)

La requête Overpass du seed a été relancée une fois et croisée avec les 1318 lieux de la base. Rien n'a été écrit.

| Catégorie OSM (tag) | Lieux | Dont enrichis (description nl/fr/en) |
|---|---|---|
| Aire de jeux (`leisure=playground`) | 854 | 10 |
| Parc (`leisure=park`) | 159 | 98 |
| Aire de pique-nique (`tourism=picnic_site`) | 14 | 1 |
| Café (`amenity=cafe`) | 274 | 260 |
| Ne correspond plus à rien dans OSM | 17 | — |

- **Aucun élément ne porte deux catégories** : la classification est sans ambiguïté.
- **`hasCafe` coïncide exactement avec `amenity=cafe`** pour les 274 cafés retrouvés (0 écart). Il fera un bon contrôle croisé du backfill, mais pas une bonne source :
  - c'est un équipement (« il y a un café sur place »), pas une nature de lieu : un parc avec un café serait masqué à tort dès qu'un vote ou l'enrichissement poserait ce tag ;
  - il ne dit rien des lieux sortis d'OSM : il est vide sur les 9 lieux « legacy » du seed de juin, qui étaient presque tous des cafés.
- **Les 17 lieux qui ne correspondent plus à OSM** ont été vérifiés un par un dans OSM :
  - les 9 legacy (`osm:<id>`) : United est devenu un pub, De Gulle Jacob un fast-food, Floor un restaurant, Afhaalloket n'a plus de tag, et 5 ont disparu d'OSM (Doppio, Baris, JJ's, 30ML et un doublon de Biezenpark) ;
  - 8 au format typé : 2 anciens cafés, 5 anciennes aires de jeux (4 nœuds sans tag, 1 devenue `fitness_station`) et 1 élément sans tag.
- **Conséquences du masquage :**
  - **Lieux visibles** : 1013 (854 aires de jeux et 159 parcs), 1027 si les aires de pique-nique restent visibles. Sur la bbox par défaut, `X-Total-Count` passerait de 1317 à environ 1012. Le bandeau « zoom in » reste, puisque la limite est de 500. **Exécuté :** les aires de pique-nique restent visibles, donc 1027 lieux publics et `X-Total-Count` = 1026 sur la bbox par défaut (un lieu public est hors de la bbox).
  - **Descriptions** : 260 des 381 lieux enrichis sont des cafés. Une fois les cafés masqués, **environ 108 des 1013 lieux visibles ont une description (11 %)**. 918 lieux visibles n'en ont pas (844 aires de jeux, 61 parcs, 13 aires de pique-nique). La décision d'enrichir les 937 lieux (ROADMAP, décision 2) devient donc beaucoup plus importante.
  - **Contributions** : la seule contribution en base (un vote de tags anonyme) porte sur un café. Elle est masquée avec lui mais conservée. Aucune photo ni liste n'est touchée.

## 1. Identifier un café : `Place.category`

- Enum `PlaceCategory { PLAYGROUND PARK PICNIC_SITE CAFE }`, **nullable** : null = inconnu, même convention que les tags tri-état.
- Une seule source : `kindOf(tags)` dans `api/src/lib/osm.ts`, que le seed utilise déjà pour les noms génériques. Le seed, le backfill et la suite partagent ainsi le même mapping.
- **Seed** (`seed-osm.ts`) : `category: kindOf(el.tags)` à la création. **Exécuté :** `categoryOf(el.tags)`, qui traduit le `kindOf` en valeur de l'enum.
- **Backfill** (`backfill-osm-tags.ts`) :
  - il remplit `category` quand elle est null, avec la même règle que les tags (ne jamais écraser une valeur posée) ;
  - `DRY_RUN=1` affiche le décompte par catégorie et le contrôle croisé avec `hasCafe`.
  - Note : ce même passage remplira aussi les tags OSM apparus depuis le 14/09, uniquement là où ils sont null. Le dry-run le montrera.
- **Les 17 lieux sortis d'OSM** restent à null, donc masqués : la règle est fermée par défaut (voir §3).
- **Proposition par un parent** (`POST /api/places`) : `category` optionnelle dans le body (`z.enum`), null si absente. Aucune UI pour l'instant.
- **`POST /api/admin/seed`** (route héritée) : sans catégorie, donc masqué tant que le lieu n'est pas vérifié.
- **Pourquoi un enum plutôt qu'une chaîne** : il est typé de Prisma jusqu'au TypeScript et vérifié par les tests. Ajouter une catégorie plus tard = une migration `ALTER TYPE … ADD VALUE`.
- **`hasCafe` reste un équipement** et ne sert plus à classer.

## 2. Marquer un lieu vérifié : `Place.verifiedAt` + `verifiedById`

- `verifiedAt DateTime?` et `verifiedById String?` → `User`, `onDelete: SetNull`.
- **Indépendant de `status`** :
  - `status` sert à la modération d'une proposition (PENDING / APPROVED / REJECTED). Tous les lieux OSM sont APPROVED d'office ;
  - `verifiedAt` signifie qu'un humain a confirmé que le lieu convient à TinyHike.
- **Confidentialité** : `verifiedById` est un id utilisateur. Il ne doit jamais sortir dans une réponse publique (règle de CLAUDE.md), donc il est retiré de la carte, du détail et des listes, comme `submittedById`. `verifiedAt` peut être public, ce qui permettrait plus tard un badge « Vérifié » (hors de ce lot). **Exécuté :** non, Jérôme a décidé que la date reste privée elle aussi, et `updatedAt` est retiré avec elle (il vaut l'instant de la vérification). Un badge futur passerait par un simple booléen `verified`.
- **Qui vérifie** : un admin. Deux entrées partagent `api/src/services/place-verification.ts`, sur le modèle de `photo-moderation.ts` :
  - la CLI `pnpm places:verify list [--category CAFE] | verify <id> [--by <email>] | unverify <id>`, utilisable tout de suite et sans compte admin ; **Exécuté :** la CLI exige un compte ADMIN en base (`--by <email>`, ou le seul ADMIN par défaut), car l'auteur de la vérification est enregistré ;
  - `PATCH /api/admin/places/:id`, qui accepterait `{ verified: true | false }` en plus du statut, et une nouvelle route `GET /api/admin/places?category=CAFE&verified=false`, la liste qui manque aujourd'hui. **Exécuté :** la vérification a ses propres routes, `PUT /api/admin/places/:id/verification` (les 4 points) et `DELETE` pour la retirer. `PATCH /api/admin/places/:id` n'accepte que `status` et `category`.
  - Les routes admin exigent un compte ADMIN, et il n'y en a aucun. Passer le compte de Jérôme en ADMIN est une écriture en base (avec son accord). Il doit ensuite se reconnecter, car le rôle est lu dans le JWT.
- **Approbation d'une proposition** : approuver un lieu proposé par un parent poserait aussi `verifiedAt` (à confirmer, voir §7).

## 3. Une seule règle de visibilité, partout

Aujourd'hui, la règle est **dupliquée 4 fois** : `canSee` dans `places.ts`, `canContribute` dans `photos.ts`, et deux tests en ligne dans `lists.ts`. Le plan les remplace par un module unique, `api/src/lib/place-visibility.ts`.

Ce module expose :
- `VISIBLE_CATEGORIES = ['PLAYGROUND', 'PARK']`, plus `'PICNIC_SITE'` selon la décision de Jérôme ;
- `publicPlaceWhere` (clause Prisma) : `{ status: 'APPROVED', OR: [{ category: { in: VISIBLE_CATEGORIES } }, { verifiedAt: { not: null } }] }` ;
- `canSeePlace(place, session)` : la règle publique ci-dessus, ou bien un ADMIN, ou bien l'auteur de la proposition (comportement actuel inchangé).

C'est une liste blanche fermée par défaut : une catégorie null ou une catégorie nouvelle reste masquée tant que personne n'a vérifié le lieu.

| Endpoint | Aujourd'hui | Après |
|---|---|---|
| `GET /api/places` (carte) | `status: APPROVED` | `publicPlaceWhere`, aussi pour `X-Total-Count` |
| `GET /api/places/:id` (détail) | `canSee` | `canSeePlace` → 404. Le web affiche déjà « Ce lieu n'existe pas ou n'est plus publié » (`PlaceSheet.tsx:88`, `sheet.notFound`) |
| `GET /api/places/:id/reviews` | `canSee` | `canSeePlace` |
| `GET /api/places/:id/my-review` | **aucune vérification** | `canSeePlace` (404) |
| `POST /api/places/:id/reviews` (avis et votes de tags) | `canSee` | `canSeePlace` |
| `POST /api/photos/confirm` | `canContribute` | `canSeePlace` (les envois sont de toute façon OFF) |
| `GET /api/lists/:slug` | filtre sur le statut | `canSeePlace` pour chaque lieu de la liste |
| `GET /api/lists/public`, `/mine` | `_count` de tous les lieux | ne compter que les lieux visibles (0 liste aujourd'hui) |
| `POST /api/lists/:slug/places` | test en ligne | `canSeePlace` |
| Recherche | **n'existe pas** (grep sur `api/src` et `web/src`) | rien à filtrer. Toute future recherche partira de `publicPlaceWhere` |
| `GET /api/admin/stats` | — | + nombre de lieux masqués et de lieux vérifiés |
| `jobs/enrich.ts` | tous les lieux OSM non enrichis | (option) seulement les lieux visibles, ce qui économise des appels Claude |

**Web** : aucun changement nécessaire. La carte reçoit simplement moins de points, et le 404 du détail est déjà géré. Pas de rebuild de `web/dist`.

## 4. Migration, sans `migrate dev`

Il n'y a qu'une base, la prod. `prisma migrate dev --create-only` s'y connecte quand même. Il la compare à une base fantôme, voit une dérive (colonnes `geom`, trigger `trg_place_geom` et index partiel des avis, invisibles pour Prisma : pitfalls 5 et 22) et peut proposer un reset. Le plan utilise donc une méthode plus stricte : générer le SQL **à partir des deux fichiers de schéma, sans aucune connexion à la base**. C'est vérifié le 26/10 : la commande ci-dessous produit le SQL avec une `DATABASE_URL` volontairement injoignable.

```bash
cd /srv/tinyhike/api
git show HEAD:api/prisma/schema.prisma > /tmp/schema.before.prisma
mkdir prisma/migrations/2026MMDDHHMMSS_place_category_and_verification
pnpm exec prisma migrate diff \
  --from-schema-datamodel /tmp/schema.before.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/2026MMDDHHMMSS_place_category_and_verification/migration.sql
```

SQL attendu, à relire avant de l'appliquer :

```sql
CREATE TYPE "PlaceCategory" AS ENUM ('PLAYGROUND', 'PARK', 'PICNIC_SITE', 'CAFE');
ALTER TABLE "Place" ADD COLUMN "category" "PlaceCategory",
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "verifiedById" TEXT;
ALTER TABLE "Place" ADD CONSTRAINT "Place_verifiedById_fkey" FOREIGN KEY ("verifiedById")
  REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Points à vérifier à la relecture :
- **aucun `DROP`** ;
- **rien sur `geom`, `trg_place_geom` ni `Review_one_written_per_user_per_place`** ;
- uniquement des ajouts de colonnes nullables : l'API en production ne les voit pas et continue de tourner.

Pas d'index : 1318 lignes ne le justifient pas. L'application se fait par `pnpm db:migrate` (= `prisma migrate deploy`, qui ne fait jamais de reset), après un `pg_dump`, puis `pnpm db:generate`.

## 5. Ordre de déploiement (l'ordre compte)

1. `pg_dump` de la base.
2. `pnpm db:migrate`. Les colonnes sont créées à null, et l'API actuelle n'est pas affectée.
3. `DRY_RUN=1 pnpm backfill:osm-tags`. Attendu : environ 854 PLAYGROUND, 159 PARK, 14 PICNIC_SITE, 274 CAFE et 17 null, avec 0 écart avec `hasCafe`. Si c'est conforme, lancer le vrai passage.
4. Contrôler les décomptes en SQL (`GROUP BY category`).
5. Déployer l'API (`pnpm test`, `pnpm build`, `systemctl restart tinyhike-api`). **Jamais avant l'étape 3** : avec une règle fermée par défaut, une catégorie null = masqué, et la carte serait vide.
6. Smoke test :
   - sur la bbox par défaut, `X-Total-Count` ≈ 1012 (**exécuté :** 1026 avec les aires de pique-nique, plus les cafés vérifiés depuis) ;
   - un id de café → 404 ;
   - une aire de jeux → 200 ;
   - un café vérifié par la CLI (si Jérôme le souhaite) → 200.

**Retour arrière** : revenir sur le commit API, rebuild, puis redémarrer le service, et les cafés réapparaissent. Les colonnes restent en place : elles sont inertes, inutile de défaire la migration.

## 6. Tests à ajouter (Vitest, Prisma et R2 mockés comme aujourd'hui)

- **`osm.test.ts`** :
  - chaque tag donne sa catégorie (`playground`, `park`, `picnic_site`, `cafe`) ;
  - un élément sans tag connu donne null ;
  - l'ordre de priorité de `kindOf` est vérifié sur un élément qui porterait deux tags.
- **`place-visibility.test.ts`** (nouveau) : une matrice catégorie × `verifiedAt` × `status` × session (anonyme, membre, auteur, admin). En particulier :
  - un café non vérifié est masqué pour un anonyme ou un membre, visible pour un admin ;
  - un café vérifié est visible ;
  - une catégorie null est masquée ;
  - les règles PENDING actuelles ne changent pas.
- **`places.test.ts`** :
  - `findMany` **et** `count` reçoivent `publicPlaceWhere` (cohérence de `X-Total-Count`) ;
  - la réponse ne contient ni `verifiedById` ni `submittedById` ;
  - le détail d'un café masqué répond 404 (anonyme, membre) et 200 pour un admin ou pour un café vérifié ;
  - `reviews`, `my-review`, `POST reviews` et le vote de tags répondent 404 sur un café masqué.
- **`photos.test.ts`** : `confirm` vers un café masqué répond 404, avant toute copie R2.
- **`lists.test.ts`** :
  - un café masqué n'apparaît pas dans `GET /:slug` ;
  - `POST /:slug/places` vers un café masqué répond 404 ;
  - les compteurs ne comptent que les lieux visibles.
- **`admin.test.ts`** :
  - `PATCH /places/:id {verified: true}` pose `verifiedAt` et `verifiedById`, `{verified: false}` les efface (**exécuté :** `PUT` et `DELETE /places/:id/verification`) ;
  - un membre reçoit 403 ;
  - `GET /admin/places?category=CAFE&verified=false` fonctionne ;
  - les stats comptent les lieux masqués et vérifiés.
- **`place-verification.test.ts`** (service partagé CLI/admin) : vérifier, dé-vérifier, id inconnu, lieu déjà vérifié.
- **Backfill** : extraire une fonction pure (catégorie seulement si null ; un lieu sans élément OSM reste null ; le dry-run n'écrit rien) et la tester.
- **Seed** : la création porte `category`.

## 7. Décisions de Jérôme (feu vert du 26 octobre)

Les questions posées dans la proposition sont gardées ci-dessous (§7 d'origine). Les réponses :

1. **Visibles** : aires de jeux, parcs **et aires de pique-nique**. **Masqués** : les 274 cafés et les 17 lieux sortis d'OSM, tant qu'ils ne sont pas vérifiés.
2. **Café vérifié** : quatre points relevés lors d'une visite : entrée praticable en poussette, place pour la poussette à l'intérieur, table à langer, toilettes. Chaque point vaut oui ou non. Un café vérifié peut afficher « non », ce qui sert à signaler les cafés à éviter. On réutilise les tags existants qui correspondent. La date et l'auteur de la vérification sont gardés et jamais exposés publiquement.
3. **Admin** : le compte de Jérôme passe ADMIN. **Approuver une proposition ne vaut pas vérification** : ce sont deux actions distinctes (contrairement à la recommandation 4 ci-dessous).
4. **Descriptions** : pas d'enrichissement IA pour l'instant, et plus jamais sur un lieu masqué. À la place : import depuis OSM de l'âge conseillé et des types de jeux des aires de jeux, couverture mesurée d'abord, affichage proposé sans être codé (§9).

### Questions d'origine

1. **Aires de pique-nique (14)** : visibles comme les parcs ? Recommandé : oui, ce sont des lieux de plein air du même type.
2. **Les 17 lieux sortis d'OSM** (pub, restaurant, fast-food, nœuds sans tag, éléments supprimés) : masqués ? Recommandé : oui, la règle fermée par défaut le fait toute seule.
3. **Critères de vérification** d'un café : ce que l'admin contrôle (accès poussette, table à langer, place…). C'est à Jérôme de les définir.
4. **Approuver la proposition d'un parent vaut-il vérification ?** Recommandé : oui, un humain a regardé le lieu.
5. **Outil de vérification** : la CLI tout de suite (recommandé), la route admin pour la future interface. Passer le compte de Jérôme en ADMIN maintenant ou plus tard ?
6. **Enrichissement** : ne plus enrichir les lieux masqués (recommandé). Et relancer la décision sur les 937 lieux, puisque la part de lieux visibles avec description tombe à environ 11 %.

**Estimation** : environ une demi-journée de code et de tests, puis environ 15 minutes de déploiement, sans rebuild du web. La doc (CLAUDE.md « Known mismatch », ROADMAP, STATE §8) sera mise à jour dans le même lot.

## 8. Résultat (26 octobre 2026)

**Ordre suivi** : sauvegarde, SQL relu, migration, catégorie en simulation puis en réel, compte ADMIN, code et tests, revue, API, vérification en production.

- **Sauvegarde** : `~/backups/tinyhike-pre-cafes-20261026-1157.dump` (`pg_dump -Fc`, 315 Ko, 18 tables, chmod 600).
- **Migrations**, générées hors connexion et relues : aucun `DROP`, rien sur `geom` ni sur l'index partiel des avis. Appliquées par `pnpm db:migrate`.
  - `20261026120000_place_category_and_verification` : l'enum `PlaceCategory`, et les colonnes `category`, `verifiedAt` et `verifiedById` (clé étrangère `SET NULL`).
  - `20261026120100_playground_age_and_equipment` : `minAge`, `maxAge` et `playEquipment` (liste vide par défaut).
- **Catégorie** (`pnpm backfill:osm-tags`) : la simulation puis le passage réel donnent la même chose.
  - 854 PLAYGROUND, 159 PARK, 14 PICNIC_SITE, 274 CAFE, 17 null.
  - 0 écart avec `hasCafe`.
  - Le même passage a posé 9 tags OSM apparus depuis le 14/09, uniquement là où ils étaient vides : 6 `wheelchairOk`, 2 `hasOutdoorSeating`, 1 `enclosed`.
  - En SQL : **1027 lieux publics, 291 masqués**.
- **Les 4 points de vérification** réutilisent 4 des 19 tags existants : aucune colonne et aucun changement web n'ont été nécessaires.

  | Point de visite | Tag | Libellé affiché (fr) |
  |---|---|---|
  | Entrée praticable en poussette | `wheelchairOk` | « Sans marche » |
  | Place pour la poussette à l'intérieur | `isStrollerWide` | « Passage large » |
  | Table à langer | `hasChangingTable` | « Table à langer » |
  | Toilettes | `hasToilets` | « Toilettes » |

  Le libellé « Passage large » est plus étroit que ce qu'on vérifie. **Exécuté le 26/10 :** renommé « Place pour la poussette » (nl « Ruimte voor de kinderwagen », en « Room for the stroller »), web reconstruit.
- **Vérifier un café** : `pnpm places:verify` (CLI), ou `PUT /api/admin/places/:id/verification` (route admin). La date et l'admin sont enregistrés dans `verifiedAt` et `verifiedById`, jamais renvoyés publiquement. Le vérificateur doit être ADMIN en base, pas seulement dans son JWT. Pour retirer une vérification : `unverify`, ou `DELETE` sur la même route.
- **Admin** : le seul compte en base est ADMIN. Le rôle est lu dans le JWT : Jérôme doit se déconnecter puis se reconnecter pour l'obtenir dans l'app (la CLI n'en a pas besoin).
- **Approbation ≠ vérification** : `PATCH /api/admin/places/:id` approuve, rejette, ou fixe la `category` d'une proposition. Il ne touche jamais à `verifiedAt`.
- **Enrichissement** : `enrich.ts` ne prend plus que les lieux publics. Il n'a pas été lancé.
- **Revue adversariale avant déploiement** : quatre relecteurs indépendants (fuites, correction, déploiement, valeur des tests), et chaque point sérieux contre-vérifié. Un point moyen confirmé, corrigé : `updatedAt` publiait l'instant de la vérification. Corrigés aussi :
  - le rôle ADMIN est relu en base pour retirer une vérification et pour changer une catégorie ;
  - une tranche d'âge ne peut plus s'inverser d'un passage à l'autre ;
  - la route `POST /api/admin/seed` est validée et accepte une catégorie ;
  - la CLI tolère `--` ;
  - deux docs avaient des chiffres périmés ;
  - huit trous de tests sont comblés.

  **563 tests** passent au total.
- **API déployée** (`pnpm build`, `systemctl restart tinyhike-api`), puis vérifiée en production, directement sur le serveur et à travers Cloudflare :
  - `X-Total-Count` = **1026** sur la bbox par défaut ; aucun café sur la carte ;
  - aucun `verifiedAt`, `verifiedById`, `submittedById` ni `updatedAt` dans la carte ou le détail ;
  - un café et un lieu sans catégorie → **404**, y compris leurs avis et un vote de tag ;
  - une aire de jeux → 200, avec `category` et `playEquipment` ;
  - `/api/admin/places` sans session → 401 ;
  - le web (`/`) → 200, sans rebuild.
- **Âges et jeux** (`pnpm backfill:playgrounds`) : 63 lieux complétés, dont 61 avec des types de jeux et 3 avec un âge (1 `minAge` et 3 `maxAge`). Ces champs sont renvoyés par le détail, pas par la carte, et ne sont pas encore affichés.

### Couverture OSM mesurée (lecture seule, 26/10, 882 aires de jeux OSM dans la bbox)

| Donnée | Aires de jeux concernées |
|---|---|
| `min_age` sur l'aire elle-même | 1 (0,1 %) |
| `max_age` sur l'aire elle-même | 3 (0,3 %) |
| Au moins un jeu `playground=*` cartographié **dans** le contour | 62 des 775 aires dessinées en surface (8 %) |
| `playground=*` porté par l'aire elle-même | 8 |
| Aires réduites à un point, avec un jeu à moins de 30 m | 2 sur 107 (non rattachés) |
| Jeux avec un âge (`min_age` / `max_age`), balançoire bébé (`baby=yes`) | 1, 1 et 2 |

- **Jeux** : 248 éléments `playground=*` dans la bbox. 151 sont dans le contour d'une aire de jeux, 97 hors de toute aire (cours d'école, résidences, éléments isolés).
- **Types les plus courants** : `structure` 41, `swing` 37, `slide` 26, `springy` 25, `horizontal_bar` 21, `climbingframe` 16, `seesaw` 16, `sandpit` 7.
- **Aires privées** : en passant, 22 aires de jeux OSM sont `access=private` et 14 `access=customers` (cours d'école, résidences, terrasses de café). Elles sont sur la carte. Les masquer serait une décision produit, non prise.

## 9. Proposition d'affichage des âges et des jeux sur la fiche (non codée)

**Principe** : ne rien montrer quand OSM ne dit rien. C'est le cas de plus de 90 % des aires de jeux, et une ligne « âge inconnu » sur 9 fiches sur 10 n'apporte rien. Aucun « À confirmer » non plus pour l'instant : ce ne sont pas des oui/non, la mécanique de vote ne s'y applique pas telle quelle.

1. **Tranche d'âge**, en pastille sous le titre, seulement si `minAge` ou `maxAge` est connu :

   | Données | fr | nl | en |
   |---|---|---|---|
   | min et max | « 0–6 ans » | « 0–6 jaar » | « Ages 0–6 » |
   | min seul | « Dès 3 ans » | « Vanaf 3 jaar » | « From age 3 » |
   | max seul | « Jusqu'à 12 ans » | « Tot 12 jaar » | « Up to age 12 » |

2. **Jeux**, une ligne « 🛝 Jeux » au-dessus des équipements, seulement pour une aire de jeux avec au moins un type connu :
   - des puces courtes, en texte : « Balançoire · Toboggan · Bac à sable · Jeu à ressort » ;
   - au plus 6 puces, puis « +N » ;
   - les jeux qui comptent le plus pour les tout-petits passent en premier : balançoire bébé, bac à sable, jeu à ressort, petit toboggan ;
   - un libellé i18n par valeur OSM connue (`play.swing`, `play.slide`, `play.sandpit`, `play.springy`, `play.structure` → « Structure de jeux », etc., 22 valeurs aujourd'hui) ;
   - une valeur inconnue n'est **pas** affichée brute (même règle que les tags, `isTagKey`).
3. **Côté API**, rien à changer : le détail renvoie déjà `category`, `minAge`, `maxAge` et `playEquipment`. La carte ne les reçoit pas, pour garder sa charge légère. Un filtre « âge » sur la carte demanderait de les y remettre, et n'a pas de sens avec 3 aires renseignées.
4. **En passant** : le web choisit l'ordre des groupes d'équipements avec `hasCafe` (`web/src/lib/tags.ts`, `groupOrder`). `category` est maintenant dans la charge et serait le bon signal, à changer dans le même lot web.
5. **Pour enrichir la donnée**, plus tard : une contribution « quels jeux ? » par les parents (puces à cocher, sur le modèle des votes de tags), ou des corrections poussées dans OSM. Avec 8 % de couverture, c'est la contribution qui fera la valeur de ce bloc.

**Charge estimée** pour le web (1 et 2) : environ 2 heures, avec les 3 langues, sans changement d'API.

## 10. Élargir l'import aux restaurants de brunch (proposition, non appliquée)

**Pourquoi.** Jérôme n'a pas trouvé By Jarmusch West avec `pnpm places:verify list`. OSM le classe `amenity=restaurant` + `cuisine=breakfast` (`node/11007237505`, Nieuwe Binnenweg 575), et le seeder ne prend que `amenity=cafe` : il n'a jamais été importé. En attendant une décision, `pnpm places:verify add node/<id> --category CAFE` ajoute un tel lieu à la main, masqué jusqu'à sa vérification (fait le 26/10).

### Relevé du 26/10 (Overpass, lecture seule, bbox Rotterdam `51.8,4.4,51.95,4.6`)

- 770 `amenity=restaurant` dans la bbox, dont **328 sans `cuisine`** : la donnée OSM est le vrai plafond.
- **Filtre demandé** (`amenity=restaurant` dont `cuisine` contient `breakfast`, `brunch` ou `coffee_shop`) : **10 restaurants**, tous nommés, aucun déjà en base.
  - `breakfast` (7) : Baker & Moore, By Jarmusch West, Juffrouw van Zanten Rotterdam West, Lider BBQ Villa, Pancakes by June, Restobar Colette, SUE.
  - `coffee_shop` (3) : De Machinist, Het Leerstation, Het Theehuis.
  - `brunch` : 0. Les clés `brunch=*` / `breakfast=*` : 2 lieux, déjà en base comme cafés.
- **Variante plus large** (+ `cuisine=pancake`, `lunch`, `lunchroom`) : **20 restaurants**. Les 10 de plus : 6 pannenkoekenhuizen (De Pannenkoekenboot, De Oude Maas, De Nachtegaal, Pannenkoe ×2, Petit Restaurant Schollebos), Lunchroom Leuk!, Lunchroom Devon, Brasserie Maxim's, FC Kip.
- **À exclure** : 8 autres lieux tagués `coffee_shop` mais qui ne sont pas des restaurants (4 glaciers, 2 boulangeries Vlaamsch Broodhuys, un bar à espresso, un Dunkin').
- **Manqués même par la variante** : des restaurants sans `cuisine` dont le nom dit brunch ou lunch (De Brunch Club, Lunchroom Fröbel, Broodje Aap Lunchroom). Pour eux, `add` à la main, ou corriger le tag dans OSM : le prochain import le prendra.

### Proposition

1. **Requête** (`overpassQuery`, `lib/osm.ts`) : ajouter `nwr["amenity"="restaurant"]["cuisine"~"(^|;) *(breakfast|brunch|coffee_shop) *(;|$)"](bbox);`, et `pancake|lunch|lunchroom` dans l'alternative si Jérôme retient la variante.
2. **Catégorie `CAFE`**, pas de nouvelle valeur d'enum : pas de migration, même règle de visibilité, mêmes quatre points de vérification. `kindOf()` renvoie `cafe` pour ces restaurants. `mapOsmTags()` pose `hasCafe` d'après ce même genre, pour que le contrôle café/`hasCafe` de `backfill:osm-tags` reste à 0 écart.
3. **Visibilité inchangée** : ils entrent masqués, comme candidats à vérifier. La carte reste à 1026 lieux.
4. **Doublons** : un lieu déjà ajouté avec `add` a le même `osmId`, le seeder le saute.
5. **Avant le vrai run**, ajouter `DRY_RUN=1` au seeder (il n'en a pas) et relire la liste.
6. **Charge** : environ une heure avec les tests. Puis `pnpm seed:osm` et `pnpm backfill:osm-tags` (simulation, puis réel).

**Recommandation** : le filtre strict (10 lieux), plus `add` pour les manques ponctuels. Ajouter les pannenkoekenhuizen est une décision produit pour Jérôme ; ils sont souvent pensés pour les familles.
