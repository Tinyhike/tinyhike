# TinyHike

Mobility and discovery layer for parents with strollers — find stroller-friendly places and routes, starting in Rotterdam.

## Stack

- **API** — Fastify + Prisma + PostgreSQL/PostGIS + TypeScript
- **Web** — React + Vite + Mapbox GL JS + PWA
- **Marketing** — Static HTML (nginx)
- **Infra** — Docker Compose + Traefik (Let's Encrypt)
- **Services** — Resend (email), Mapbox (tiles), Cloudflare R2 (photos), Anthropic Claude (enrichment)

## Structure
tinyhike/
├── api/         REST API (Fastify, Prisma, PostGIS)
├── web/         PWA frontend (React, Vite, Mapbox)
├── marketing/   Landing page (nginx static)
├── ops/         Infra config (docker-compose, traefik, scripts)
└── .env.example Secrets template
## Dev quick start

```bash
git clone https://github.com/tinyhike/tinyhike.git
cd tinyhike
cp .env.example .env
# Fill .env with real secrets from your password manager

cd api && pnpm install && pnpm prisma migrate dev
cd ../web && pnpm install
```

## License

MIT
