# Architecture

Prototype. Monorepo (npm workspaces):

| Path | Purpose |
|---|---|
| `apps/web` | Next.js app. Student site at `/`, office area under `/office`. Talks to the API through a same-origin `/api` rewrite. |
| `apps/api` | Fastify API. Routes in `src/app.ts`, case workflow in `src/cases.ts`, document reader in `src/documents.ts`, sample documents in `src/samples.ts`, demo data in `src/seed.ts`, optional live assistant in `src/assistant.ts`. |
| `packages/shared` | The part that must be identical on both sides: types, the **rules and the engine**, the estimate calculator, the decision-letter analysis, the question knowledge base. |

## Rules

A rule (`packages/shared/src/rules.ts`) is data:

```
plain language text (DE/EN)  →  executable check (JSON)  →  sample cases  →  approval state
```

- The check is a small expression (`all`, `any`, `not`, `eq`, `gte`, `lte`, `in`, `truthy`) over **facts** built from the application and the fields read from its documents (`facts.ts`). `engine.ts` evaluates it. No AI, no randomness, no I/O.
- `runChecks` only runs rules whose state is `approved`. Approval is stored per office, and the API refuses to approve a rule whose sample cases do not pass.
- Rules have a `scope`: `federal` (shared by all offices) or `office` (local).
- A rule can carry a `recommendation` for the application form. The insights page shows it when the rule fails often.

## Documents and the "reader"

Sample documents are real PDFs made in `pdf.ts` with the text in uncompressed content streams. `documents.ts` lists the document types the office accepts and reads fields and signatures back out of a PDF. Files it cannot read (images, unknown PDFs) are reported as unreadable, which is itself a rule (`R-READABLE`). In a real system this step would be an extraction service with a human check on low-confidence fields. Only the reader would change; rules, estimate and screens would not.

## Flows

```
Student: create → upload (reader) → parents' link (reader) → check (rules) → estimate → submit
Portal : POST /office/portal/deliver (simulated) → same checks → inbox
Office : open → decide (request information | approve | reject). Approve is blocked while blocking items are open.
```

Statuses: `draft → submitted → in_review → (info_requested ↔ submitted) → approved | rejected`. Every transition is stored in the history.

## The AI, precisely

| Step | AI? |
|---|---|
| Reading documents into fields | Simulated (parses the known sample documents). A real model or OCR service would sit here. |
| Rule checks, estimate, letter analysis | No. Deterministic code. |
| Question assistant | Default: keyword retrieval over a curated list of entries, each with its source. Optional live model call that may only use those entries and must name the ones it used. Sources come from the entries, never from the model's text. Falls back to retrieval on any error. |
| Drafting a rule | One rule in the seed is marked as AI-drafted and waits for approval. There is no live drafting in the prototype. |
| Decisions | Never. A caseworker decides. |

## Persistence

`apps/api/src/store.ts` keeps everything in `apps/api/data/store.json` plus `data/uploads/`. `npm run reset-demo` deletes it and the next start reseeds. The routes only use the `Store` methods, so it can be replaced by a database.

## Before real data

- Data protection (GDPR/DSGVO): legal basis, minimisation, retention, deletion, encryption of documents at rest, audit log.
- Access control: students need a real login and the office needs staff accounts with roles. Parent links need expiry and one-time use. Today the case id is the only protection, and the office area has no login.
- Real integration with the official portal and the case software.
- A real document reader with a human review step.
- Accessibility audit (BITV 2.0 / EN 301 549).
- A process for owning and updating the shared federal rule set after law changes.

Decisions are recorded in `docs/adr/`.
