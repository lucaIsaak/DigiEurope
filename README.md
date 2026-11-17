# Auslands-BAföG, faster and clearer

Class prototype (Product Management, NOVA SBE) for **Auslands-BAföG**, German student funding for studying or interning abroad. Students find out within minutes whether their application is complete, what to fix and what they will likely get. Offices get complete files, rules they approve themselves, and insights that improve the application form.

The product idea and the interview evidence are in [docs/Product-discovery.md](docs/Product-discovery.md). **Studierendenwerk Musterstadt is fictional.** All people, documents and statistics are made up, and no real authority branding is used. Do not use it with real personal data.

## Run it

Requires Node 22+ (`nvm use`). No database or Docker.

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
| My application (`/case/…`) | Upload documents (recognised and read automatically), invite parents, **Ready / Fix these items**, non-binding estimate, submit, status and history |
| Parent link (`/parent/…`) | Parents upload their income documents with no account; they see nothing else |
| Track (`/status`) | Look up a case by reference and birth date |
| Questions (`/ask`) | General rule questions; every answer cites its official source and says when it does not know |
| Check my letter (`/letter`) | Upload the last decision letter: why the amount, whether the next application is likely reduced or rejected (for example when the one-year tuition supplement ends), and what would change it |

**Office side** (`/office`)

| Screen | What it does |
|---|---|
| Inbox | Applications arrive through the simulated official portal, each already checked |
| Case | Rule results, fields read from documents, estimate, and the **caseworker's decision** (request documents, approve, reject) |
| Rules | Plain-language rules, the fixed check that runs, sample cases, approval. Federal rules are shared; offices only set local things |
| Inputs & setup | Define expected inputs by uploading a sample document and confirming the fields read; local settings |
| Insights | Most frequent first-check issues and recommended changes to the application form |
| **Processes** (process builder) | A drag-and-drop canvas (React Flow) where the office draws its own process: trigger, rule check, AI steps (read documents, draft a mail), branches, routing to a team, "caseworker decides", messages and placeholder connectors to office systems (case software, e-file, payment, portal). Validate, **test-run on a sample case**, publish. The published process then really drives new applications |
| Access | Only administrators grant access to the builder |

**Staff access.** The office area needs a staff sign-in (footer link "Staff login"). Demo accounts: Frau Beispiel and Herr Kaya (caseworkers, no builder), Frau Lindner (process designer), Herr Obermeier (administrator, also grants builder access). The API enforces this, not just the menu. Demo sign-in has no password; a real system would use the administration's single sign-on.

The caseworker always decides. Checks are deterministic code; AI only reads documents and drafts mails (both simulated here) and helps draft rules.

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

- **Document reading**: parses only the prototype's own sample PDFs. Other files are reported as unreadable.
- **Official portal**: a button creates a delivery.
- **E-mail to parents**: the link is shown on screen.
- **Live AI**: optional and off unless a key is set.
- **Login**: a demo staff sign-in with roles and no password. The student side has no login.
- **Connectors**: placeholders with sample responses; no real system is called.
- **Figures**: statutory amounts are taken from the law text ([sources](docs/bafoeg-rules-sources.md)). Country surcharges and some deductions are illustrative and labelled so.
