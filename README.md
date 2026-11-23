# Auslands-BAföG, faster and clearer

Class prototype (Product Management, NOVA SBE) for **Auslands-BAföG**, German student funding for studying or interning abroad. Students find out within minutes whether their application is complete, what to fix and what they will likely get. Offices get complete files, rules they approve themselves, and insights that improve the application form.

The product idea and the interview evidence are in [docs/Product-discovery.md](docs/Product-discovery.md). **Studierendenwerk Musterstadt is fictional.** All people, documents and statistics are made up, and no real authority branding is used. Do not use it with real personal data.

## Run it

Requires Node 22+ (`nvm use`). No database or Docker.
Use npm for setup and commands; the repository is configured as an npm workspace.

```sh
npm install
npm run dev          # builds shared code, starts API (:4000) and web (:3000)
```

Open http://localhost:3000. The API seeds about 40 demo cases on first start (stored in `apps/api/data/`).

```sh
npm run reset-demo   # deletes the demo data; the next start reseeds
npm test             # rules, estimate, API flows
npm run typecheck
npm run build
```

Optional live AI for the question assistant: copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without it everything works offline.

## What is in it

**Student side** (`/`)

| Screen | What it does |
|---|---|
| Apply (`/apply`) | Describe the stay (study or internship, country, dates, tuition fees) |
| My application (`/case/…`) | Upload documents (recognised and read automatically), invite parents, **Ready / Fix these items**, non-binding estimate, submit, status and history, and after the decision **why it was decided** |
| Parent link (`/parent/…`) | Parents upload their income documents with no account; they see nothing else |
| Track (`/status`) | Look up a case by reference and birth date |
| Questions (`/ask`) | General rule questions; every answer cites its official source and says when it does not know |
| Check my letter (`/letter`) | Upload the last decision letter: why the amount, whether the next application is likely reduced or rejected (for example when the one-year tuition supplement ends), and what would change it |

**Office side** (`/office`)

| Screen | What it does |
|---|---|
| Inbox | Applications arrive through the simulated official portal, each already checked |
| Case | Rule results, fields read from documents, estimate, and the **caseworker's decision** (request documents, approve, reject). Every decision has an **explanation for the student** (written by the caseworker or drafted from the calculation and confirmed) and a frozen **technical record** for audits: calculation step by step, every rule with version, result and approver, required inputs, how each document was read, process version and steps, legal basis; downloadable as JSON |
| Rules | A filterable list ("Needs attention" first). Each rule shows its plain-language text, readable sentences for what is checked (code in a "technical view"), sample cases, who wrote and approved it, and its version history. Process designers (and administrators) add a rule of the office with **New rule** (five steps: name, when it applies, what must be true, what the student sees, sample cases made automatically) and change a rule with the same no-code editor ("[document field] [is] [value]"); the change is saved as a new version, the live version keeps running, and **a second person must approve it** |
| Settings | Local office settings: reply target, reading method for unrecognised documents |
| Insights | Most frequent first-check issues and recommended changes to the application form |
| **Processes** (process builder) | A drag-and-drop canvas (React Flow) where the office draws its own process: trigger, rule check, AI steps (read documents, draft a mail), branches, routing to a team, "caseworker decides", messages and placeholder connectors to office systems (case software, e-file, payment, portal). Validate, **test-run on a sample case**, publish. The published process then really drives new applications |
| Templates | Grouped by category (official forms, study, work, money and family, insurance, office documents) with icons and colours. Click a template for its fields, how it is read (method and review threshold, set by the extractor owner), **Test & confirm** with a sample (a template must be confirmed before a process can require it) and its history. The library of forms the office can read (Formblatt 1, 3, **6**, **8**, enrolment certificate, and so on). A process designer can **add a template proposal** (name, title as printed, fields, signatures, optional sample PDF that suggests the fields). The **extractor owner** accepts it and decides how it is extracted, or rejects it with a comment. Nobody has to build the template from scratch |
| Required inputs (in the builder) | Per process: which forms and information the applicant must provide, each required or optional, with a condition (study only, internship only, only with tuition fees, or if an answer is "yes"). Custom questions are answered by the student on the case page. This drives the student's checklist and whether the application is ready, and is compared across offices |
| Access | Administrators grant access to the builder and to the extractor-owner permission |


**Process catalogue and comparison across offices.** Every process belongs to exactly one entry of a central catalogue (domain > service > variant, for example Student funding > BAföG > BAföG abroad: application). An office has one process per category and picks the category in the builder. The oversight account (Frau Weiß, "Aufsicht Bundesebene") sees all offices under `/oversight` and compares the same process across them: a structure diff with side-by-side pictures, a matrix of settings and connected systems, performance metrics, and a **harmony score** against a reference model (60 % process, 40 % settings and systems). The comparison is read-only. Three other Studierendenwerke (Nordhafen, Bergland, Rheinau) are fictional and seeded with different processes; Musterstadt is compared live.

**Staff access.** The office area needs a staff sign-in (footer link "Staff login"). Demo accounts: Frau Beispiel and Herr Kaya (caseworkers, no builder), Frau Lindner (process designer), Herr Obermeier (administrator, also grants builder access). The API enforces this, not just the menu. Demo sign-in has no password; a real system would use the administration's single sign-on.

The caseworker always decides. Checks are deterministic code; AI only reads documents and drafts mails (both simulated here) and helps draft rules.

## Look and feel

The office area is a quiet tool (white canvas, hairline dividers, tables, one accent, status as a dot). The student side follows a service-manual style: large left-aligned type, one column, underlined links, square controls and a thick yellow focus ring. Colours are used for status only.

## Demo

[docs/demo-script.md](docs/demo-script.md) is a 5-minute click-by-click script. Sample documents with typical mistakes (missing parent signature, missing host-university confirmation, unsigned internship contract) and the corrected versions are at `/samples`, linked in the page footer.

Light and dark mode: the toggle (sun/moon) is in the header. It follows the system setting until you choose, then remembers the choice.

Hidden demo helpers: press © in the footer five times (or Shift+Alt+R) to reset the demo; Shift+Alt+D on the apply page fills in the sample student.

## Structure

- `packages/shared`: types, the **rules and engine**, estimate calculator, letter analysis, question knowledge base
- `apps/api`: Fastify API, document reader, sample documents, demo data
- `apps/web`: Next.js app. Copy (DE/EN) in `src/lib/messages.ts`
- `docs/`: discovery, [rules and sources](docs/bafoeg-rules-sources.md), architecture, demo script, ADRs

## What is simulated

- **Document reading**: the built-in reader parses only the prototype's own sample PDFs, and other files are reported as unreadable. "AI document reading" calls a real model when `ANTHROPIC_API_KEY` is set and is simulated with the built-in reader otherwise. OCR with rules and the external service are placeholders that fall back to the built-in reader and say so.
- **Official portal**: a button creates a delivery.
- **E-mail to parents**: the link is shown on screen.
- **Live AI**: optional and off unless a key is set.
- **Login**: a demo staff sign-in with roles and no password. The student side has no login.
- **Connectors**: placeholders with sample responses; no real system is called.
- **Figures**: statutory amounts are taken from the law text ([sources](docs/bafoeg-rules-sources.md)). Country surcharges and some deductions are illustrative and labelled so.
