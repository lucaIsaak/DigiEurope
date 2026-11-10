# Architecture

Prototype stage. Monorepo (npm workspaces):

| Path | Purpose |
|------|---------|
| `apps/web` | Next.js app with all views (citizen, landlord, caseworker, city dashboard). Talks to the API through a same-origin `/api` rewrite. |
| `apps/api` | Fastify API. Routes in `src/app.ts`, workflow transitions in `src/cases.ts`, metrics in `src/metrics.ts`, demo data in `src/seed.ts`. |
| `packages/shared` | Domain types, pre-check rules and patch logic used by both sides, so the browser shows the same result the server enforces. |

## Application lifecycle

```
draft ──submit (pre-check must pass)──▶ submitted ──caseworker opens──▶ in_review
  ▲                                                                       │
  └──── info_requested ◀── request_info ──────────────────────────────────┤
                                                                          ├─ eID: approve ─────────────▶ approved
                                                                          ├─ passport: invite_id_check ─▶ id_check ─ confirm_identity ─▶ approved
                                                                          └─ reject ────────────────────▶ rejected
```

Every transition is recorded in `history`; caseworker messages are shown to the applicant. Nothing is decided automatically: the pre-check only blocks incomplete submissions and flags warnings.

## Persistence

`apps/api/src/store.ts` keeps everything in `apps/api/data/store.json` plus `data/uploads/`. The routes only use the `Store` methods, so it can be swapped for PostgreSQL (see `docker-compose.yml`) without touching them.

## Concerns to address before handling real data

- **Data protection**: GDPR/DSGVO; data minimisation, retention and deletion, audit logging, encryption of documents at rest.
- **Access control**: applicant access currently relies on an unguessable id; caseworker and dashboard have no authentication.
- **Identity**: real eID / BundID integration (OIDC/SAML) instead of the demo personas.
- **Landlord confirmation**: real e-mail delivery, link expiry, and checking that the confirming person is the landlord.
- **Accessibility**: BITV 2.0 / EN 301 549 (WCAG 2.1 AA) audit; the UI uses labels, focus styles and plain language but is not audited.
- **Hosting**: sovereign / German-region hosting; consider BSI IT-Grundschutz and C5.
- **Interoperability**: OZG, XÖV/XMeld, FIT-Connect for handing applications to the case software (the current JSON export is a placeholder).
- **Open source**: consider EUPL / publishing on openCode.de.

Decisions are recorded in `docs/adr/`.
