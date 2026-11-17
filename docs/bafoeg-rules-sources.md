# Rules and sources

Every rule and number in the prototype, with where it comes from. "Verified" means I read the text of the linked page while building this. "Illustrative" means we made the value up (or simplified it) for the demo and it is labelled that way in the UI.

## Verified against the law text

| Fact | Value | Source |
|---|---|---|
| Basic need, university students | 475 € / month | [§ 13 BAföG](https://www.gesetze-im-internet.de/baf_g/__13.html) |
| Housing, not living with parents | 380 € / month | [§ 13 BAföG](https://www.gesetze-im-internet.de/baf_g/__13.html) |
| Health insurance supplement (statutory, compulsory) | 102 € health + 35 € care / month | [§ 13a BAföG](https://www.gesetze-im-internet.de/baf_g/__13a.html) |
| Health insurance supplement (voluntary) | 185 € + 48 € / month | [§ 13a BAföG](https://www.gesetze-im-internet.de/baf_g/__13a.html) |
| Parents' income allowance | 2,540 € (married) / 1,690 € per parent (otherwise) | [§ 25 BAföG](https://www.gesetze-im-internet.de/baf_g/__25.html) |
| Allowance per further child | +770 € | [§ 25 BAföG](https://www.gesetze-im-internet.de/baf_g/__25.html) |
| Share of the excess not counted | 50 %, plus 5 % per child | [§ 25 BAföG](https://www.gesetze-im-internet.de/baf_g/__25.html) |
| Income year that counts | second-to-last calendar year before the funding period starts | [§ 24 BAföG](https://www.gesetze-im-internet.de/baf_g/__24.html) |
| Update application if income is now much lower | "wesentlich niedriger" (no number in the law text) | [§ 24 Abs. 3 BAföG](https://www.gesetze-im-internet.de/baf_g/__24.html) |
| Funding starts | earliest in the month of application | [§ 15 BAföG](https://www.gesetze-im-internet.de/baf_g/__15.html) |
| Tuition fees abroad | up to 5,600 € for at most one year; waiver or reduction must have been tried | [AuslandszuschlagsV § 3](https://www.gesetze-im-internet.de/baf_gzuschlagsv/BJNR009350986.html) |
| Travel lump sum | 250 € per trip within Europe, 500 € elsewhere (outbound and return) | [AuslandszuschlagsV § 4](https://www.gesetze-im-internet.de/baf_gzuschlagsv/BJNR009350986.html) |
| Health insurance supplement abroad | amount from § 13a, proof of insurance needed | [AuslandszuschlagsV § 5](https://www.gesetze-im-internet.de/baf_gzuschlagsv/BJNR009350986.html) |
| Surcharge for purchasing power | only outside EU/Switzerland, percentage set by the foreign office per country | [AuslandszuschlagsV § 1–2](https://www.gesetze-im-internet.de/baf_gzuschlagsv/BJNR009350986.html) |
| Minimum length, study abroad | six months or one semester (shorter in parts of the EU) | [§ 5 BAföG](https://www.gesetze-im-internet.de/baf_g/__5.html) |
| Internship abroad | required by the study regulations, benefits the training, at least 12 weeks, confirmed by the university | [§ 5 Abs. 5 BAföG](https://www.gesetze-im-internet.de/baf_g/__5.html) |
| Decision | issued by the office as a written decision (Bescheid) | [§ 50 BAföG](https://www.gesetze-im-internet.de/baf_g/__50.html) |

## From Studierendenwerk and university information pages (secondary)

| Fact | Source |
|---|---|
| Typical document list for internships abroad (application form, § 9 certificate, insurance proof, contract) | [Checklist Auslandsantrag, Studierendenwerk Hamburg](https://www.stwhh.de/fileadmin/user_upload/Finanzen/__Downloads/BAfoeG_Ausland_USA/Checklisten/Checkliste_Auslandsantrag_Praktikum.pdf) |
| Applications are often incomplete; the office then asks for more documents | [Completeness hints, Studierendenwerk Heidelberg](https://www.stw.uni-heidelberg.de/sites/default/files/download/pdf/bafau-hin-vollstaendigkeit-auslandsantrag.pdf) |
| Processing takes much longer than for domestic funding, up to about six months | [Merkblatt Auslands-BAföG, FH Erfurt](https://www.fh-erfurt.de/fileadmin/Dokumente/ZIB/Infomaterial/Auslands-BAfoeG.pdf) |
| Half grant, half interest-free loan | [FAU Erlangen-Nürnberg](https://fau.de/international/wege-ins-ausland/finanzierung-eines-auslandsaufenthaltes/externe-foerdermoeglichkeiten/auslands-bafoeg) |
| Official online application | [bafoeg-digital.de](https://www.bafoeg-digital.de) |
| Formblatt 6 is the supplementary sheet for training abroad, filed with Formblatt 1 | [Studierenplus: Formblatt 6](https://www.studierenplus.de/bafoeg/bafoeg-formblatt-6) |
| Formblatt 7 is the update application (§ 24 Abs. 3), Formblatt 8 the request for advance payment (§ 36) when parents do not pay | [Stadt Wiesbaden: Vorblatt Formblätter](https://wiesbaden.de/medien/downloads/leben-in-wiesbaden/amt-40/Seite-2-5-Umschlag-Vorblatt.pdf) |

Forums: I did not find forum posts I could cite reliably, so none are used. The student interview evidence in the product brief covers the same ground.

## Illustrative (made up or simplified)

- **Country surcharge percentages** in `packages/shared/src/countries.ts`. The real values come from the foreign office's table per country.
- **Deduction when deriving parents' net income**: a flat 21.5 % for social security plus the income tax from the notice. The real calculation has more steps.
- **Rounding and the ±7 % range** of the estimate.
- **The tuition supplement ending after a year** is real (AuslandszuschlagsV § 3). The scenario numbers in the decision-letter check (income +10 %, +25 %) are examples.
- **The "parents' income now at least X % lower" rule** is deliberately not given a number, because the law text does not give one.
- **The field lists of Formblatt 6 and 8** (and the sample documents for them) are simplified examples, not the official layouts.
- All people, parents, universities, companies, tax figures and the "Studierendenwerk Musterstadt" itself.
- Demo statistics in the office insights (seeded data).

## Not modelled

Student's own income and assets, spouse and children, age limits, subject change, funding duration limits, loan repayment details, domestic-versus-abroad differences beyond those above, the real portal's data format.
