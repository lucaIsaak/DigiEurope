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

`compare.ts` makes processes comparable without caring about local wording: `stepSignature` reduces a step to its kind plus the settings that change its meaning (connector system and action, condition field, reading method, notification recipient). Team names, texts and subjects are ignored. `diffProcesses` compares the multisets of step signatures and of connections (step, output, next step) with a Jaccard measure and reports what exists only on one side; `compareSettings` compares approved rules, the reading method per document type, connected systems, reply target and languages; `harmony` combines them (50 % process, 25 % settings and systems, 25 % required inputs) against a reference model (`referenceProcess`, `REFERENCE_SETTINGS`).

The oversight area (`/oversight*`) is limited to accounts flagged `isOversight`, which in turn cannot open any office area. Own-office data is computed live; the other offices are seeded in `apps/api/src/offices.ts` with their own processes, settings and metrics, labelled demo data. Harmonisation is comparison only: there is no "adopt" action yet. The reference model is fixed in code and cannot be edited in the UI.

## Staff access

Staff sessions are kept in the store. Every `/office/*` route needs a session, the process builder and the mutating rule and setup routes need builder access, and `/office/staff*` needs an administrator (`onRequest` hook in `app.ts`). The menu hides what a user cannot use, but the API is what enforces it.

## Explainability of decisions

Every approval or rejection stores two things on `Decision` (`packages/shared/src/types.ts`):

- `note`: the human explanation the student receives. The caseworker writes it or drafts it from the calculation (`draftExplanation`, deterministic, no AI) and edits it. An approval with an empty text gets the drafted one, so no decision goes out without an explanation.
- `audit` (`AuditRecord`): frozen at the moment of the decision by `buildAudit` in `apps/api/src/cases.ts`, and refreshed once more after the process has run its remaining steps. It holds the calculation step by step (`explainEstimate`), every live rule with its version, result (met, not met, not applicable) and approver, the required inputs and their state, each document with reader, lowest confidence and whether it was flagged for review, the process id, version and run log, the person who decided, and the legal sources. Later rule or process changes do not alter it.

`GET /office/cases/:id/explanation?outcome=&amount=&lang=` returns a draft explanation; `GET /office/cases/:id/audit` returns the record as a JSON download. The office case page shows both under "Decision and explanation"; the student page shows the explanation.

## Rule versions and the two-person rule

Rules live in the store with a lifecycle (`RuleStore`): the live version that runs, an optional draft waiting for approval, a paused flag and the earlier versions, each with author, approver and dates. The web editor writes conditions as lines of "[fact] [operator] [value or other fact]" (`packages/shared/src/conditions.ts`: `toCheck`, `fromCheck`, `factCatalog` built from the templates, `describeRuleCondition` for readable sentences). Saving creates a new draft version; the live version keeps running. Approval needs a different person than the author and passing sample cases. Every built-in rule round-trips through the editor (tested).

## Templates, proposals and required inputs

`packages/shared/src/templates.ts` lists the built-in `DocumentTemplate`s: title as printed (the reader recognises a form by it), fields with types, signatures, who provides it, and a purpose. The reader (`documents.ts`) is data-driven: it reads built-in templates plus the templates accepted from proposals, so a new form needs no code. How a template is read (method, confidence) is configured separately (`OfficeConfig.extraction`), by the extractor owner.

Templates carry a category (official form, study, work, money and family, insurance, office document). A template must be tested with a sample and confirmed (`OfficeConfig.templateChecks`, by the extractor owner) before a process can require it; changes to how it is read and confirmations are logged per template. A process designer files a `TemplateProposal` (draft, submitted). A sample PDF can be attached: `suggestTemplateFromLines` reads "label: value" lines and proposes the fields, types and signatures (a heuristic stand-in for an AI suggestion). A staff member with `canApproveTemplates` (granted by an administrator; administrators can always) accepts it, choosing the reading method and confidence, which creates the template and makes the reader recognise it, or rejects it with a comment. The author can then change and resubmit.

Every `ProcessDef` has `inputs`: documents (template ids) and information (known application fields or custom questions), each required or optional, with an optional condition (study, internship, tuition fees, or a yes answer to a custom question). `computeRequirements` evaluates them for an application, and `runChecks` reports a missing required input as a blocker (unless a rule already reports that document). Custom answers are stored on the application (`info`). The student's checklist, the readiness check and the oversight comparison all use the same inputs. Harmony is 50 % process, 25 % settings and systems, 25 % required inputs.

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


## Outputs between steps

Every step of a process can hand named results to the steps after it (`STEP_OUTPUTS` in `packages/shared/src/process.ts`): the review step hands on a brief list of unclear fields and the reasons, the rules step the open items and missing documents, the decision step the explanation and amount, a system connector the ID the system returned, and so on. A later step in the same branch puts them into any of its texts (subject, message, note for the caseworker, compare-to value, data sent to a system) as a coloured tile. Stored, a tile is `{stepId.output}`, so two steps of the same kind never get mixed up; `{name}`, `{reference}` and `{amount}` are always available. The engine keeps the results with the case (`flow.vars`), so they survive the waits for a person, and "Validate" reports a tile whose step is not connected before the step that uses it.


## What makes a process trustworthy

The builder borrows from tools like Power Automate and Make, and deliberately fixes what goes wrong in them.

- **Named steps.** Every step has a required, unique name and a one-line purpose. Texts refer to a step by a stable id, so renaming or moving a step never breaks them.
- **Typed outputs.** An output is text, a number, a list, a date or yes/no. A list can be shown as bullets, one line, a count or its first item (`{step.output:count}`), and a condition refuses a text where it needs a number.
- **Data inspector.** Every step records what it produced (`RunLogEntry.outputs`). The test run and the case page show it per step.
- **No silent failures.** A step whose output leads nowhere, an unreachable connection, a missing template or a loop stops the process with an error (`flow.failed`). The case shows as "Process stopped" in the Inbox and a caseworker can try again at the step that failed. System connectors have an optional "error" output and a retry count.
- **Explicit steps.** "Check required inputs" is a step of its own; "Request documents" takes the AI draft only if its text says so, by putting the draft in as a tile.
- **Message templates.** Messages to applicants are written, translated and approved by a second person once (`Templates › Messages`). A step picks a template and binds each of its parameters to a tile. The system adds greeting and sign-off.
- **Real timers.** A "Deadline / reminder" step holds the process until its time is up (`flow.waitUntil`). A timer runner checks every minute; the demo menu can skip days. New documents from the applicant start the process again.
- **Test cases.** A process carries samples (which steps a case must pass, where it must stop). They run before every publish and can be saved from a test run.
- **Impact.** Before publishing, the dialog shows the changes against the live version, the rules, templates, forms and systems the process depends on, the owner and a required reason.
- **Typed settings.** Each kind of step declares its settings (`NODE_CATALOG`); the validation rejects unknown settings and values that do not fit.
- **Connections belong to the office.** Each system has one connection that administrators manage (on or off, sandbox or live, last test), independent of who built the process.

## Functions in texts (expressions)

Every free-text field of a step can hold functions next to the output tiles. The pane beside the inspector has two tabs: **Outputs** and **Functions**. A function is a purple "ƒ" tile; clicking it opens its slots, and each slot can hold text, output tiles or other functions (nested).

- Stored as `{=name|slot|slot}`; `\| \{ \} \\` escape special characters inside a slot. Code: `packages/shared/src/expressions.ts` (parser, ~80 functions, evaluator, validation); tests in `expressions.test.ts`.
- Families: text (split, pieces, left/right/mid, before/after/between, replace, upper/lower, pad, mask, slug …), maths (calc, add … round, min/max/sum/average, percent, euro), converters (toText, toNumber, toInteger, toBoolean, toList, toDate), dates (now, addDays, formatDate, daysBetween …), logic (if, coalesce, equals, and/or/not, lookup), lists (count, first, join, sort, unique …), random and ids.
- Results are typed: a single output or function keeps its type (a list stays a list), so a condition can compare a number.
- Random: `randomId`, `randomNumber`, `guid` generate **once per case** and are stored in `Application.randoms`, so re-running the same case keeps the value. The `…Run` variants (`randomIdRun` …) generate a new value for every run, still per case.
- A function that cannot be calculated stops the step with a message (same failure/retry path as other step errors). Validation in `validateProcess` flags unknown functions, missing slots and non-numeric condition values before publishing.
- The editor shows a live result using the example values of the outputs.

## Condition steps, HTTP requests, comments and AI documentation

- **Condition is a step of its own.** "Read documents" has one output and hands on `read_result` (`valid` / `invalid`). A "Condition" step compares any tile (for example `read_result` equals `valid`) and branches yes/no. Older processes that branched inside "Read documents" (clear / review) are rewritten on load by `upgradeReadBranch`, which inserts the condition step. Conditions on values of the application still work (`field` other than `custom`).
- **HTTP request (API).** Method, URL, headers and body can hold tiles and functions. The server's client (`apps/api/src/http.ts`) allows http/https only, no redirects, 10 s, 1 MB, and refuses addresses inside a network (except the prototype's own `/demo-api/exchange`, a fake nested answer). Status 400+ or a timeout follow the "error" output like a system connector (retries, simulate).
- **JSON picker** (`packages/shared/src/json.ts`, `JsonPicker.tsx`). Get a sample answer (or paste one), tick fields; each pick is `{name, path, type}` with a path such as `data.rates[0].value` or `data.rates[*].currency` (all items, a list). The paths are what the process runs, so nobody writes extraction code; a missing field stops the step and names the path. Each pick is an output of the step (`{stepId.name}`), typed so numbers stay numbers.
- **Comment and rename.** Every step has a name and a comment. Texts refer to steps by an invisible id, so a rename never breaks a tile. After a rename the builder lists where the step's tiles are used and where the old name is written out as plain text (names, purposes, comments, texts) and offers to update those; renaming a picked field offers to update its tiles downstream (`renameImpact`, `renameOutputTokens`).
- **AI documentation** (simulated; `documentation.ts`, `POST /office/processes/document`). It reads names, comments and connections and proposes a name (only for steps nobody renamed) and a comment (mentioning neighbours by their names). Per step the person chooses: use the AI version, merge (only when the step has its own name and a comment; keeps the person's text and adds what the AI says beyond it) or reject. Nothing changes without that decision.

## Process from a description

Builder › "Describe a process": a person writes in plain language how a case should run and which rules apply; a proposal of steps and connections comes back. It is only a proposal: nothing is saved or published until the person places it on the canvas (undoable), checks it, and saves.

- **One vocabulary, two writers.** A writer produces a `ProcessDraft` (steps, connections, what it understood, what it could not map). `draftToProcess` (`packages/shared/src/generate.ts`) is the single gate: unknown step types, settings and options are dropped and reported, defaults are filled in, names made unique, one start added if missing, then `validateProcess` runs. So neither writer can put anything on the canvas that a hand-drawn process could not contain.
- **Simulated writer** (`simulateDraft`, offline, the default). Reads sentence by sentence. Understands: steps (read documents, check completeness, check rules, assign team or caseworker, wait N days, AI-drafted mail, ask the applicant, send a message, payment/case/e-file systems, an `https://` URL as an HTTP request, caseworker decides, reject, end), branches ("if … , …, otherwise …", "… if …", "unless"), conditions on funding, tuition, weeks or months abroad, stay type, country, EU, source, readable documents, and on outputs of earlier steps ("if something is missing", "if the rules are not met", "if rejected/approved"). Anything else is listed under "could not turn into steps", never guessed.
- **Rules.** A sentence with "must/should/required" is matched to the already approved rules (`RULES`) and ticked in one "Run approved rules" step. A requirement that matches no rule is reported: writing, testing and approving a new rule stays a separate, human step under Rules.
- **Live writer** (`apps/api/src/generator.ts`, optional). Set `ANTHROPIC_API_KEY` (and optionally `PROCESS_AI_MODEL`); the panel then offers "Live AI". The model gets `generationPrompt()` (every step type with its outputs and settings, the approved rule ids) and must answer with the draft JSON. If the builder would report problems, the model is told once and may correct itself. Any failure falls back to the simulated writer and says why. Without a key the option is disabled and the API never makes an outside call.
- **API.** `GET /office/processes/generate/info` (is live available), `POST /office/processes/generate` `{description, mode}` → nodes, edges, understood, unmapped, issues, mode, fellBack. Builder permission is required like for every `/office/processes` route.
