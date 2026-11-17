# Product discovery: faster, clearer Auslands-BAföG

Class prototype for Product Management at NOVA SBE. Everything here is a hypothesis or a design decision, not a finding about a real authority.

## 1. The problem in 60 seconds

Students who want to study or do an internship abroad apply for **Auslands-BAföG**, German state funding for stays abroad. The application is slow and uncertain for the student:

- The first message "documents missing" arrives after **weeks**, for students starting in spring sometimes after **months**.
- They then get only a **few days** to respond.
- The office is **hard to reach** while the case is open.
- Students have to **book flats and flights without knowing** how much they will get.

The causes sit on both sides. Applicants submit incomplete or wrong documents (a missing parent signature, no confirmation from the host university, an unsigned internship contract). The office finds this out late, because every application is checked by hand and the office is short of staff.

## 2. Evidence from student interviews

| Observation | What it means for the product |
|---|---|
| First "missing documents" message comes after weeks, months for spring starters | Tell the student what is missing **within minutes**, before submitting |
| Only a few days to respond | Fix everything before it is submitted, so there is nothing to chase |
| Office hard to reach | A status page and a question assistant that cite the official source |
| Flat and flight booked without knowing the amount | A **non-binding estimate** ("likely"), with the reasoning shown |

## 3. The concept

Two sides on one platform.

**Student side (the demo's main flow)**

1. Start an application, describe the stay, upload documents. Parents upload their income documents through their own link.
2. Within minutes: **"Ready"** or **"Fix these items"**, each item in plain language with the official source.
3. A **non-binding monthly estimate**, always worded as "likely", never as a decision.
4. **Status tracking** of the case.
5. A **question assistant** for general rule questions. Every answer names the official source, and it says so when it does not know.
6. A **follow-up check**: upload the last decision letter, see why the amount is what it is, whether the next application is likely to be reduced or rejected (for example when the one-year tuition supplement ends), and what would change that.

**Office side (the platform underneath)**

- **Rules** are written once in plain language, turned into fixed executable checks, tested against sample cases and **approved by the office** before use. Rules are shared across offices (BAföG is federal law). Each office only sets local things: accepted documents, workflow, language, reply target.
- The office **defines expected inputs** by uploading sample documents and reviewing the extracted fields.
- Applications arrive through an **integration with the official online portal** (simulated in the prototype).
- A **dashboard** turns frequently missing documents into recommendations to improve the application form itself.
- **The caseworker always makes the final decision.** AI only reads documents into fields, translates and helps write rules. The checks themselves are deterministic.

## 4. Principles

1. **No automated decisions.** The software checks completeness with approved rules and shows an estimate. A person decides.
2. **Deterministic checks.** Same input, same result, every time. AI is not in the checking path.
3. **Every claim has a source.** Rules and answers link to the law or the official information they come from.
4. **Plain language first.** Rules are written for people, then compiled.
5. **Fix the form, not only the file.** The most useful output for the office is what keeps going wrong, so the form can be changed.

## 5. Who benefits

| Who | Gain |
|---|---|
| Students | Know what is missing in minutes, plan housing and flights, less chasing |
| Parents | One clear task with their own link, no account, nothing else of the application visible |
| Caseworkers | Complete files, extracted fields, rule results with reasons, time for the actual decision |
| The office (buyer) | Fewer rounds of "documents missing", measurable first-time-complete rate, form improvements |
| Other offices | Reuse the federal rule set, configure only the local parts |

## 6. Success measures (for a real pilot)

- Share of applications complete at the first check (demo data: about a third, the target is to raise it with form changes).
- Days from submission to decision.
- Number of "documents missing" rounds per case.
- Share of students who book flat and flight after seeing the estimate and later find the estimate within range.

## 7. Risks and open questions

- **Rules drift.** BAföG amounts change with reforms. Rules carry a version and an approval, so the office can see and re-approve changes. Who owns the shared federal rule set is an organisational question.
- **Estimate misread as a promise.** Mitigated by wording, by showing the reasoning, and by the range.
- **Reading documents.** Real documents are messy. The prototype reads only its own sample document types. A real system needs an extraction service, human review of low-confidence fields and an error rate target.
- **Data protection.** Real personal and income data needs a legal basis, retention rules, encryption and access control. The prototype uses none.
- **Integration.** The real portal has its own interfaces and data formats. The prototype only simulates delivery.

## 8. What the prototype shows

See the [demo script](demo-script.md). Everything is fictional: "Studierendenwerk Musterstadt", the people, the documents and the statistics. No real authority branding is used.
