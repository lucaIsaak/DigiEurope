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
| 3:55 | **Office → Inbox** | Footer link "Staff login", sign in as **Frau Beispiel** (caseworker; note there is no "Processes" in the menu). Click "Simulate a new portal delivery": the case arrives and the process has already asked for the missing documents with an AI-drafted mail. Open it and show "Process of this case". Open Mira's case. |
| 4:15 | **Caseworker** | Rule results, fields read from documents, estimate. "The software reads and applies fixed rules. You decide." Click "Approve", then "Draft from the calculation": the explanation for the student appears and can be changed. Approve. The case now shows **Decision and explanation**: "For the student" is the text Mira receives, "Technical record" lists the calculation step by step, every rule with its version and who approved it, the inputs, how each document was read, the process steps and the legal basis. "Download record (JSON)" for an audit. |
| 4:35 | **Rules** | The top bar shows a badge: one rule waits. "Needs attention" lists the AI-drafted rule "Insurance covers the destination country": plain text, what is checked as sentences, sample cases, who wrote it. Approve it. Optional: "Change rule" on another rule shows the no-code editor; the author cannot approve their own change. |
| 4:45 | **Processes** | Sign out, sign in as **Frau Lindner** (process designer). The canvas shows the office's own process: rule check, AI drafts mail, caseworker decides, payment connector. Drag a "Condition" onto the canvas, connect it, "Validate", then "Run test" on a sample case. Say: the office draws this itself, and connectors to its own systems plug in later. Herr Obermeier (administrator) decides who gets this access. |
| 4:50 | **Insights** | Parent signature is missing in about a third of cases, with a recommended form change. Close with: rules are federal and shared, each office configures only the local parts. |

Optional extra (about 60 seconds), templates: sign in as **Frau Lindner** (process designer) and open "Templates". Formblatt 6 and 8 are ready. Click "+ Add a new template proposal", drop the sample "Formblatt 7" from `/samples`: the fields are suggested. Submit. Sign in as **Frau Richter** (extractor owner), open the proposal, accept it and choose the reading method. In the builder, "Inputs" now lists it as a form the process can require.

Optional extra (about 45 seconds): sign in as **Frau Weiß** (oversight). The catalogue lists every process category. Open "BAföG abroad: application": four offices side by side with a harmony score. Open the process tab, compare the reference with Nordhafen, then the settings tab for the matrix of rules, reading methods and connected systems.

Optional extra (about 30 seconds): download the **Paul Neumann** sample set. One income amount on the tax notice is smudged, so after submitting, the process stops at "Review fields". In the office, open the case, correct the amount and confirm. The process continues.

Not shown but available: any decided case in the Inbox ("Decided" tab) has the same explanation and technical record; the student sees the explanation on "My application". The account icon (top right) holds light/dark mode, demo tools and sign-out; the globe switches the language. **Access** and **Settings** (administrator), **Templates** › a template › Test & confirm (define expected inputs from a sample document, local settings).

## Demo: one unclear field, the caseworker answers it, approval, message to the applicant (about 4 minutes)

Before: reset the demo (the letter table goes back to its defaults; the demo data, sample documents and process texts are in English, and the interface starts in English). Then open http://localhost:3000/samples and download the **Paul Neumann** set: English PDFs for the student and the parents, where the tax notice has one smudged amount ("illegible"). The reader recognises the English and the German versions of every form.

Everything is shown as **Herr Obermeier** (administrator). He can work cases, see the process builder and change the settings, so you never have to switch users.

1. **Show the process and split the cases (60 s).** Sign in as Herr Obermeier, open "Processes". Walk along the canvas: Application arrives, **Assign caseworker**, Read documents, Run approved rules, Caseworker decides, payment, message to the student. Click "Assign caseworker": the table says who gets which letters. Change "M–R" to **M–M Frau Demir** and add **N–R Herr Obermeier**, then "Save". Say: the office decides the split itself, and Paul Neumann (N) will now land with Herr Obermeier. Click "Run approved rules" to show which rules are ticked.
2. **Test it first (45 s).** Press "Test run", pick the sample "Unclear scan" and run it. The path stops at **Review fields**. Choose "confirmed" and run again: it continues to the caseworker. Say: this is how an office checks a change before publishing.
3. **The applicant (60 s).** On the student site, open Apply and press Shift+Alt+P (fills in Paul). Upload Paul's student documents, then the parents' two through the parent link, and submit.
4. **The caseworker (60 s).** Back in the office as Herr Obermeier: Inbox, "My cases". The case is his. It shows **Check fields**: the amount "54?00 (unleserlich)" next to the document. Type 54000 and press "Confirm fields". The estimate stops being provisional. Open "Process of this case" to show where it stands.
5. **Approve (45 s).** "Approve", "Draft from the calculation", approve. The case shows "For the student" and the "Technical record" (calculation, rules with versions, how each document was read).
6. **The applicant sees it (30 s).** On the student site, "My application" shows the decision and the explanation. In the case's process panel, the sent message is listed.

Alternative for step 4: if the amount is too unclear to read, use "Request documents" instead. The message is prefilled from the unclear document; the caseworker sends it and the case waits for the student.

## If something goes wrong

- Reset (see above) and start again.
- The question assistant works offline. The optional live AI needs `ANTHROPIC_API_KEY` in `.env`. Without it the checkbox is hidden and the answers come from the stored sources.
- Sample documents are generated with start dates a few months from today, so they stay valid whenever you present. Do not use an old downloaded copy after a reset on a different day.

## Optional extras: why this builder is safer than a generic one

- **Data inspector (30 s).** In "Processes", press "Test run", choose "Unclear scan". In the steps list open "Data" under "Review unclear fields": the brief list and the reasons the step handed on. Say: every step shows what it produced, so a wrong message can be traced to its source.
- **Test cases (30 s).** Press "Test cases (5)", then "Run all". Change a step, for example remove "Check required inputs", and run again: a case fails with the reason. Publishing is blocked until the samples hold or are changed on purpose.
- **Publish (30 s).** Press "Publish": test cases, what changes against the live version, the rules, message templates and systems the process depends on, owner and a required reason.
- **Failure (45 s).** In "Settings › Connections to systems" switch the payment connection off, approve a case: it stops with "The process stopped", visible in the Inbox. Switch the connection on and press "Try again": it carries on at the payment step and sends the approval message.
- **Timer (30 s).** Ask a question about an unclear field (see above). The case shows "The process is waiting". Account menu › "Skip 7 days (demo)": the reminder goes out.

## Language

The interface, the demo data (students, universities, courses), the sample PDFs, the process texts (approval and rejection messages, notes for the caseworker) and the staff titles are in English by default. The DE/EN toggle switches the interface and the samples page; messages to an applicant follow the language of that application. Not translated: the sample decision letter for "Check my letter" (it mirrors a German decision notice) and the legal sources, which are German law.
