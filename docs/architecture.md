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

## Processes

Offices draw their own process in the builder. A process (`packages/shared/src/process.ts`) is data too: nodes (`trigger`, `run_rules`, `read_documents`, `condition`, `human_task`, `assign_team`, `wait`, `ai_draft_mail`, `request_documents`, `send_notification`, `connector`, `end`) and edges from named output handles (for example `complete` / `incomplete`). `NODE_CATALOG` describes every step type once (title, outputs, settings), and both the palette and the settings form are generated from it. `validateProcess` rejects processes with loose ends, loops, unreachable steps or missing settings.

`apps/api/src/engine.ts` runs a process. It is triggered when an application is submitted or delivered from the portal, follows the edges, and stops at a `human_task` until the caseworker acts (approve, reject, ask), then continues down the matching branch. Steps change the case (status, team), send messages (stored in the case outbox, shown to the student) or call connectors (mock, logged on the case). Every step is logged on the case. A process is saved as a draft, validated, test-run on a sample case in a scratch store, and published as a new version; the previous version is kept and can be reopened as a draft.

Connectors: `CONNECTORS` in the shared package lists systems and actions. The engine's `connectorResponse` is the single place that would call a real system. A real connector implements the same actions with real credentials and error handling.

## Process catalogue and comparison across offices

`packages/shared/src/catalog.ts` holds the central catalogue (three levels). Every `ProcessDef` carries a `catalogId` of a variant, and an office has one process per category (`Store.processes` is keyed by category; only `bafoeg.abroad` is run by the engine, other categories can be drawn and compared).

`compare.ts` makes processes comparable without caring about local wording: `stepSignature` reduces a step to its kind plus the settings that change its meaning (connector system and action, condition field, reading method, notification recipient). Team names, texts and subjects are ignored. `diffProcesses` compares the multisets of step signatures and of connections (step, output, next step) with a Jaccard measure and reports what exists only on one side; `compareSettings` compares approved rules, the reading method per document type, connected systems, reply target and languages; `harmony` combines them (60 % process, 40 % settings and systems) against a reference model (`referenceProcess`, `REFERENCE_SETTINGS`).

The oversight area (`/oversight*`) is limited to accounts flagged `isOversight`, which in turn cannot open any office area. Own-office data is computed live; the other offices are seeded in `apps/api/src/offices.ts` with their own processes, settings and metrics, labelled demo data. Harmonisation is comparison only: there is no "adopt" action yet. The reference model is fixed in code and cannot be edited in the UI.

## Staff access

Staff sessions are kept in the store. Every `/office/*` route needs a session, the process builder and the mutating rule and setup routes need builder access, and `/office/staff*` needs an administrator (`onRequest` hook in `app.ts`). The menu hides what a user cannot use, but the API is what enforces it.

## Reading documents

`apps/api/src/extraction.ts` has one entry point, `readConfigured`: the office chooses a method per document type (`OfficeConfig.extraction`, with a default for unrecognised files) and a confidence threshold. Methods: `builtin` (template reader), `ai` (a model reads the PDF or image and returns JSON for the confirmed fields: value, confidence and page per field; unknown fields are dropped and an empty value never counts as confident), and the placeholders `ocr_rules` and `external`, which fall back to the built-in reader and record a note. `ai` without a key is simulated with the built-in reader, and an AI error falls back the same way. Each result carries `engine`, per-field `confidence` and `pages`, and `needsReview` when a field is below the threshold.

The builder's "Read documents" step re-reads documents with the chosen method (or the per-type setting) and branches to `clear` or `review`. `review` leads to the "Review fields" step, where the process waits until a caseworker has corrected the doubtful fields on the case screen (`POST /office/cases/:id/review`). Approving or rejecting is blocked while fields await review. The estimate treats an unreadable amount as unknown until it is corrected.

To add a real OCR or external extractor, implement it next to `aiExtract` and return the same `{ kind, extraction }` shape; nothing else changes.

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
| Reading documents into fields | Method chosen per document type. Built-in template reader by default; AI reading calls a real model when a key is set, otherwise it is simulated. Doubtful fields are always checked by a person. |
| Rule checks, estimate, letter analysis | No. Deterministic code. |
| Question assistant | Default: keyword retrieval over a curated list of entries, each with its source. Optional live model call that may only use those entries and must name the ones it used. Sources come from the entries, never from the model's text. Falls back to retrieval on any error. |
| Drafting a mail to the student (builder step "AI drafts e-mail") | Simulated: a template built from the open items, in the student's language. A real model call would replace `draftMail`. Marked "AI draft" wherever it is shown. |
| Drafting a rule | One rule in the seed is marked as AI-drafted and waits for approval. There is no live drafting in the prototype. |
| Decisions | Never. A caseworker decides. |

## Persistence

`apps/api/src/store.ts` keeps everything in `apps/api/data/store.json` plus `data/uploads/`. `npm run reset-demo` deletes it and the next start reseeds. The routes only use the `Store` methods, so it can be replaced by a database.

## Before real data

- Data protection (GDPR/DSGVO): legal basis, minimisation, retention, deletion, encryption of documents at rest, audit log.
- Access control: students need a real login. Staff need real single sign-on instead of the demo sign-in, with audit logging of who changed which process. Parent links need expiry and one-time use. Today the case id is the only protection on the student side.
- Process changes: a second person should approve a changed process before it goes live (as rules are approved), and running cases should keep the version they started on.
- Real integration with the official portal and the case software.
- A real document reader with a human review step.
- Accessibility audit (BITV 2.0 / EN 301 549).
- A process for owning and updating the shared federal rule set after law changes.

Decisions are recorded in `docs/adr/`.
