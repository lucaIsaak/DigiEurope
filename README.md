# DigiEurope

Prototype of a platform to digitalise public administration services (starting with Germany).

## Structure

- `apps/web` – Next.js frontend (German UI)
- `apps/api` – Fastify API (`GET /health`)
- `packages/shared` – shared TypeScript types
- `docs/` – architecture notes and ADRs

## Getting started

Requires Node 22+ (`nvm use`) and Docker.

```sh
cp .env.example .env
docker compose up -d        # PostgreSQL
npm install
npm run build -w @digieurope/shared
npm run dev:api             # http://localhost:4000/health
npm run dev:web             # http://localhost:3000
```

Run checks with `npm run typecheck` and `npm test`.

See [docs/architecture.md](docs/architecture.md) for open concerns (DSGVO, accessibility, identity, hosting).
