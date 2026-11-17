# Demo script (5 minutes)

Everything runs locally with `npm run dev` at http://localhost:3000. Switch the language with the DE/EN toggle top right. Reset between runs: press the © in the footer five times quickly, or Shift+Alt+R.

Before you start: open http://localhost:3000/samples in a second tab and download the sample documents for **Mira Sommer** (the PDFs marked "for the student" and "for the parents", plus the corrected ones).

| Time | Screen | What to say and do |
|---|---|---|
| 0:00 | **Home** | The problem in one line: the first "documents missing" message comes after weeks, and students have to book flights without knowing the amount. |
| 0:20 | **Apply** | Press Shift+Alt+D to fill in Mira, then "Continue to documents". |
| 0:40 | **Documents** | Drag in the student PDFs. Point out that each file is recognised and read. Do not upload the host confirmation (it is missing in the sample). |
| 1:05 | **Parents** | Enter an e-mail, "Send link". Click "Open link as parent" and upload the two parent PDFs on the new page. The parent sees nothing else of the application. Go back to the student tab. |
| 1:50 | **Check now** | "Fix these items": the missing host confirmation and the parent signature, in plain words with the legal source. This took seconds instead of weeks. |
| 2:15 | **Fix** | Upload the corrected parent form and the host confirmation. The page turns to "Ready to submit". |
| 2:30 | **Estimate** | Show "likely about 350 € per month" with the breakdown and the one-off travel and tuition amounts. It is wording-wise never a decision. Submit. |
| 2:50 | **Status** | The case is "Received", with the history. |
| 3:00 | **Questions** | Click "Are tuition fees covered?". The answer names its source. Ask something off-topic: it says it does not know. |
| 3:25 | **Check my letter** | "Use sample letter". Explain how the amount came about. Set parents' income to 25 % higher: "Likely to be rejected". Show what would change it. |
| 3:55 | **Office → Inbox** | "For the office" at the top. Click "Simulate a new portal delivery": a new case arrives with its check already run. Open Mira's case. |
| 4:15 | **Caseworker** | Rule results, fields read from documents, estimate. "The software reads and applies fixed rules. You decide." Approve with the amount. |
| 4:35 | **Rules** | The AI-drafted rule "Insurance covers the destination country" waits for approval. Show plain text, the fixed check and the passing sample cases. Approve it. |
| 4:50 | **Insights** | Parent signature is missing in 28 % of cases, with a recommended form change. Close with: rules are federal and shared, each office configures only the local parts. |

Not shown but available: **Inputs & setup** (define expected inputs from a sample document, local settings).

## If something goes wrong

- Reset (see above) and start again.
- The question assistant works offline. The optional live AI needs `ANTHROPIC_API_KEY` in `.env`. Without it the checkbox is hidden and the answers come from the stored sources.
- Sample documents are generated with start dates a few months from today, so they stay valid whenever you present. Do not use an old downloaded copy after a reset on a different day.
