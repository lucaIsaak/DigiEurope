# DigiEurope: faster, clearer Auslands-BAföG

## The problem and the idea

DigiEurope tells students applying for Auslands-BAföG, German state funding for study or internships abroad, within minutes whether their application is complete. Today the first "documents missing" letter can take weeks, or months for spring starters. Students then get only a few days to reply, and they book flats and flights without knowing how much they will get.

The cause is on both sides. Applicants send incomplete files, such as a missing parent signature or an unsigned internship contract. Offices check every file by hand and find the gaps late. The prototype fixes the file before it is submitted, and it gives the office complete cases plus data on how to improve the form.

It is a class prototype for Applied Programming. The office ("Studierendenwerk Musterstadt"), the people and the data are all fictional.

## What it does

The product has two sides on one platform. The caseworker always makes the decision: the checks are fixed code, and AI only reads documents and drafts text.

| Side | Main features |
| --- | --- |
| Students | Apply and upload documents; get **Ready** or **Fix these items** with the official source for each; a non-binding monthly estimate; status tracking; a question assistant that cites its sources; a check of the last decision letter |
| Parents | Their own link to upload income documents, with no account and no view of the rest of the application |
| Caseworkers | An inbox of cases that are already checked; values read from documents; rule results; a decision with an explanation for the student and a technical record for audits |
| Process designers | A no-code rule editor (each change needs a second person to approve it); a drag-and-drop process builder with test runs; document templates; required inputs for each process |
| Oversight | Compares the same process across four fictional offices: structure, settings, metrics and a harmony score |

## How it is built

The project is a TypeScript npm workspace with three parts. It needs no database and no Docker.

- **Web** ([apps/web](apps/web)): a Next.js app for students and offices, in German and English, with light and dark mode. The process builder uses React Flow.
- **API** ([apps/api](apps/api)): a Fastify server that reads documents, holds the demo data and seeds about 40 sample cases.
- **Shared** ([packages/shared](packages/shared)): the rules engine, the estimate calculator, the letter analysis and the knowledge base for the question assistant.

The official portal, e-mail to parents and the connectors to office systems are simulated. Live AI is optional: it runs when an `ANTHROPIC_API_KEY` is set, and everything works offline without one.

## Run the demo

You need Node 22 or newer. Run `npm install`, then `npm run dev`, and open http://localhost:3000. The API runs on port 4000.

[docs/demo-script.md](docs/demo-script.md) is a 5-minute click-by-click walkthrough. Sample documents with typical mistakes, and their corrected versions, are at `/samples`. Staff sign in through "Staff login" in the footer. The demo accounts have no password.

## Measures and risks

A real pilot would track these numbers:

- The share of applications complete at the first check. It is about one in three in the demo data.
- The number of days from submission to decision.
- The number of "documents missing" rounds per case.
- Whether students' estimates turn out to be within range.

The main risks are rule changes after BAföG reforms, which rule versions and approvals handle. Others are students reading the estimate as a promise, messy real documents, data protection and integration with the real portal. The prototype uses no real personal data and has none of these protections.

More detail: [README.md](README.md) and [docs/discovery.md](docs/discovery.md).
