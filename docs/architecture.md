# Architecture

Prototype stage. Monorepo (npm workspaces):

| Path | Purpose |
|------|---------|
| `apps/web` | Citizen-facing frontend (Next.js, German by default) |
| `apps/api` | Backend API (Fastify, TypeScript) |
| `packages/shared` | Types shared between web and api |

Persistence: PostgreSQL (see `docker-compose.yml`). Not yet wired into the API.

## Concerns to address before handling real data

- **Data protection**: GDPR/DSGVO; data minimisation, retention, audit logging.
- **Identity**: eID / BundID / ELSTER-style authentication (OIDC/SAML integration).
- **Accessibility**: BITV 2.0 / EN 301 549 (WCAG 2.1 AA).
- **Hosting**: sovereign / German-region hosting; consider BSI IT-Grundschutz and C5.
- **Interoperability**: OZG, XÖV standards, FIT-Connect for submitting applications.
- **Open source**: consider EUPL / publishing on openCode.de.

Decisions are recorded in `docs/adr/`.
