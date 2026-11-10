# DigiEurope

Prototype of a platform that digitalises public administration services, starting with the **address registration (Anmeldung)** for newcomers in Germany. The product idea and research are in [docs/Product-discovery.md](docs/Product-discovery.md).

The prototype is a **pre-checking layer in front of the existing Bürgeramt**: applicants fill in a guided, bilingual form that is checked instantly, the landlord confirms online, and a caseworker decides on a complete application. Musterstadt is a fictional pilot city.

## Run it

Requires Node 22+ (`nvm use`). No database or Docker is needed for the prototype.

```sh
npm install
npm run dev          # builds shared types, starts API (:4000) and web (:3000)
```

Open http://localhost:3000. The API seeds ~45 demo cases on first start (stored in `apps/api/data/`). `npm run reset-demo` deletes them; the next start seeds fresh data.

Checks: `npm run typecheck`, `npm test`, `npm run build`.

## Demo walkthrough (5 minutes)

The dark bar at the top switches between the three views.

1. **Citizen** → *Start registration* → *Continue with passport*. Fill in a non-EU nationality (e.g. India). The **instant check** on the right lists exactly what is missing.
2. *Landlord* step → *Ask my landlord to confirm online* → *Send request*. Open the demo link (it stands in for the e-mail) and confirm as the landlord. The applicant's page updates by itself.
3. Upload any PDF/JPG/PNG for passport and visa, then *Check and send*. You land on the **status page** (it refreshes live).
4. **Caseworker** → open the new case → *Book express ID check*. The citizen sees the appointment and can add it to their calendar. Then *Passport checked, register* → the citizen gets the (watermarked) registration certificate and a "what's next" list.
5. Try *Request information* with a message: the citizen sees it, updates the application and resubmits.
6. **City dashboard**: complete-at-first-submission rate, days to decision and an estimate of freed counter hours with editable assumptions.

The eID path (*Online ID* → choose a test identity) shows the fully online variant: personal data arrives verified and locked, and the caseworker can register directly.

## How the discovery maps to the prototype

| Finding (docs/Product-discovery.md) | In the prototype |
|---|---|
| Anmeldung blocks everything after it (Priya) | Anmeldung first; landing page and "what's next" make the dependency explicit |
| Landlord confirmation is a common blocker | Landlord confirms via link, no paper; confirmation is invalidated if address or date change |
| "I need to know where it is" (Mateo) | Status page with timeline, messages, live refresh; lookup by reference + birth date |
| German-only forms | DE/EN UI in plain language; caseworker sees the application language |
| 1 in 3 appointments end with something missing (Frank) | Rule-based pre-check blocks submission until complete; caseworker sees it was pre-checked |
| Must fit existing case software | JSON hand-over export per case (XMeld / FIT-Connect mapping still to do) |
| Buyer pays for measurable results (Möller) | Dashboard: first-time-complete rate, days to decision, counter-hours estimate |
| Trust: reuse the official ID login (Anna) | Simulated eID login with verified, locked fields; passport path for newcomers without eID |

## Structure

- `packages/shared` – domain types, the **pre-check rules** (`precheck.ts`) and patch logic, shared by API and web
- `apps/api` – Fastify API: applications, documents, landlord confirmation, caseworker actions, metrics, demo seed
- `apps/web` – Next.js app: citizen flow, landlord page, caseworker queue, city dashboard. Copy in `src/lib/messages.ts`
- `docs/` – discovery, architecture notes and ADRs

## What is simulated

- **eID / BundID login**: two fictional test identities. No real identity check.
- **E-mail to the landlord**: the link is shown to the applicant instead of being sent.
- **Caseworker and dashboard**: no login. Anyone who can reach the server can act as caseworker.
- **Storage**: JSON file plus upload folder, no encryption or retention rules.
- **Certificate**: a watermarked specimen, never an official document.

Do not use it with real personal data. See [docs/architecture.md](docs/architecture.md) for what has to change before that.
