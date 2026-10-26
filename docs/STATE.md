# TinyHike — état des lieux

**Date : 23 octobre 2026**

> **Mise à jour du 26 octobre 2026.** Le lot du 23 oct. a été commité le 26 oct., avec ce fichier, en commits séparés (API et migration, web, tests, docs). Les mentions « déployé, non commité » ci-dessous décrivent l'état du 23 oct. Le même jour, les deux processus de dev oubliés (le `tsx watch` de l'API et le Vite sur `0.0.0.0:5173`) ont été arrêtés, et `/api/health` répond toujours. Le reste du document n'a pas été remis à jour.

> **Mise à jour du 26 octobre 2026, suite.** Les cafés non vérifiés sont masqués (catégorie de lieu et vérification par un admin, voir `docs/plan-cafes-non-verifies.md`). 1027 lieux sont publics et 291 masqués. Le compte unique est passé ADMIN. Les âges et les types de jeux des aires de jeux sont importés depuis OSM. 563 tests passent. Les cases cochées « (fait le 26/10) » du §8 ont été reportées dans `CLAUDE.md` et `ROADMAP.md` ; les autres restent à faire.

Ce fichier est un instantané unique et sourcé du projet. Il doit servir de base pour harmoniser `README.md`, `CLAUDE.md`, `ROADMAP.md`, `DESIGN.md`, `DEPLOY.md` et `MEMORY.md`. Il décrit **l'arbre de travail**, pas seulement le dernier commit. Le lot du 23 octobre (avis avec compte, staging photo privé et modération, UX/a11y web) est **en production mais pas commité**. `git status` compte 33 fichiers modifiés et 22 non suivis. `HEAD` = `origin/main` = `c173764` (14 sept.). Les éléments de ce lot portent la mention **« déployé, non commité »**. Chaque fait cite sa source : un fichier avec sa ligne, une commande ou un hash de commit. Les chiffres de base de données viennent de `SELECT` agrégés lancés le 23 oct. Ce qui n'a pas pu être vérifié est marqué **non vérifié**.

Preuves du déploiement du lot :
- `api/dist` reconstruit et service `tinyhike-api` redémarré le 23/10 à 14:14:50 (`systemctl show tinyhike-api`) ;
- `web/dist` reconstruit le 23/10 à 14:15:20 ;
- migration `20261023120000_photo_staging_and_review_dedupe` appliquée le 23/10 à 14:14:39 (`_prisma_migrations`) ;
- le bundle servi `index-DzC_1elG.js` contient « Oordeel van ouders ».

---

## 1. Positionnement et cible (tels qu'ils apparaissent dans le code, le README et l'UI)

| Source | Formulation exacte | Cible / périmètre |
|---|---|---|
| `README.md:3` (inchangé depuis `7f3c862`, 1er juin) | « Mobility and discovery layer for parents with strollers — find stroller-friendly places and routes, starting in Rotterdam. » | parents avec poussette ; lieux **et itinéraires** |
| `CLAUDE.md` « Quick context » | « TinyHike is a **mobility + discovery layer for parents with strollers**. Closest analogy: AllTrails × Google Maps Local × stroller accessibility layer. Launch city: **Rotterdam**. » / « Focused utility, not a parenting social network. » / « "Can I comfortably go there with a stroller and a baby?" » | parents avec poussette, Rotterdam |
| `ROADMAP.md:11-21`, pitch « recentered 14 Sep 2026, Jerome's words » | « A **family, cooperative app/website** about the best places to walk with a baby or child in Rotterdam. » Lieux « rated and commented », « walks matching needs », parents qui « add places or request corrections » et « share the walks they actually do (Strava-like) » | familles, bébé **ou enfant**, coopératif |
| `DESIGN.md:9-13` | « **Bright toy-box.** … Target user: a parent pushing a stroller, one-handed, outdoors, in daylight. » | parent avec poussette, en extérieur |
| `marketing/index.html:6-7,37-38` (EN, langue par défaut) | title « TinyHike — Walk with the stroller, stress-free. » ; hero « TinyHike is the map for parents with a pushchair. Find family-friendly spots, flat routes and handy stops in Rotterdam and beyond. » | « Rotterdam **and beyond** » |
| `marketing/index.html:82-95` (NL) | « Wandelen met de buggy, zonder stress. » (« Se balader en poussette, sans stress ») ; « TinyHike is de kaart voor ouders met een kinderwagen… in Rotterdam en omgeving. » (« …la carte des parents avec poussette… à Rotterdam et environs ») | « Rotterdam **en omgeving** » |
| `web/index.html:2,7,11` | `lang="nl"`, meta en anglais « Stroller-friendly walks and places for families in Rotterdam. », `<title>TinyHike</title>` sans tagline | familles, Rotterdam |
| `web/public/manifest.json:4` | « Stroller-friendly walks & places for families » | familles, aucune ville, anglais seul |
| `api/src/jobs/enrich.ts:66-73` (prompt Claude) | « You are enriching a family-friendly, stroller-accessible places database. » ; « a 1-sentence practical tip for a parent pushing a stroller » | — |
| UI, `web/src/lib/i18n.tsx` | **Aucune tagline ni texte « à propos »**. Le cadrage passe par le vocabulaire : « Oordeel van ouders » (« Note des parents », l.96/254/402), « Een ouder » (« Un parent », l.101/259/407), groupes « Voor de baby / Met de kinderwagen / Ter plaatse » (« Pour bébé / Accès poussette / Sur place ») | parents, bébé, poussette |
| Carte, `web/src/pages/MapPage.tsx:62-64` ; `web/src/lib/locale.ts:9` | style `outdoors-v12`, centre `[4.48, 51.92]`, zoom 13 ; `DEFAULT_LOCALE = 'nl' // launch city is Rotterdam` | Rotterdam |

**Divergences de cadrage :**
- **Parents avec poussette ou familles.** README, CLAUDE.md, DESIGN.md et le site marketing disent « parents with strollers / pushchair ». La meta et le manifeste de la PWA disent « for families ». Le pitch du 14 sept. dit « baby or child ».
- **Utilitaire ou coopératif.** CLAUDE.md insiste sur « Focused utility ». Le pitch ROADMAP met en avant le « cooperative » : avis, ajouts, balades partagées.
- **Lieux ou itinéraires.** README (« places and routes »), le site marketing (« flat routes », « Stroller-proof routes ») et le manifeste (« walks ») promettent des itinéraires. Or `ROADMAP.md:27` dit « Route generation: **Not in the MVP** », et la base contient 0 `Route`.
- **Parcs ou cafés.** CLAUDE.md « Known mismatch » parle encore de tags « for parks/playgrounds ». Le schéma a déjà 19 tags, intérieur compris (`c173764`), et la base compte 276 cafés. Les **descriptions** penchent dans l'autre sens : les 381 lieux enrichis (les seuls décrits) comptent 262 `hasCafe` et 11 `hasPlayground`. 848 des 859 aires de jeux n'ont aucune description, et les lieux non enrichis portent des noms nl génériques : 787 « Speeltuin », 59 « Park », 13 « Picknickplek » (SQL, `GROUP BY` sur le nom nl). Le jeu de données et le pitch tournent autour des aires de jeux, mais le texte de l'app décrit surtout des cafés.
- **Rotterdam seul ou au-delà.** Le site marketing dit « and beyond / en omgeving ». La PWA et ROADMAP disent « in Rotterdam ». CLAUDE.md classe le multi-villes en non-objectif. Les données couvrent une seule bbox (`api/src/lib/osm.ts:19-20`).
- **Vocabulaire.** Le site marketing NL mélange « buggy » et « kinderwagen », l'app dit toujours « kinderwagen ». En EN, il mélange « stroller » et « pushchair », l'app dit « stroller ».
- **Pitch du 14 sept. non répercuté.** Ni le README ni `marketing/` n'ont été touchés depuis le scaffold `7f3c862`.

---

## 2. Stack, architecture, déploiement (Hetzner)

### 2.1 Serveur (vérifié en direct, lecture seule)

| Élément | Constaté | Source |
|---|---|---|
| Machine | Hetzner CPX22 : 2 vCPU, 3,7 Gi de RAM, swap de 2 Go, disque de 75 Go (27 % utilisés) | `nproc`, `free`, `swapon`, `df` |
| OS | Ubuntu 26.04 LTS | `/etc/os-release` |
| Noyau | **7.0.0-15** en cours d'exécution, **7.0.0-38** installé, `reboot-required` présent. Le reboot ne concerne pas que le noyau : `reboot-required.pkgs` liste aussi **`libc6`** et `linux-base`, plus `linux-image` de 7.0.0-22 à -38 | `uname -r`, `ls /boot`, `/var/run/reboot-required.pkgs` |
| Sécurité | UFW : 22, 80 et 443 seulement. fail2ban : jail `sshd`. `PermitRootLogin no`, `PasswordAuthentication no` | `ufw status`, `fail2ban-client`, `sshd_config` |
| Services | `tinyhike-api`, `nginx` et `postgresql` sont actifs et activés | `systemctl` |
| Docker | **non installé** | `ls /usr/bin/docker`, `id tinyhike` |
| Crons | aucun : crontabs de tinyhike et root vides, aucun timer, aucun dump Postgres | `crontab -l`, `systemctl list-timers` |
| Ports | `127.0.0.1:5432` (Postgres) ; **`0.0.0.0:3000`** (API, `api/src/index.ts` `host: '0.0.0.0'`, protégée seulement par UFW) ; **`0.0.0.0:5173`, un Vite de dev qui tourne depuis le 20 juillet** et proxifie `/api` vers l'API et la base de prod ; 80/443 (nginx) | `ss -ltnp` |
| Processus de dev oubliés | En plus du Vite ci-dessus, un **`pnpm dev` de l'API** tourne depuis le **12 juin** dans la session tmux `tinyhike` (PID 195154 → `tsx watch src/index.ts`, PID 195167). Il n'a plus d'enfant serveur et n'écoute sur rien (`:3000` appartient au service systemd, PID 1981902), mais il **surveille toujours `api/src`**. Chaque sauvegarde le relance contre `:3000`. Si elle tombe pendant un redémarrage du service (un `systemctl restart`, ou les 3 s de `RestartSec` après un crash), le process de dev peut prendre le port de prod. Le workflow de CLAUDE.md (`cd api && pnpm dev # API on :3000`) reproduit exactement cette situation | `tmux ls`, `ps -eo pid,lstart,cmd --forest`, `ss -ltnp`, `systemctl show tinyhike-api` |
| Configs | `/etc/nginx/sites-available/tinyhike`, les snippets Cloudflare et l'unité systemd sont **identiques** à `ops/`. Le seul site activé est `tinyhike` | `diff` |
| Certificat | Cloudflare Origin CA, SAN `*.tinyhike.com` + `tinyhike.com`, expire le 10 sept. 2041 | `openssl x509` |

### 2.2 Stack applicative

| Couche | Composants (version installée) | Source |
|---|---|---|
| Runtime | Node 22.22.2, pnpm 11.5.2 | `node -v`, `pnpm -v` |
| API | Fastify 5.8.5 ; @fastify/cookie 10.0.1, cors 10.1.0, helmet 13.0.2, multipart 9.4.0, rate-limit 11.0.0 ; Prisma 6.19.3 ; jose 5.10.0 ; zod 3.25.76 ; resend 4.8.0 ; @aws-sdk/client-s3 3.1061.0 ; @anthropic-ai/sdk 0.39.0 ; **sharp 0.35.5 (déployé, non commité)** ; ESM, TS strict | `api/package.json`, `node_modules` |
| Tests | Vitest 4.1.10, TypeScript 5.9.3, tsx 4.22.4. **395 tests dans 11 fichiers** (admin 35, auth 88, client-key 7, lists 8, osm 23, photo-moderation 50, photos 58, places 45, r2 31, reviews 48, tags 2). Suite relancée le 23/10 à 14:13, juste avant la migration : **395/395 verts**, `tsc --noEmit` propre sur api et web. Aucun test ne touche la base ni le réseau | `api/package.json` ; `pnpm test` (23/10, 14:13:54) ; comptage AST concordant |
| Web | React 18.3.1 ; react-router-dom 6.30.4 ; TanStack Query 5.101.0 ; mapbox-gl 3.24.0 ; Vite 5.4.21 ; vite-plugin-pwa 0.20.5 ; **aucune bibliothèque UI ni i18n** | `web/package.json` |
| Base | PostgreSQL 16.14 + PostGIS 3.6.3 (plus `postgis_topology`, inutilisé), en natif | `psql --version`, `pg_extension` |
| Proxy | nginx 1.28.3 | `nginx -v` |
| IA | `claude-sonnet-4-6`, uniquement pour l'enrichissement | `api/src/jobs/enrich.ts:80` |

Toutes les versions majeures annoncées par CLAUDE.md sont conformes. Le code ne contient aucun `any` (grep sur `api/src` et `web/src`).

### 2.3 Flux de requête

```text
Navigateur ──HTTPS──► Cloudflare (proxy, SSL Full strict, Bot Fight Mode)
                         │
                         ▼
             nginx 1.28.3 :443 (certificat Origin CF)
             ├─ realip : $remote_addr = CF-Connecting-IP
             ├─ geo $realip_remote_addr : 403 si la requête ne vient pas de Cloudflare
             │    (127.0.0.1 et ::1 autorisés pour les smoke tests)
             ├─ app.tinyhike.com : sert web/dist (SPA fallback) ; /api/ → 127.0.0.1:3000
             ├─ api.tinyhike.com : tout → 127.0.0.1:3000
             ├─ tout autre hôte (apex, www) : PAS de bloc → 1er bloc 443 = la PWA
             └─ :80 → 301 vers https://$host pour TOUT hôte (seul bloc sur le port 80,
                  donc bloc par défaut : apex et www compris) ; pas de garde 403 CF sur :80
                         │
                         ▼
             Fastify 5 (systemd tinyhike-api, node dist/index.js, trustProxy)
             helmet → rate-limit (200/min, mémoire) → CORS (PUBLIC_BASE_URL) → cookie → multipart
             ├─ PostgreSQL 16 + PostGIS via Prisma (127.0.0.1:5432)
             ├─ Cloudflare R2 : bucket public tinyhike-photos (photos.tinyhike.com)
             │                  + bucket de staging privé (pas encore créé → uploads OFF)
             ├─ Resend (e-mail du magic link)
             └─ jobs CLI : Overpass/OSM, Anthropic (enrichissement), photos:moderate
Navigateur ──PUT présigné──► R2 staging (directement, sans passer par l'API)
Navigateur ──► api.mapbox.com (style outdoors-v12 + tuiles, token restreint par domaine)
```

Sources : `ops/nginx/tinyhike.conf` (`server_name` aux l.25, 91 et 115 ; garde `if ($cf_edge = 0) { return 403; }` seulement dans les deux blocs 443, l.36 et l.97 ; bloc :80 l.112-117), `ops/nginx/cloudflare-geo.conf:27-28`, `api/src/app.ts:51-94`, `api/src/lib/r2.ts`.

Vérifié en direct :
- `/api/health` → `{"ok":true}` ;
- `/api/photos/config` → `{"enabled":false}` ;
- accès direct par l'IP publique → 403 ;
- `https://tinyhike.com/` et `www` → **200 avec la PWA**, même bundle `index-DzC_1elG.js` ;
- `curl -H 'Host: tinyhike.com' http://127.0.0.1/` (et `www`) → 301 vers `https://<même hôte>/`.

### 2.4 Authentification (résumé)

1. `POST /api/auth/magic` reçoit `{email, next?}`. `next` doit passer l'allowlist `^/(places/<id>|profile|lists)?$`. Le lien est valable **15 min** (`api/src/routes/auth.ts:9`) et construit sur `PUBLIC_BASE_URL`. Si Resend échoue, la route répond 502.
2. `GET /verify` émet un JWT HS256 valable **30 jours** dans le cookie **`__Host-session`** (déployé, non commité), puis redirige en 302 vers `next`.
3. Trois gardes : `requireAuth`, `optionalAuth` et `requireAdmin`. Le rôle est lu **dans le JWT**, pas en base. Il est écrit dans le jeton à la connexion (`api/src/routes/auth.ts:171`, `signSession({ sub, role: magic.user.role })`), relu par `verifySession` (`api/src/plugins/auth.ts:20-23`) et testé par `requireAdmin` (`req.session?.role !== 'ADMIN'`, `api/src/plugins/auth.ts:67-74`).
4. Côté web, une seule porte de session : `useMe()` (`web/src/lib/session.ts`).

### 2.5 Modèle de données

- **14 modèles** (`api/prisma/schema.prisma`) : User, MagicToken, Place, PlaceTranslation, Route, RouteTranslation, Track, Photo, Review, List, ListTranslation, ListPlace, ListCollaborator, Follow. La base contient en plus `_prisma_migrations` et `spatial_ref_sys`.
- **Enums** : `Role` (MEMBER, STEWARD, ADMIN), `PlaceStatus` (PENDING, APPROVED, REJECTED), `PlaceSource` (USER, OSM, CLAUDE ; **CLAUDE est vestigial**, 0 ligne : dit dans le message de `7050902` et dans `ROADMAP.md:146`, aucun commentaire dans `schema.prisma:111-115`), `PhotoStatus`, `Visibility`.
- **Place** : `lat`/`lng`, `osmId` unique, `enrichedAt`, et **19 booléens tri-état** (`schema.prisma:66-91`) : 11 d'origine plus 8 ajoutés le 14 sept. Format de `osmId` : 1309 lignes en `osm:<type>/<id>` (`45adcd2`), **9 lignes legacy en `osm:<id>`**, toutes créées le 13/06. `1823ae7` n'en a migré que 372 sur 381. ROADMAP les suit comme dette (`ROADMAP.md:148`, « 9 legacy places whose OSM element no longer matches the query »).
- **Review** : `score` optionnel, `tagsConfirmed[]`, `tagsDisputed[]`, `comment`, `anonymous`, `userId?`. Un index unique partiel `Review_one_written_per_user_per_place` vit uniquement en SQL (déployé, non commité).
- **Photo** : `r2Key` unique, `r2Url` nullable (déployé, non commité).
- **Migrations** (5 au total ; `prisma migrate status` : à jour) : `20260605080944_init`, `20260719162054_add_place_enriched_at`, `20260914120000_add_indoor_baby_tags`, `20260914120500_make_review_score_optional`, `20261023120000_photo_staging_and_review_dedupe` (dossier non suivi par git, appliqué en prod).
- **PostGIS** (`ops/scripts/postgis_setup.sql`, `pg_trigger`) :
  - `Place.geom` : trigger `trg_place_geom` et index GIST.
  - `Route.geom` : colonne et index GIST, **mais aucun trigger** (Route n'a pas de lat/lng).
  - **Aucun code n'interroge `geom`** (grep `queryRaw|ST_` vide). `GET /api/places` filtre par deux clauses Prisma `gte`/`lte` sur `lat` et `lng` (`api/src/routes/places.ts:246-247` ; les l.243-244 valident la bbox et renvoient 400).

### 2.6 Données en production (agrégats, 23 oct.)

| Table | Lignes | Détail |
|---|---|---|
| Place | **1318** | toutes `APPROVED` et `source=OSM`. 381 créées le 13/06, 937 le 14/09. **381 enrichies par Claude le 13/06** (`f06eec4` : « enriched all 381 … 1143 translations … 0 failures » ; `MEMORY.md:13`). Leur `enrichedAt` commun (19/07 18:21:37) vient du **backfill** de `7050902`, pas d'un run. 937 non enrichies. Parmi les 381 enrichies : 262 `hasCafe`, 11 `hasPlayground`. Total : `hasPlayground` 859, `hasCafe` 276. Étendue : lat 51,800–51,950, lng 4,400–4,612 |
| PlaceTranslation | **3798** | nl 1318, fr 1240, en 1240. **1143 avec description** (381 × 3). 859 lieux n'ont qu'un nom générique en 3 langues, 78 n'ont qu'un nom nl |
| User | **1** | rôle MEMBER, **0 ADMIN**, 0 handle |
| Review | 1 | vote de tags seul, anonyme : 0 note, 0 commentaire |
| Photo, List, ListPlace, ListTranslation, ListCollaborator, Route, RouteTranslation, Track, Follow | 0 | — |
| MagicToken | 2 | — |

**Bascule PENDING → APPROVED des 381 lieux de juin : non documentée.** `MEMORY.md:24` les note « all `status=PENDING` » le 13 juin. `6b9f0a7` (18 juil.) ne change que les futurs `seed:osm` (`seed-osm.ts:72`). L'adoption legacy (`seed-osm.ts:56-64`) ne met à jour que `osmId`. Aucun commit ne contient d'`UPDATE` de statut (`git log -S`). La base compte aujourd'hui 1318 APPROVED : la bascule a donc été faite à la main en base, sans trace.

Conséquence visible : sur la bbox initiale, la carte demande `limit=500` et l'API répond `X-Total-Count: 1317`, `X-Result-Truncated: true`. Tant que l'utilisateur ne bouge pas la carte, il voit 500 lieux sur 1317 et le bandeau « zoom in » (`web/src/pages/MapPage.tsx:37,50`).

### 2.7 Services externes

| Service | Rôle | État | Source |
|---|---|---|---|
| Cloudflare | DNS proxifié (apex, app, api, photos, www), WAF/Bot Fight, Origin CA, Email Routing, redirection 301 de `tinyhike.app` | actif ; 403 hors edge vérifié | `dig`, curl, nginx |
| Cloudflare R2 | bucket public `tinyhike-photos` (`photos.tinyhike.com`) + staging privé | **staging pas encore créé : uploads OFF** | `/api/photos/config`, `DEPLOY.md` §3c |
| Resend | e-mail du magic link (domaine `tinyhike.com` ; MX `send.`, DKIM `resend._domainkey`) | vérifié en prod le 14/09 selon `98bf333` et `0d5ca76` ; **non retesté ici** | CLAUDE.md, `dig` |
| Mapbox | style `outdoors-v12` + tuiles ; token restreint à `tinyhike.com`, `app.tinyhike.com` et `localhost:5173` | actif | `MapPage.tsx:62` ; CLAUDE.md pitfall 7 |
| Anthropic | enrichissement nl/fr/en | seule exécution : le 13/06 (381 lieux, `f06eec4`, `MEMORY.md:13`). `enrichedAt` = 19/07 vient du backfill de `7050902`. Aucune exécution depuis ; 937 en attente du feu vert de Jerome | `enrich.ts`, SQL, `git log` |
| OSM Overpass | seed + backfill des tags | dernier seed le 14/09 (937 lieux) | `api/src/lib/osm.ts`, SQL |
| GitHub | `Tinyhike/tinyhike`, public, MIT | l'agent ne peut pas pousser : Jerome pousse avec un PAT | `git remote`, MEMORY de session |
| Hostinger (n8n/OpenClaw) | crons prévus : 02:00 diff OSM, 02:30 enrichissement, 03:00 modération, 06:30 digest Telegram | **non branchés** | CLAUDE.md, `DEPLOY.md` §5 |

### 2.8 Recette de déploiement (`DEPLOY.md:143-163`)

Décisions verrouillées le 9 sept. (`DEPLOY.md:6-10`) : **option A, natif + systemd + nginx**, TLS par certificat Cloudflare Origin. En production depuis le 14 sept.

1. `cd api && pnpm test`
2. Seulement si `prisma/migrations` a changé : `pnpm db:migrate` (= `prisma migrate deploy`), puis `pnpm db:generate`. **Jamais `migrate dev` ici** (`DEPLOY.md:146-147`, qui renvoie à la pitfall 22 ; celle-ci n'interdit que le reset, voir 7.1).
3. `pnpm build && sudo systemctl restart tinyhike-api`
4. `cd web && pnpm build`. nginx sert `dist/` directement, sans reload.
5. IP Cloudflare : `ops/scripts/update-cloudflare-ips.sh`, puis copier `ops/nginx/cloudflare-*.conf` dans `/etc/nginx/snippets/`, puis `nginx -t && reload`.

L'unité systemd (`ops/systemd/tinyhike-api.service`) tourne en `User=tinyhike` avec `Restart=always` et `NODE_ENV=production`. Elle n'a **pas d'`EnvironmentFile`** : dotenv lit `api/.env`, un lien vers `../.env`. Durcissement : `NoNewPrivileges`, `ProtectSystem=full`, `ProtectHome=read-only`, `PrivateTmp`.

### 2.9 Configuré mais inutilisé

- **Docker / Traefik** : `ops/docker-compose.yml` (épingle postgis 16-3.4, attend `DB_PASSWORD` et `COOKIE_SECRET`, absents de `.env.example`), `ops/traefik/traefik.yml`, les Dockerfiles de `api/`, `web/` et `marketing/`, `web/nginx.conf`. Les Dockerfiles api et web font `npm ci` sans `package-lock.json` : **ils échoueraient tels quels**. Docker n'est pas installé.
- **`ops/scripts/provision.sh`** installe Docker et crée le réseau `tinyhike_net` (l.23-29, 52-53). Il n'installe ni Node, ni Postgres, ni nginx. Il ne reflète pas le serveur réel.
- **`@fastify/multipart`** est enregistré (`api/src/app.ts:74`) mais aucune route ne lit de multipart.
- **Index GIST, `Route.geom`, extension `postgis_topology`** : jamais lus.
- **Variables d'env non lues par le code** : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_USER_ID`, `API_BASE_URL` (seulement en commentaire, `auth.ts:111`), `ACME_EMAIL` (Traefik), `MAPBOX_PUBLIC_TOKEN` (docker-compose ; le web lit `VITE_MAPBOX_TOKEN`).
- **Modèles sans code** : Follow et ListCollaborator (aucun appel `prisma.follow` ni `prisma.listCollaborator` dans `api/src`). Route a des endpoints de lecture (`routes.ts:13,27`, `photos.ts:234`) mais aucun chemin de création. Track a un endpoint d'écriture (`POST /track`, `routes.ts:46`) mais aucune UI. Les quatre tables sont vides.
- **`marketing/index.html`** n'est servi nulle part.

---

## 3. Fonctionnalités

### 3.1 En production

| Fonctionnalité | État | Source |
|---|---|---|
| Carte de Rotterdam : clusters, géolocalisation, bandeau de troncature (`limit=500`) | en ligne | `MapPage.tsx` ; `09f545d`, `d55b9c1` |
| Shell à 3 onglets (nl : Kaart / Lijsten / Profiel) et fiche lieu en panneau au-dessus de la carte | en ligne. Piège à focus et cibles de 44 px : déployé, non commité | `AppLayout.tsx`, `PlaceSheet.tsx` ; `6343198` |
| Interface nl/fr/en avec sélecteur dans Profil | en ligne. Pluriels, décimales et dates relatives : déployé, non commité | `i18n.tsx`, `locale.ts` ; `0e917f4` |
| Équipements : 19 tags tri-état en 3 groupes, vote oui/non en un tap **sans compte** | en ligne. Validation contre `TAG_KEYS` : déployé, non commité | `PlaceAmenities.tsx`, `api/src/lib/tags.ts` ; `c173764` |
| Notes et commentaires **avec compte** : un avis par parent et par lieu, édition, pagination, affichage anonyme « Een ouder / Un parent » | **déployé, non commité** | `places.ts:401-457`, `PlaceReviews.tsx`, migration `20261023120000` |
| Connexion par magic link | vérifiée le 14/09 (`d3b5a1c`, `98bf333`). Retour `next` et cookie `__Host-session` : déployé, non commité | `auth.ts`, `plugins/auth.ts` |
| Profil : e-mail, rôle brut, déconnexion, langue | en ligne | `ProfilePage.tsx` |
| Onglet Listes | en ligne, **lecture seule**, toujours vide (0 liste) | `ListsPage.tsx:18` |
| PWA installable depuis le navigateur | en ligne. Le cache hors ligne ne couvre que le shell et les styles Mapbox. Le shell n'est en précache que de justesse : le bundle `index-DzC_1elG.js` pèse 2 073 066 octets, ~24 Ko sous la limite Workbox par défaut (`maximumFileSizeToCacheInBytes` = 2 MiB = 2 097 152), que `web/vite.config.ts` ne relève pas. Il est listé dans `web/dist/sw.js` aujourd'hui. Un build un peu plus gros sortirait du précache avec un simple avertissement de build, et le shell ne marcherait plus hors ligne | `web/vite.config.ts:12-29` ; `ls -l web/dist/assets` |
| Modération des photos en CLI (`pnpm photos:moderate`) | déployé, non commité. Elle fonctionne mais il n'y a aucune photo | `api/src/jobs/moderate-photos.ts` |
| Jobs `seed:osm`, `backfill:osm-tags`, `enrich:pending` | lancés à la main, aucun cron | `api/package.json` |

### 3.2 Construit mais pas encore actif, ou en cours

| Fonctionnalité | État | Source |
|---|---|---|
| Envoi de photos (UI + API, staging privé, ré-encodage sharp à l'approbation) | **construit, OFF** : `GET /api/photos/config` → `{"enabled":false}`, bouton masqué. Attend `R2_STAGING_BUCKET` et la check-list Cloudflare de Jerome | `PhotoUpload.tsx:267`, `r2.ts:151-161`, `DEPLOY.md` §3c |
| Routes admin (stats, modération des lieux et des photos, seed) | API seulement, **aucun compte ADMIN en base** : inutilisables en l'état | `api/src/routes/admin.ts` ; SQL |
| Proposer un lieu (`POST /api/places` → PENDING) | backend seulement, aucune UI. Aucune route ne liste les lieux PENDING | `places.ts:380` ; ROADMAP Phase A étape 4 |
| Listes : création, ajout de lieu, détail, « mes listes » | API seulement. `/lists/:slug` rend le même index | `lists.ts` ; `web/src/App.tsx:19-20` (`/lists` et `/lists/:slug` rendent tous deux `<ListsPage />`) |
| Balades / traces | `GET /api/routes` (le `bbox` est ignoré), `GET /:id`, `POST /track`. Aucune création de Route, aucune UI | `api/src/routes/routes.ts:10-37` |
| Avis signés / handle | lecture de `User.handle` prête, mais rien ne l'écrit | `places.ts:66-69` ; ROADMAP décision ouverte 6 |
| Interface de modération admin (Phase A étape 5) | à construire | `ROADMAP.md` Phase A |
| Auto-modération par Claude vision (Phase A étape 6) | **aucun code** (Anthropic n'est utilisé que dans `enrich.ts`) | grep `anthropic` |
| Enrichissement des 937 lieux sans description | attend le feu vert de Jerome | `ROADMAP.md:132` |
| Des votes de tags vers les booléens `Place` | aucune agrégation codée : un vote ne change rien pour les autres parents | `PlaceAmenities.tsx:17-20` |
| Commit du lot du 23 oct. | à faire. GitHub ne reflète pas la prod | `git status` |

### 3.3 Prévu, pas commencé

| Élément | Source |
|---|---|
| Phase B : balades partagées (traces), génération d'itinéraires reportée (moteur à choisir) | `ROADMAP.md:27`, Phase B |
| Phase C : listes publiques, suivre des contributeurs, sans messagerie | `ROADMAP.md:26`, Phase C |
| Crons Hostinger : diff OSM, enrichissement, modération, digest Telegram | CLAUDE.md « Hostinger VPS » ; ROADMAP « Continuous » |
| CI `pnpm test` sur push ; dump Postgres planifié | ROADMAP « Continuous » |
| « Stroller score », icônes de fiche, logo avec poussette, landing animée | `DESIGN.md:164-189` |
| Déploiement de `marketing/` (apex/www), métadonnées OG et favicon | ROADMAP « Known debt » ; `DESIGN.md:173-174` |
| Dette : carte plus légère (~340 KB par déplacement), reboot noyau, enum `CLAUDE`, test d'expiration du JWT, **9 lieux legacy dont l'élément OSM ne correspond plus à la requête** (job de réconciliation « someday », `ROADMAP.md:148`), purge de cache automatisée, domaine séparé pour le contenu utilisateur | ROADMAP « Known debt » (`ROADMAP.md:139-155`) |

**Non-objectifs** (CLAUDE.md « Non-goals ») : temps réel, notifications push (un digest par cron reste OK), multi-villes avant le mois 3, apps natives, GPS avancé, pub et monétisation complexe (Ko-fi seulement), tuiles auto-hébergées, fédération. ROADMAP ajoute : pas de messagerie ni de profils sociaux.

---

## 4. Textes marketing et chiffres affichés

### 4.1 Site marketing (`marketing/index.html`, inchangé depuis `7f3c862`, **non servi**)

| Texte EN (NL) | Lignes | Constat |
|---|---|---|
| « Walk with the stroller, stress-free. » | 7, 37 | — |
| NL `<title>` : « TinyHike — Wandel met de buggy, zonder stress. » (impératif « Wandel » : « Promène-toi en poussette… ») | 84 | ne concorde pas avec le hero NL (l.88) |
| NL hero : « Wandelen met de buggy, zonder stress. » (« Se balader en poussette, sans stress ») | 88 | — |
| NL meta : « kinderwagen-vriendelijke wandelingen en familieplekken in Rotterdam en omgeving » (« balades adaptées aux poussettes et lieux pour familles à Rotterdam et environs ») | 85 | promet des « wandelingen » (balades) |
| « TinyHike is the map for parents with a pushchair… flat routes and handy stops in Rotterdam and beyond. » | 38, 89 | « flat routes » : pas de routes ; « and beyond » : une seule bbox |
| « Get started free » (« Start gratis ») | 39, 90 | cohérent : aucun prix ni paywall ; aucun lien Ko-fi nulle part |
| « Places — Playgrounds, parks, family cafés — all verified by parents. » (« …allemaal gecontroleerd door ouders ») | 44, 91 | **faux** : 1318 lieux OSM auto-approuvés (`6b9f0a7`), 1 seule contribution (vote de tags anonyme) |
| « Routes — Stroller-proof routes with surface and elevation info. » (« …met hoogteprofiel en oppervlakte-info ») | 48, 92 | **inexistant** : 0 Route, aucun champ d'élévation (`schema.prisma:131-157`), hors MVP |
| « Lists — Save your favourites and share them with other parents. » | 52, 93 | **pas d'UI** de création ; 0 liste |
| « Offline — Install the app and use maps even without internet. » | 56, 94 | **surévalué** : seuls le shell et les styles Mapbox sont en cache, ni les tuiles ni `/api/places` (analyse du code, **non testé en navigateur**). Le shell lui-même n'est en précache qu'à ~24 Ko de la limite Workbox de 2 MiB (voir 3.1) |
| Footer « Rotterdam & surroundings » (« omgeving ») ; « Open source · MIT · GitHub » ; lien mailto vers l'adresse `hello@` du domaine | 61-62 | MIT et GitHub : cohérents |
| Langue : `<html lang="en">`, `let current = 'en'`, bouton NL | 2, 99 | anglais par défaut, pas de FR |
| Palette : vert `#2d6a4f`, sable `#f4f1de`, `system-ui` | 10-11 | palette du scaffold, contraire à DESIGN.md |

### 4.2 Textes de la PWA

- `web/index.html:7` : meta « Stroller-friendly walks and places for families in Rotterdam. » (anglais sur une page `lang="nl"`).
- `web/public/manifest.json:4` : « Stroller-friendly walks & places for families ». Les « walks » n'existent pas dans l'UI.
- E-mail du magic link (`api/src/routes/auth.ts:129-133`) : sujet « Your TinyHike login link », corps « Click here to sign in — valid 15 min. » (anglais seul).
- UI, chiffres affichés (`web/src/lib/i18n.tsx`) :
  - « De link is 15 minuten geldig » (« Le lien est valable 15 minutes »), cohérent avec `MAGIC_TTL_MIN = 15` ;
  - « 30 seconden is genoeg » (« 30 secondes suffisent », l.109/267/415) ;
  - échelle de 1 à 5 étoiles ;
  - « Alle {n} voorzieningen tonen » (« Afficher les {n} équipements », au plus 19) ;
  - `map.truncated` : « {shown} van {total} plekken — zoom in om alles te zien » (« {shown} lieux sur {total} — zoome pour tout voir »).
- L'app n'affiche **aucun chiffre global** : ni nombre de lieux, ni villes, ni utilisateurs.
- La maquette `design/mockups/place-tags-mockup.html:103` dit « Vérifié par OSM et les parents · 7 infos à confirmer ». Le mot « Vérifié » n'a **pas** été repris dans l'UI (`i18n.tsx:222` : « {n} infos à confirmer »).

### 4.3 Chiffre annoncé et réalité (DB, 23 oct.)

| Chiffre annoncé | Où | Réalité | Verdict |
|---|---|---|---|
| « 381 POIs seeded from OSM and enriched by Claude » | `CLAUDE.md` « What works » | 1318 lieux, dont 381 enrichis | **périmé** |
| « 1143 translations » | `CLAUDE.md` ; `MEMORY.md:25` | 3798 traductions, dont 1143 avec description | **trompeur** |
| « 381 rows, all `source=OSM`→`CLAUDE`, all `status=PENDING` » | `MEMORY.md:24` (13 juin) | 1318, 0 `CLAUDE`, 0 PENDING, tous APPROVED | **périmé** |
| « 1318 places — 859 playgrounds (65%), 276 cafes (21%) » | `ROADMAP.md:78` | 1318 / 859 / 276 (les 183 restants, parcs et pique-nique, ne sont pas mentionnés) | **exact** |
| « hasPlayground 859, hasCafe 276, wheelchairOk 37y/7n, smooth 6y/46n, hasToilets 21 » | `ROADMAP.md:82-84` | identique. Non cités (oui / non) : `hasOutdoorSeating` 55 / 12, `dogFriendly` 1 / 10, `enclosed` 5 / 0, `freeEntry` 1 / 3, `hasChangingTable` 1 / 0, `hasHighchair` 1 / 0 | exact mais incomplet |
| « napFriendly / shaded / hasParking: still all null » | `ROADMAP.md:83` | **8 tags** sont null sur toutes les lignes, pas 3 : `napFriendly`, `shaded`, `hasParking`, `isBreastfeedingFriendly`, `isStrollerWide`, `hasElevator`, `hasPlayCorner`, `isQuiet` (`count(col)` = 0 pour chacun) | **incomplet** |
| « 381 original places have nl/fr/en descriptions » ; « 937 new places » à enrichir | `ROADMAP.md:90,132` | 381 ; 937 | **exact** |
| « 12 models alive » | `CLAUDE.md:25,123` | 14 modèles (la liste de la même phrase en compte 14) | **faux** |
| « `GET /api/places` caps at 200 results with no pagination » | `CLAUDE.md:65` ; `DEPLOY.md:331` | défaut 200, **max 500** (`places.ts:17-18`), en-têtes `X-Total-Count` et `X-Result-Truncated`, le web demande 500 ; toujours sans pagination | **périmé** |
| « 395 tests green in 11 files » | `CLAUDE.md:47` ; `ROADMAP.md:71` | 395 tests dans 11 fichiers, tous verts au run du 23/10 à 14:13 (`pnpm test`). Le comptage AST donne le même total (227 appels écrits avant expansion des `.each`) | **exact** |
| « 19 tags » | `ROADMAP.md:28` ; `schema.prisma:66` | 19 colonnes ; 19 clés `tag.*` × 3 langues | **exact** |
| « installed is `7.0.0-31-generic` » | `CLAUDE.md:61` ; `ROADMAP.md:143` ; `DEPLOY.md:36` | 7.0.0-38 installé | **périmé** |
| « ~8-week MVP timeline » | `CLAUDE.md` « Quick context » | premier commit le 1er juin (`7f3c862`), soit ~20 semaines au 23 oct. ; aucune date de lancement écrite | **dépassé** |
| « all verified by parents » | `marketing/index.html:44` | 1 Review, 0 avis écrit, 1 User | **faux** |
| « Rotterdam and beyond » | `marketing/index.html:38` | une bbox Rotterdam `51.8,4.4,51.95,4.6` (`osm.ts:20`). Le débordement sur les communes voisines n'a pas été géocodé (**non vérifié**) | **surévalué** |
| Photos « OFF in production » | `CLAUDE.md` | `{"enabled":false}`, 0 photo | **exact** |
| Utilisateurs / admins | aucune doc | 1 MEMBER, 0 ADMIN | à documenter |

---

## 5. Couleurs, typographies, composants UI

### 5.1 Design system : **réponse courte : identité maison, aucun design system externe branché**

- **Aucune bibliothèque UI** : ni Tailwind, ni MUI, ni shadcn, ni Radix, ni pack d'icônes, ni package de polices (`web/package.json:11-26`). Le CSS global est écrit à la main (`web/src/index.css`), avec des tokens dans `web/src/styles/tokens.css`.
- **Identité « bright toy-box »**, sur brief de Jerome (`0e917f4`, 14 sept. : « vivid, playful, the colours of a nursery… explicitly breaking the pastel/cream register »). Documentée dans `DESIGN.md`.
- `DESIGN.md:3` et `tokens.css:3-4` citent seulement des **cibles possibles de passation** (Claude Design `/design-sync`, Figma). Le dépôt ne contient aucun lien Figma, Canva ou design-sync.
- Observation, **non sourcée dans le repo** : 4 teintes (`#ef476f`, `#ffd166`, `#06d6a0`, `#073b4c`) sont identiques à une palette Coolors répandue. Le bleu diffère (`#21a9d8`).
- **Statut git** : `tokens.css`, `index.css` (+301 lignes) et `DESIGN.md` sont modifiés et non commités. `design/mockups/place-reviews-mockup.html` n'est pas suivi. Le CSS servi (`index-OBQpk-EC.css`) contient déjà les nouvelles valeurs : **déployé, non commité**.

### 5.2 Tokens (`web/src/styles/tokens.css`)

| Token | Hex / valeur | Usage réel |
|---|---|---|
| `--berry` | `#ef476f` | action principale, pins (en dur dans `MapPage.tsx:119`), onglet Carte, bouton fermer, champ invalide |
| `--berry-deep` | `#d81e5b` | fond de `.btn`, avatars |
| `--sun` | `#ffd166` | pastille de chargement, encadrés d'astuce, splash PWA (en dur dans `manifest.json`, `web/index.html:6` et `generate-icons.py:31`) |
| `--sun-deep` | `#a35f00` (était `#e08c00`, **déployé, non commité**) | étoiles, kicker « Note des parents » |
| `--mint` | `#06d6a0` | positif / confirmé, barre de progression |
| `--mint-deep` | `#037a5c` (était `#04936f`, **déployé, non commité**) | puces ✓, `.btn--mint`, « photo envoyée » |
| `--sky` | `#21a9d8` | anneaux de focus, onglet Profil, sélecteur de langue. **Pas les liens**, malgré le commentaire de `tokens.css:30` (« links, focus rings, "Profile" tab ») et `DESIGN.md:40` |
| `--sky-deep` | `#0b6e8f` | **liens** (`index.css:16`), `.btn--sky`, puces |
| `--grape` | `#9b5de5` | clusters (en dur dans `MapPage.tsx:93`), onglet Listes, bandeau d'alerte |
| `--grape-deep` | `#7b2cbf` | avatars seulement |
| `--ink` | `#073b4c` | texte courant |
| `--ink-soft` | `#4a6b78` | texte secondaire |
| `--surface` | `#ffffff` | fonds (absent de DESIGN.md) |
| `--surface-tint` | `#fff8ee` | fonds d'encadré |
| `--border` | `#e4ebee` | bordures de 2 px (absent de DESIGN.md) |
| `--danger-bg` / `--danger-fg` | `#ffe3ea` / `#b0123f` | états d'erreur, puces « non » (absents de DESIGN.md) |
| `--radius` / `--radius-lg` | 18px / 26px | cartes et champs / panneau |
| `--shadow-sheet` / `--shadow-pop` | ombre floue du panneau / ombre décalée plate | — |
| `--tabbar-h` / `--safe-b` | 60px / `env(safe-area-inset-bottom)` | mise en page |

**Couleurs en dur hors tokens** :
- dans `index.css` : `#e7f5fb` ×5, `#dff8ef` ×3, `#eef4f6`/`#dfeaee` (skeleton), `rgba(7,59,76,…)` (voile, popover) ;
- dans `MapPage.tsx:93,119` et `generate-icons.py:31-36` ;
- dans `manifest.json:7-8` et `web/index.html:6` ;
- dans les deux maquettes.

### 5.3 Typographie

- Une seule famille : `--font-ui` = `ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Segoe UI Variable', system-ui, sans-serif`. Elle n'est réellement arrondie que sur Apple (`DESIGN.md:59-63`).
- **Aucune webfont** : ni `<link>` de police ni `@font-face`. Adopter Nunito, Baloo 2 ou Fredoka relève du choix de Jerome (`DESIGN.md:65-67`).
- Carte : chiffres des clusters en `'DIN Offc Pro Medium', 'Arial Unicode MS Bold'` 14px, servis par Mapbox (`MapPage.tsx:107-108`).
- Site marketing : `system-ui, sans-serif`.
- Pas de token de taille : 15 tailles en px de 10,5 à 34. Champs à 16px (anti-zoom iOS). Graisses 800/700/600/500.

### 5.4 Forme, icônes

- Bordures de 2px partout. Pilules à 999px. **Aucun token d'espacement**.
- Le popover de vote utilise une ombre floue non tokenisée (`index.css:293`), alors que la doctrine dit « flat offset ».
- **Aucun pack d'icônes.** 4 SVG en ligne : 3 onglets (`AppLayout.tsx:21-27`) et le bouton fermer (`PlaceSheet.tsx:104-105`).
- **19 emoji pour les tags** (`web/src/lib/tags.ts:50-73`), choix assumé « for now ».
- Icônes PWA générées par `ops/scripts/generate-icons.py` : pin berry sur fond sun, en 192, 512, maskable 512 et favicon 32/48. **Logo provisoire** (`DESIGN.md:178-181`).

### 5.5 Composants (`web/src/index.css` → fichiers)

| Composant | Fichier |
|---|---|
| Coque et barre d'onglets (`.app-shell`, `.tabbar`, `.tab--active`) | `components/AppLayout.tsx` |
| Carte, pastilles (`.map-pill`, `--warn`), erreur | `pages/MapPage.tsx` |
| Panneau (`.sheet`, bande 4 couleurs, `.sheet-close`, `.sheet-tip`, `.photo-grid`) | `components/PlaceSheet.tsx` |
| Équipements (`.amen-*` : lignes tri-état, puces, popover de vote, toast) | `components/PlaceAmenities.tsx` |
| Note, avis, formulaire étoiles (`.rev-*`) — déployé, non commité | `components/PlaceReviews.tsx` |
| Envoi de photo (`.photo-*`) — non commité | `components/PhotoUpload.tsx` |
| Réessai de session (`.session-retry`, `.link-btn`) | `components/SessionRetry.tsx` |
| Bouton (`.btn`, `--mint`, `--sky`), champ (`.field`), cartes de liste (`.card`), page (`.page`), états (`.skeleton`, `.state--error`), sélecteur de langue (`.lang-btn`), `.sr-only` | pages et composants |

Aucune classe morte détectée.

### 5.6 Accessibilité : plancher (`DESIGN.md:190-207`) et écarts

Les contrastes de DESIGN.md ont été **recalculés** et sont exacts. Exemples : `-deep` sur blanc entre 4,93 et 7,11 ; `--sky` sur blanc 2,72.

Le plancher est appliqué :
- anneau de focus `3px solid var(--sky)` sur 17 sélecteurs, aucun `outline: none` **dans `index.css`** (la feuille de Mapbox en contient un, voir plus bas) ;
- `min-height: 44px` sur les boutons principaux ;
- `prefers-reduced-motion` respecté ;
- champs à 16px.

Écarts constatés dans le code :
- `.sheet-close` mesure **36×36 px** (`index.css:171-172`), sous le plancher de 44 px.
- `.lang-btn` (~37-38 px) et `.amen-more` (~43 px) n'ont pas de `min-height`. Tailles **estimées, non mesurées** en navigateur.
- Pins de carte ~22 px, sans accès clavier ni liste alternative.
- Contrôles Mapbox (`NavigationControl`, `GeolocateControl`, `MapPage.tsx:67-68`) : **32×32 px** (`.mapboxgl-ctrl-group button{…height:32px;outline:none;…width:32px}`, `web/node_modules/mapbox-gl/dist/mapbox-gl.css`, v3.24.0), sous le plancher de 44 px. Leur focus est l'ombre bleue de Mapbox (`#0096ff`), pas l'anneau `--sky` du projet.
- **Texte ou icône blancs sur teinte vive**, contraire à la règle « White text only on -deep » :
  - `.lang-btn[aria-pressed]` sur `--sky` : 2,72:1 ;
  - icône de l'onglet Profil actif, blanche sur `--sky` (`index.css:71,74`) : 2,72:1, sous le 3:1 de WCAG 1.4.11 ;
  - `.map-pill--warn` sur `--grape` : 4,13:1 ;
  - chiffres des clusters : ≤ 4,13:1.
- Anneau de focus `--sky` sur blanc à 2,72:1, sous le 3:1 de WCAG 1.4.11. Le commentaire de `index.css:594` juge lui-même cette couleur trop faible : **à trancher**.

---

## 6. Langues et i18n

**Langues réellement gérées : la PWA est en néerlandais, français et anglais (trois langues, pas seulement NL/EN).** `web/src/lib/locale.ts:6` : `LOCALES = ['nl','fr','en']`, néerlandais par défaut (l.9). Le site marketing ne gère que **EN (par défaut) et NL**. L'e-mail de connexion est en **anglais seulement**.

| Aspect | État | Source |
|---|---|---|
| Mécanique | maison, sans bibliothèque : trois objets plats `nl` / `fr` / `en`, `MessageKey = keyof typeof nl`. fr et en sont typés `Record<MessageKey,string>`, donc une clé manquante casse `tsc` au build | `web/src/lib/i18n.tsx:10-158,168,316` ; `0e917f4` |
| Couverture | **133 clés par langue**, identiques dans les 3 langues, toutes utilisées, aucune manquante. `HEAD` en avait 66 ; **+67 déployées, non commitées** (auth +4, err +4, photo +20, rev +36, session +3) | extraction des 3 blocs ; `git show HEAD:web/src/lib/i18n.tsx` |
| Détection | 1) `localStorage['tinyhike.locale']` ; 2) `navigator.languages` (code de langue seul : `fr-BE` → fr) ; 3) sinon `nl` | `locale.ts:30-48` |
| Persistance | `localStorage`, **par appareil**. Pas de locale sur `User`. `Accept-Language` jamais lu | `locale.ts:50-56` ; `schema.prisma` |
| Sélecteur | Profil, endonymes Nederlands / Français / English, visible connecté ou non | `ProfilePage.tsx:88-111` |
| `<html lang>` | `nl` dans le HTML, corrigé avant le premier rendu puis à chaque changement | `main.tsx:22`, `i18n.tsx:488` |
| Pluriels, nombres, dates | `tn()` + `Intl.PluralRules` (seulement `rev.count`, `rev.confirmed`, `rev.stars.label`), `Intl.NumberFormat` pour la moyenne, `Intl.RelativeTimeFormat`. **Déployé, non commité** | `i18n.tsx:493-502` ; `PlaceReviews.tsx:106,619-631` |
| Repli UI | `MESSAGES[locale][key] ?? MESSAGES.nl[key]` : du code mort tant que les tables sont complètes. Le cast `as MessageKey` sur `tag.${key}` contourne la vérification de type | `i18n.tsx:492` ; `PlaceAmenities.tsx:86,137` |
| Erreurs | `errorKey()` : statut HTTP → 4 clés `err.*`. Le `message` anglais du serveur n'est jamais affiché | `web/src/lib/errors.ts:17-25` (non suivi par git) |
| Contenu des lieux | `PlaceTranslation.locale` est une chaîne libre. 381 lieux complets dans 3 langues, 859 avec un nom générique dans 3 langues, **78 en nl seulement** | SQL ; `osm.ts:139-158` |
| Locale côté API | `GET /api/places` : défaut `nl`, aucune validation, **aucun repli** (les 78 lieux nl-only arrivent sans traduction en fr/en). `GET /api/places/:id` **ignore** `?locale` et renvoie tout. `POST /api/places` : défaut **`en`**, le seul endroit dans ce cas | `places.ts:11,223,259,282-292` |
| Repli côté web | fiche : locale de l'UI → nl → première disponible | `PlaceSheet.tsx:81-86` |

**Non traduit :**
- e-mail du magic link (`auth.ts:129-133`) ;
- JSON brut en anglais si le lien est invalide ou expiré (`auth.ts:155,165`) ;
- infobulles des contrôles Mapbox (aucune option `locale`, `MapPage.tsx:67-68`) ;
- langue des libellés du fond `outdoors-v12` : **non vérifié** ;
- rôle brut `MEMBER` (`ProfilePage.tsx:66`) ;
- meta description et manifeste (anglais seul) ;
- les 78 noms OSM nl-only ;
- pluriels hors `tn()` : `amen.toConfirm` donne « 1 infos à confirmer » (`PlaceAmenities.tsx:79`), `lists.places` donne « 1 lieux » (`ListsPage.tsx:51`) ;
- nombres non formatés dans `map.truncated` et `photo.uploading`.

---

## 7. Décisions prises et points ouverts

### 7.1 Décisions prises

**Produit et périmètre**

| Date | Décision | Source |
|---|---|---|
| 12 juin | Outil ciblé, pas un réseau social ; Rotterdam d'abord ; non-objectifs listés | CLAUDE.md (`2167b77`) |
| 14 sept. | Pitch recentré « family, cooperative » | `ROADMAP.md:11-21` |
| 14 sept. | Social limité au partage de contenu : ni messagerie ni profils | `ROADMAP.md:26` |
| 14 sept. | **Pas de génération d'itinéraires dans le MVP** | `ROADMAP.md:27` |
| 23 oct. | Étoiles et commentaires exigent un compte ; un avis par parent et par lieu (republier = mise à jour, 200) | `ROADMAP.md:33` ; `places.ts:426-430` ; index partiel (déployé, non commité) |
| 23 oct. | Avis affichés anonymement (« Un parent ») ; ne jamais promettre une signature | `ROADMAP.md:33` ; `PlaceReviews.tsx:445-447` |
| 23 oct. | Votes de tags : un tap, anonymes, sans compte | `ROADMAP.md:34` ; `places.ts:432-445` |
| 23 oct. | Lieu non approuvé : 404 sauf pour son auteur ou un admin ; aucun id utilisateur dans les réponses publiques | CLAUDE.md ; ROADMAP |

**Données et OSM**

| Date | Décision | Source |
|---|---|---|
| 13 juin | L'enrichissement préserve le nom OSM ; il est atomique ; plafond `ENRICH_MAX` (50). Run complet des 381 lieux le même jour | `MEMORY.md:11-13` ; `f06eec4` |
| 18 juil. | Lieux OSM auto-approuvés (futurs seeds seulement). La bascule des 381 lieux existants en APPROVED n'a **aucune trace** (voir 2.6) | `6b9f0a7` ; `seed-osm.ts:72` |
| 19 juil. | Provenance (`source`) séparée de l'enrichissement (`enrichedAt`) ; `CLAUDE` devient vestigial ; backfill `enrichedAt = now()` sur les 381 lignes | `7050902` ; `ROADMAP.md:146` |
| 19 juil. → 23 oct. | Prod : `pnpm db:migrate` (= `prisma migrate deploy`), jamais `migrate dev` (`DEPLOY.md:146-147`). `7050902` ne décrit qu'un choix ponctuel. `CLAUDE.md:277` prescrit encore `migrate dev` (en refusant le reset), et la pitfall 22 (`CLAUDE.md:367`) interdit seulement le reset : **non harmonisé** | `DEPLOY.md:146-147` ; `CLAUDE.md:277,367` ; `7050902` |
| 14 sept. | Tag OSM absent ≠ « non » ; le backfill n'écrit que les valeurs null | `560d462` ; `osm.ts:183-205` |
| 14 sept. | Ids `osm:<type>/<id>`, requête `nwr` ; lieux sans nom gardés avec un nom générique (381 → 1318). 9 lieux restent en `osm:<id>` | `45adcd2`, `1823ae7` ; `ROADMAP.md:148` |
| 14 sept. | **19 tags tri-état en 3 groupes sur `Place`** (pas de `PlaceFeature`) ; `Review.score` optionnel | `c173764` ; `ROADMAP.md:28` ; migrations `20260914*` |

**Auth et sécurité**

| Date | Décision | Source |
|---|---|---|
| 13 juin | Helmet ; 200 req/min ; 5 magic links / 5 min ; 20 vérifications / min | `3228ada` |
| 9 sept. | `COOKIE_SECRET` supprimé au profit de `JWT_SECRET` | `fc32796` ; `app.ts:69-72` |
| 14 sept. | Lien sur `PUBLIC_BASE_URL` ; échec Resend → 502 ; `trustProxy` | `d3b5a1c`, `98bf333`, `8b6b2d2` |
| 23 oct. | Cookie `__Host-session` (déconnecte tout le monde une fois) ; clés de limite IPv6 en /64 ; limites photo par compte ; une seule porte de session `useMe()` | déployé, non commité ; `DEPLOY.md:30-33` |

**Photos**

| Date | Décision | Source |
|---|---|---|
| 23 oct. | Les octets non modérés ne sont jamais publics : staging privé → modération humaine → ré-encodage sharp (EXIF supprimé) → `p/<id>.jpg` public | `ROADMAP.md:35` ; `services/photo-moderation.ts` |
| 23 oct. | Fermé par défaut sans `R2_STAGING_BUCKET` ; 10 Mo ; 20 PENDING par compte ; URL valable 120 s, type et taille signés | `photos.ts`, `r2.ts` ; pitfalls 18-21 |

**Infra**

| Date | Décision | Source |
|---|---|---|
| 12 juin | Hostinger réservé à l'automatisation | CLAUDE.md |
| 9 sept. | **Option A, natif** (systemd + nginx), Docker reporté ; TLS Cloudflare Origin | `DEPLOY.md:6-10` |
| 14 sept. | IP réelle via CF ; 403 hors CF ; `X-Forwarded-For = $remote_addr` ; `limit` 1..500 | `8b6b2d2`, `d55b9c1` |
| — | Push direct sur `main` tant que le dev est solo | CLAUDE.md « Commit conventions » |

**Design et i18n**

| Date | Décision | Source |
|---|---|---|
| 14 sept. | Identité toy-box ; tokens dans `tokens.css` ; emoji pour les tags « for now » | identité `0e917f4` ; `tokens.css` `85189ae` ; emoji `c173764` + `web/src/lib/tags.ts:4-6` |
| 14 sept. | 3 langues nl/fr/en, i18n maison, nl par défaut | `0e917f4` |
| 23 oct. | `--sun-deep` et `--mint-deep` assombris (AA) ; erreurs toujours via une clé i18n ; `Intl.PluralRules` | déployé, non commité ; `DESIGN.md:50-53` |
| 14 sept. / 23 oct. | Sections équipements et avis validées depuis les maquettes : « Don't redesign without a reason » | `DESIGN.md:118-162` |

### 7.2 Points ouverts

| # | Question | Statut réel | Source |
|---|---|---|---|
| 1 | Écart de tags vision/code | **Tranché le 14 sept.**, mais CLAUDE.md le garde ouvert. Restent absents : `isStepFree`, `isIndoor` ; `hasToilet` = `hasToilets` | `c173764` ; CLAUDE.md Q1 |
| 2 | Passage à Docker | Tranché pour le 1er déploiement (natif). Le déclencheur « HTTPS » de CLAUDE.md est passé sans Docker. DEPLOY.md dit plutôt « un 2e dev ». **Les déclencheurs ne concordent pas** | `DEPLOY.md:6-7,94-95` ; CLAUDE.md Q2 |
| 3 | Modération photo : Claude vision, cron ou à l'envoi | Ouvert. Aujourd'hui 100 % humain, pas de code vision. Non urgent (0 photo, uploads OFF) | ROADMAP décision 3 |
| 4 | Propriété des données OSM (fork ou surcouche) | Ouvert, pas encore bloquant (aucune édition de lieu par les parents) | CLAUDE.md Q4 ; ROADMAP 4 |
| 5 | Stewards | Ouvert, non bloquant. `STEWARD` n'est utilisé nulle part dans `api/src` | CLAUDE.md Q5 |
| 6 | Enrichir les 937 lieux | Attend le feu vert de Jerome | ROADMAP décision 2 |
| 7 | Noms génériques ou géocodage inverse | Ouvert | ROADMAP décision 5 |
| 8 | Avis signés / handle | Ouvert. **Absent des questions de CLAUDE.md** | ROADMAP décision 6 |
| 9 | Règle pour faire basculer un booléen de lieu à partir des votes | **Ouvert et non documenté** : `PlaceAmenities.tsx:17-20` renvoie à une ROADMAP qui n'en parle pas | — |
| 10 | Webfont arrondie ; logo avec poussette ; landing animée ; « stroller score » | Ouverts (choix de Jerome / à concevoir) | `DESIGN.md:65-67,164-188` |
| 11 | Déployer le site marketing (apex/www) | Ouvert | `DEPLOY.md:341` |
| 12 | Moteur d'itinéraires (Mapbox Directions ou OSRM) | Reporté après le MVP | `ROADMAP.md:27` |
| 13 | « Request corrections » (pitch) | Aucun endpoint ; lié au point 4 | `ROADMAP.md:19-20` |

Actions en attente (pas des décisions) :
- **Jerome** : configuration Cloudflare des photos (`DEPLOY.md` §3c) ; commit et push du lot du 23 oct. ; reboot du noyau.
- **À construire** : interface admin, parcours « Ajouter un lieu », Claude vision.

### 7.3 TODO dans le code

- **Aucun `TODO`, `FIXME`, `XXX` ni `HACK`** dans `api/`, `web/`, `ops/` ou `marketing/` (`grep -rnE`, lot non commité compris). Le seul TODO de l'historique, `TODO(jerome)` dans `seed-osm.ts:43` (`45adcd2`), a été résolu par `1823ae7`.
- TODO implicites (commentaires qui attendent une décision) :
  - `PlaceAmenities.tsx:17-20` : la bascule par les votes relève d'une « moderation decision (see ROADMAP) », sujet absent de ROADMAP.
  - `seed-osm.ts:72` : auto-approbation des lieux OSM, « see ROADMAP » ; la décision n'est écrite que dans `6b9f0a7`.
  - `tokens.css:58-61` : webfont, « Jerome's call ».
  - `tags.ts:4-6` : emoji « for now ».
  - `PlaceReviews.tsx:53` : « once handles exist ».
  - `routes.ts:36` : « queued for simplification », qui ne correspond à aucun job.
- Hors code : le retrait de la valeur vestigiale `CLAUDE` de `PlaceSource` n'est noté que dans le message de `7050902` et dans `ROADMAP.md:146` (`schema.prisma:111-115` n'a aucun commentaire).

---

## 8. Incohérences à harmoniser

### CLAUDE.md
- [ ] « Prisma schema migrated, **12 models** » (l.25) et `schema.prisma # 12 models` (l.123) → **14 modèles**.
- [x] (fait le 26/10, `CLAUDE.md`) « **381 POIs** … (**1143 translations**) » (l.46) → **1318 lieux** (OSM, tous APPROVED), dont **381 enrichis** ; **3798 traductions** (nl 1318, fr 1240, en 1240), dont 1143 avec description ; 937 en attente d'enrichissement ; 78 lieux nl-only.
- [ ] « PostGIS triggers active: `Place.geom` and `Route.geom` auto-synced … GIST indexes for fast spatial queries » → seul `trg_place_geom` existe ; `Route.geom` n'a pas de trigger ; **aucune requête n'utilise `geom`** (filtre Prisma `gte`/`lte` sur `lat`/`lng`, `places.ts:246-247`).
- [x] (fait le 26/10 : `CLAUDE.md` renvoie à `docs/MAINTENANCE.md`) « Pending kernel reboot … installed is **7.0.0-31** » (l.61) → installé : **7.0.0-38** ; le reboot attend aussi `libc6` (`/var/run/reboot-required.pkgs`).
- [ ] « **`GET /api/places` caps at 200** results with no pagination » (l.65) → défaut 200, **max 500**, en-têtes `X-Total-Count` et `X-Result-Truncated`, le web demande 500 ; pas de pagination.
- [ ] Section « ⚠️ Known mismatch » (l.67-75) et question ouverte n°1 → **tranché le 14 sept.** (`c173764`) : 19 tags tri-état sur `Place` ; préciser l'absence d'`isStepFree` et d'`isIndoor`, et que `hasToilet` = `hasToilets`.
- [ ] Question ouverte n°2 « Docker switchover » (l.405) → tranché pour la prod (option A, `DEPLOY.md:6-10`) ; aligner le déclencheur sur DEPLOY.md (« 2e dev ou plus de services »).
- [ ] Question ouverte n°3 et cron « 03:00 → Claude vision moderation » → aujourd'hui modération 100 % humaine (CLI), aucun code vision ; reformuler selon ROADMAP décision 3.
- [ ] Questions ouvertes : **ajouter** les avis signés / handle (ROADMAP 6), l'enrichissement des 937 lieux (ROADMAP 2), les noms génériques (ROADMAP 5) et la règle votes → booléens.
- [ ] « Marketing — static HTML (…, **Dutch copy**) » (l.92) et « static landing page, **Dutch** » (l.182) → **anglais par défaut**, bascule vers NL, pas de FR.
- [ ] « `marketing/` not deployed — apex and `www` have no origin server block » → exact, **mais** apex et www **servent la PWA** (200) faute de `default_server`.
- [ ] Arborescence : `marketing/nginx.conf` → **n'existe pas** (seulement `Dockerfile` et `index.html`).
- [ ] Arborescence : ajouter `ops/nginx/`, `ops/systemd/`, `ops/scripts/update-cloudflare-ips.sh`, `ops/scripts/generate-icons.py`, `design/mockups/`, `web/src/styles/tokens.css`, `web/src/lib/{locale,text}.ts`, `api/vitest.config.ts`, `docs/STATE.md` et les docs racine (`DEPLOY.md`, `ROADMAP.md`, `DESIGN.md`, `MEMORY.md`).
- [ ] `routes.ts # routes CRUD` → `GET /`, `GET /:id`, `POST /track` seulement ; `bbox` ignoré.
- [ ] `lists.ts # Mapstr-style lists CRUD` → GET public/mine/:slug, POST / et POST /:slug/places ; ni modification ni suppression ; le web n'appelle que `/public`.
- [ ] `provision.sh # idempotent VPS setup, already executed` → installe Docker (absent) et n'installe ni Node, ni Postgres, ni nginx : script **non représentatif**.
- [ ] `FICHE_RELANCE.md` cité (l.239, l.339) → **fichier inexistant**, ni dans le repo ni dans l'historique git.
- [ ] « Web app … tab bar (**Carte/Listes/Profil**) » → libellés par défaut (nl) : **Kaart / Lijsten / Profiel** ; préciser que Carte/Listes/Profil est la version fr.
- [ ] Workflow de dev : `cd api && pnpm dev # API on :3000` → le port 3000 est pris par le service systemd de prod. Deux processus de dev oubliés tournent : un `tsx watch` de l'API depuis le **12 juin** (session tmux `tinyhike`), qui peut prendre `:3000` si une sauvegarde tombe pendant un redémarrage du service, et un Vite depuis le 20 juillet sur `0.0.0.0:5173`, qui proxifie vers **l'API et la base de prod**. Documenter un port de dev (et une base de dev), ou arrêter ces processus.
- [ ] Workflow de dev : « open the SSH tunnel … browse `http://localhost:5173` » (l.259-263) contredit « No SSH tunnel needed any more » (l.27) → dire à quoi sert encore le tunnel (dev seulement), ou le retirer.
- [x] (fait le 26/10 : `CLAUDE.md` décrit la génération hors connexion par `prisma migrate diff`, plus stricte que `--create-only`) l.277 `npx prisma migrate dev --name …` → contredit `DEPLOY.md:146-147` (« never `migrate dev` here »). Il n'y a **qu'une base** (la prod, `127.0.0.1:5432`) et `NODE_ENV` vaut « production (even in dev for now) » (l.218). Un reset accepté par erreur viderait la prod, et un `DROP INDEX` généré rouvrirait le bourrage d'avis (pitfall 22). Écrire : `migrate dev --create-only`, relire le SQL, puis `pnpm db:migrate`.
- [ ] Pitfall 22 (l.367) → expliciter qu'elle n'interdit que le reset ; la règle « jamais `migrate dev` en prod » n'est écrite que dans DEPLOY.md.
- [x] (fait le 26/10 : marqué « paused », pas d'enrichissement IA pour l'instant) Cron Hostinger « `02:30` → trigger `pnpm enrich:pending` » (l.100) → le brancher tel quel contournerait la décision ouverte sur l'enrichissement des 937 lieux (`ROADMAP.md:132`, « needs Jerome's go, ~937×3 Claude calls », et décision 2, l.162 ; plafond par défaut 50 par run, `enrich.ts:20`). Marquer ce cron « en attente de la décision ».
- [ ] Playbook périmé : « Security audit (high priority **before any prod deploy**) » (l.416) → la prod tourne depuis le 14 sept. ; « **We have zero tests** right now… one integration test using a real test DB » (l.435) → 395 tests dans 11 fichiers, aucun ne touche la base ; « Currently `Place` **and `Route`** use `lat: Float, lng: Float` » (l.441) → `Route` n'a ni `lat` ni `lng` (`schema.prisma:131-157`).
- [ ] Préciser que l'API écoute sur `0.0.0.0:3000` (`api/src/index.ts`), isolée seulement par UFW.
- [ ] « ~8-week MVP timeline » → dépassé (~20 semaines depuis `7f3c862`) ; écrire une date cible ou retirer.
- [x] (fait le 26/10 : le compte de Jérôme est ADMIN) Ajouter : **1 utilisateur, 0 ADMIN** : `/api/admin/*` est inutilisable sans `UPDATE` du rôle en SQL ; `requireAdmin` lit le rôle dans le JWT (30 jours).
- [ ] « Code style : Fastify schema validation on every route » → `POST /api/admin/seed` n'a aucune validation (`admin.ts:107-133`) et crée des lieux **PENDING**, contre APPROVED pour `seed-osm`.
- [ ] Secrets : `TELEGRAM_*`, `API_BASE_URL`, `ACME_EMAIL` et `MAPBOX_PUBLIC_TOKEN` ne sont pas lus par le code de l'app : les marquer « réservé / non utilisé ».
- [ ] « Last updated » et la section « Quick context » : reprendre le pitch recentré du 14 sept. (ROADMAP) ou expliquer l'écart.

### README.md
- [ ] l.3 « places **and routes** » → aligner sur le pitch actuel (lieux + avis ; itinéraires hors MVP).
- [ ] l.10 « Infra — Docker Compose + Traefik (Let's Encrypt) » → **natif : systemd + nginx 1.28 + certificat Cloudflare Origin** ; renvoyer vers `DEPLOY.md`.
- [ ] l.18 `ops/` = « docker-compose, traefik, scripts » → `nginx/`, `systemd/`, `scripts/` (Docker/Traefik inutilisés).
- [ ] l.28 `pnpm prisma migrate dev` → **dangereux** sur cette base (pitfall 22) : `pnpm db:migrate` (= `migrate deploy`).
- [ ] Ajouter les langues (nl/fr/en) et un lien vers `docs/STATE.md`.

### DEPLOY.md
- [ ] l.133 « Magic-link end-to-end (**never tested!**) » → vérifié en prod le 14 sept. (`98bf333`, `0d5ca76`).
- [ ] l.109 `EnvironmentFile=/srv/tinyhike/.env` → l'unité n'en a pas, dotenv lit `api/.env` (`ops/systemd/tinyhike-api.service`).
- [ ] §0 (l.58, 64) `COOKIE_SECRET` → supprimé depuis `fc32796`, le cookie utilise `JWT_SECRET`.
- [ ] l.113 « Reuse `web/nginx.conf` / `marketing/nginx.conf` » → `marketing/nginx.conf` n'existe pas.
- [ ] l.331 « pagination beyond the **200 cap** » → plafond effectif 500.
- [ ] l.336-341 « Open questions for Jerome before we start » → questions 1 à 3 tranchées le 9 sept. ; seule la 4 (marketing) reste ouverte.
- [ ] l.94-95 « when a second dev joins or services multiply — **exactly the trigger CLAUDE.md #2 names** » → faux : CLAUDE.md:405 dit « first 10 real users, or first deploy to `app.tinyhike.com` HTTPS ». Aligner les deux textes sur un seul déclencheur.
- [ ] l.320 (Rollback) « dev tunnel still works as before » → s'appuie sur le tunnel que CLAUDE.md:27 déclare inutile ; préciser ou retirer.
- [ ] l.36 noyau 7.0.0-31 → **7.0.0-38**.
- [ ] Ajouter : apex et www servent la PWA (pas de `default_server`) ; la PWA statique n'envoie aucun en-tête de sécurité depuis l'origine (HSTS et CSP seulement sur `/api`), et `server_tokens` expose la version de nginx. Ce que l'edge Cloudflare ajoute n'a **pas été vérifié**.

### ROADMAP.md
- [ ] l.176 « `main` is in sync with GitHub » → vrai pour les commits seulement : le lot du 23 oct. est **déployé, non commité** (33 M + 22 ??), y compris une migration appliquée en prod.
- [ ] l.143 noyau `7.0.0-31` → **7.0.0-38**.
- [ ] Ajouter la décision « lieux OSM auto-approuvés » (`6b9f0a7`), citée par `seed-osm.ts:72` comme « see ROADMAP », et noter que les 381 lieux de juin ont été passés en APPROVED à la main, sans trace.
- [ ] Ajouter la règle (ouverte) « votes de tags → booléens `Place` », citée par `PlaceAmenities.tsx:17-20` comme « see ROADMAP ».
- [ ] l.78-84 : compléter la liste des tags renseignés, en oui / non : `hasOutdoorSeating` 55 / 12, `dogFriendly` 1 / 10, `enclosed` 5 / 0, `freeEntry` 1 / 3, `hasChangingTable` 1 / 0, `hasHighchair` 1 / 0 ; et les 183 parcs / aires de pique-nique.
- [ ] l.83 « napFriendly / shaded / hasParking: still all null » → **8 tags** sont null partout : ajouter `isBreastfeedingFriendly`, `isStrollerWide`, `hasElevator`, `hasPlayCorner`, `isQuiet`.
- [ ] l.90 « 381 original places have nl/fr/en descriptions » → préciser que ce sont surtout des cafés (262 `hasCafe`, 11 `hasPlayground`) : 848 des 859 aires de jeux n'ont aucune description.
- [ ] Phase A étape 4 « backend done » → manque aussi une route admin qui liste les lieux PENDING, et un compte ADMIN.

### DESIGN.md
- [ ] Tableau de palette (l.35-44) → ajouter `--surface #ffffff`, `--border #e4ebee`, `--danger-bg #ffe3ea`, `--danger-fg #b0123f`, `--shadow-sheet`, `--shadow-pop`.
- [ ] `--sky` « Links » (l.40) → les liens utilisent **`--sky-deep`** (`index.css:16`). Même erreur dans le commentaire de `web/src/styles/tokens.css:30`, le fichier « source unique de vérité » qu'une passation lirait en premier.
- [ ] l.168 « "Add a place" flow (**backend done**: USER → PENDING → admin) » → `api/src/routes/admin.ts` n'expose que `GET /stats`, `PATCH /places/:id`, `GET`/`PATCH /photos` et `POST /seed`, sans liste des lieux PENDING ; et aucun compte ADMIN n'existe (`User` : 1 MEMBER).
- [ ] « ⚠️ Two places colours are duplicated » (l.76) → ajouter les teintes en dur d'`index.css` (`#e7f5fb` ×5, `#dff8ef` ×3, gris du skeleton, `rgba(7,59,76,…)`).
- [ ] Plancher a11y : signaler les écarts (`.sheet-close` 36 px ; contrôles Mapbox 32×32 px avec `outline:none` et focus Mapbox ; blanc sur `--sky` pour `.lang-btn` et l'icône de l'onglet Profil actif 2,72:1 ; blanc sur `--grape` pour `.map-pill--warn` et les clusters 4,13:1 ; anneau de focus `--sky` 2,72:1 < 3:1) ou corriger le code.
- [ ] Maquettes : `place-tags-mockup.html` (« Tokens réels », mais 4 tokens et Hiragino manquants ; 34 px contre 44 px ; « Vérifié par OSM et les parents » absent de l'UI ; « Coin sieste »/« Gratuit » contre « Sieste possible »/« Entrée gratuite ») et `place-reviews-mockup.html` (avatars blanc sur teinte vive, textarea 15 px) → noter qu'elles ne reflètent plus la prod.

### MEMORY.md (racine, « Last updated: 13 June 2026 »)
- [ ] l.12 enrichir fait passer à `source=CLAUDE` → **non** depuis `7050902` : `source` reste OSM, l'enrichissement est marqué par `enrichedAt`.
- [ ] l.24 « `Place`: 381 rows, … `CLAUDE`, all `status=PENDING` » → 1318, tous OSM et APPROVED.
- [ ] l.25 « `PlaceTranslation`: 1143 rows … every one has description » → 3798 lignes, dont 1143 avec description.
- [ ] l.13 « Used ENRICH_MAX=400 to enrich all 381 in one session » → exact, mais ajouter que `enrichedAt` (19/07) vient du backfill de `7050902`, pas de ce run.
- [ ] l.26 « see ROADMAP "moat" » → cette section n'existe plus (`grep -i moat ROADMAP.md` vide ; dernier commit à toucher le mot : `c173764`). Renvoyer vers `ROADMAP.md:78-84` (données) ou « Known debt ».
- [ ] Section « Known uncommitted repo state » (l.28-31) → périmée : commitée dans `3228ada` (`api/package.json`, `api/pnpm-lock.yaml`, « api/pnpm-lock.yaml is now tracked ») et `1540c3f` (les 7 autres éléments).

### Site marketing (`marketing/index.html`)
- [ ] l.44, l.91 « all verified by parents » / « allemaal gecontroleerd door ouders » → **faux** (OSM auto-approuvé, 1 contribution) : retirer ou reformuler.
- [ ] l.48, l.92 « Stroller-proof routes with surface and elevation info » → inexistant et hors MVP : retirer.
- [ ] l.52, l.93 « Save your favourites and share them » → pas d'UI : retirer ou marquer « bientôt ».
- [ ] l.56, l.94 « use maps even without internet » → seul le shell est en cache : retirer ou mettre en cache tuiles et `/api/places`.
- [ ] l.6, l.38, l.61 « Rotterdam and beyond / en omgeving » → « Rotterdam » (le multi-villes est un non-objectif).
- [ ] l.84 `<title>` NL « Wandel met de buggy… » contre hero l.88 « Wandelen met de buggy… » → une seule formule ; l.85 promet des « wandelingen » (balades) qui n'existent pas.
- [ ] Vocabulaire : choisir un terme unique (NL : « kinderwagen » comme l'app, pas « buggy » ; EN : « stroller », pas « pushchair »).
- [ ] Langue : ajouter le FR (comme la PWA) et la détection du navigateur, ou documenter EN/NL.
- [ ] Palette verte et sable + `system-ui` → identité toy-box, métadonnées OG/Twitter, favicon (`DESIGN.md:173-174`).
- [ ] Reprendre le pitch du 14 sept. (`ROADMAP.md:11-21`).

### PWA (`web/`)
- [ ] `web/index.html:7` et `web/public/manifest.json:4` « walks » → aucune balade dans l'UI : parler de « places ». Meta en anglais sur une page `lang="nl"` : localiser ou passer en nl ; ajouter `lang` au manifeste.
- [ ] `api/src/routes/auth.ts:129-133` : e-mail en anglais seul → localiser (envoyer la locale avec `POST /magic`).
- [ ] `auth.ts:155,165` : JSON brut en anglais sur un lien expiré → rediriger vers une page web traduite.
- [ ] `PlaceAmenities.tsx:79` (`amen.toConfirm`) et `ListsPage.tsx:51` (`lists.places`) → passer par `tn()` (évite « 1 infos à confirmer »).
- [ ] `GET /api/places` n'a pas de repli de locale (`places.ts:259`). Sans effet visible aujourd'hui : la carte n'affiche aucun libellé de nom (cercles et compte des clusters seulement, `MapPage.tsx:86-124` ; `properties.name`, qui retombe sur 'Place' à la l.26, n'est lu nulle part), et la fiche retombe sur nl (`PlaceSheet.tsx:83-86`). Mais tout futur affichage de nom sur la carte ou en liste montrerait 'Place' ou rien pour 78 lieux en fr/en : ajouter un repli sur nl.
- [ ] `places.ts:11` : défaut `'en'` pour `POST /api/places` → `'nl'`, comme partout ailleurs.
- [ ] `places.ts:282` : commentaire `?locale=nl` → le paramètre est ignoré ; corriger le commentaire ou le code.

### Commentaires de code périmés
- [ ] `api/src/jobs/enrich.ts:2-4` « called by n8n cron at 02:30 » et « Takes PENDING places » → aucun cron ; le filtre réel est `status != REJECTED`, `source = OSM`, `enrichedAt = null`.
- [ ] `ops/scripts/generate-icons.py:30` et `web/src/pages/MapPage.tsx:91` « tokens in index.css » → `web/src/styles/tokens.css`.
- [ ] `web/src/pages/MapPage.tsx:46` « Rotterdam seed (381 places) » → 1318.
- [ ] `api/src/lib/osm.ts:193-196` « Three tags are deliberately never inferred … `enclosed` » → `osm.ts:229` en déduit bien un (`if (tags.barrier && ENCLOSING_BARRIERS.has(tags.barrier)) out.enclosed = true`), et la base compte 5 `enclosed` non nuls. Corriger le commentaire (deux tags jamais déduits, `enclosed` seulement via `barrier`).
- [ ] `api/prisma/schema.prisma:228` (commentaire du modèle Review, lot non commité) « (pitfall #5 territory) » → **pitfall 22** (`CLAUDE.md:367`).
- [ ] `web/src/styles/tokens.css:30` `--sky` « links, focus rings, "Profile" tab » → les liens sont en `--sky-deep` (`index.css:16`).
- [ ] `web/src/lib/locale.ts:2-4` « enrich.ts writes one PlaceTranslation per place for each of these » → faux pour 937 lieux (78 nl-only, 859 noms génériques).
- [ ] `ops/scripts/postgis_setup.sql` (en-tête) « runs once at container init via initdb.d » → appliqué à la main, sans Docker.
- [ ] `.env.example:7` « Anthropic API (enrichissement POI + modération photos) » → enrichissement seulement.
- [ ] `CLAUDE.md:222` « ACME_EMAIL … (for Let's Encrypt later) » → obsolète : le TLS passe par le certificat Cloudflare Origin (`DEPLOY.md:6-8`), et la variable n'est lue que par `ops/traefik/traefik.yml:23`. (`.env.example:36` ne porte pas de commentaire.)
- [ ] `api/src/routes/routes.ts:36` « queued for simplification » → aucun job.

### Configuration et code (pas de la doc, mais source d'écart)
- [ ] `ops/nginx/tinyhike.conf` : sans `default_server`, l'apex et www servent la PWA. Ajouter un bloc apex/www (marketing ou 301 vers app) ou un `default_server` qui répond 444.
- [ ] `api/src/app.ts:74` : `@fastify/multipart` enregistré sans usage → retirer.
- [ ] `web/vite.config.ts` (bloc `workbox`, l.12-29) : le bundle principal est à ~24 Ko de la limite de précache Workbox (2 MiB) → relever `maximumFileSizeToCacheInBytes` ou découper le bundle, sinon le shell hors ligne disparaîtra au prochain gros build.
- [x] (fait le 26/10) VPS : arrêter le `tsx watch` de l'API (session tmux `tinyhike`, depuis le 12 juin) et le Vite de dev (depuis le 20 juillet), ou les isoler de la prod.
- [ ] `ops/docker-compose.yml` et Dockerfiles (`npm ci` sans lockfile, postgis 3.4) → les marquer non fonctionnels ou les supprimer.
- [x] (fait le 26/10) Git : commiter le lot du 23 oct. (dont la migration `20261023120000` et les 7 fichiers de test) pour que GitHub reflète la prod.

---

*Non vérifié dans cet état des lieux :*
- comportement hors ligne réel (analyse du code seulement) ;
- carte sur `www` (restriction du token Mapbox, d'après CLAUDE.md pitfall 7) ;
- en-têtes ajoutés par l'edge Cloudflare ;
- langue des libellés du fond Mapbox ;
- envoi réel du magic link (pas d'e-mail envoyé) ;
- tailles réelles en navigateur de `.lang-btn` et `.amen-more` ;
- débordement de la bbox sur les communes voisines (pas de géocodage).
