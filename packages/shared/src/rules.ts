import type { Check, Rule, RuleState } from "./types.js";

const G = "https://www.gesetze-im-internet.de";
const SRC = {
  par5: { label: "§ 5 BAföG", url: `${G}/baf_g/__5.html` },
  par13: { label: "§ 13 BAföG", url: `${G}/baf_g/__13.html` },
  par15: { label: "§ 15 BAföG", url: `${G}/baf_g/__15.html` },
  par25: { label: "§ 25 BAföG", url: `${G}/baf_g/__25.html` },
  az: { label: "BAföG-AuslandszuschlagsV", url: `${G}/baf_gzuschlagsv/BJNR009350986.html` },
  hh: {
    label: "Checklist Auslandsantrag (Studierendenwerk Hamburg)",
    url: "https://www.stwhh.de/fileadmin/user_upload/Finanzen/__Downloads/BAfoeG_Ausland_USA/Checklisten/Checkliste_Auslandsantrag_Praktikum.pdf",
  },
  hd: {
    label: "Completeness hints (Studierendenwerk Heidelberg)",
    url: "https://www.stw.uni-heidelberg.de/sites/default/files/download/pdf/bafau-hin-vollstaendigkeit-auslandsantrag.pdf",
  },
};

const study: Check = { eq: [{ ref: "stay.type" }, "study"] };
const internship: Check = { eq: [{ ref: "stay.type" }, "internship"] };

/**
 * The rule set. Written once in plain language ("plain"), turned into a fixed executable check ("pass"),
 * covered by sample cases ("tests") and only run once an office has approved it (see RuleState).
 * Rules marked "federal" are shared by all offices (BAföG is federal law); "office" rules are local.
 */
export const RULES: Rule[] = [
  {
    id: "R-FORM-SIGNED",
    version: 1,
    scope: "federal",
    title: { de: "Antragsformular unterschrieben", en: "Application form signed" },
    plain: {
      de: "Der Antrag (Formblatt 1) muss vorliegen und von der antragstellenden Person unterschrieben sein.",
      en: "The application (Formblatt 1) must be present and signed by the student.",
    },
    source: SRC.hd,
    pass: { all: [{ truthy: { ref: "docs.application_form.present" } }, { truthy: { ref: "docs.application_form.sig.student" } }] },
    severity: "blocker",
    documentKind: "application_form",
    fix: {
      de: "Das Antragsformular fehlt oder ist nicht unterschrieben. Bitte unterschreiben Sie es und laden Sie es erneut hoch.",
      en: "The application form is missing or not signed by you. Please sign it and upload it again.",
    },
    recommendation: {
      de: "Unterschriftsfeld im Formular farbig markieren und Hinweis „Bitte unterschreiben“ auf jeder Seite ergänzen.",
      en: "Highlight the signature box in the form and add a “please sign” note on every page.",
    },
    tests: [
      { name: "signed form", facts: {}, expectPass: true },
      { name: "form missing", facts: { docs: { application_form: { present: false, fields: {}, sig: {} } } }, expectPass: false },
      { name: "form not signed", facts: { docs: { application_form: { sig: { student: false } } } }, expectPass: false },
    ],
  },
  {
    id: "R-ENROLL",
    version: 1,
    scope: "federal",
    title: { de: "Immatrikulationsbescheinigung", en: "Enrolment certificate" },
    plain: {
      de: "Eine aktuelle Immatrikulations- bzw. Studienbescheinigung der deutschen Hochschule muss vorliegen.",
      en: "A current enrolment certificate from the German university must be present.",
    },
    source: SRC.hh,
    pass: { truthy: { ref: "docs.enrollment_cert.present" } },
    severity: "blocker",
    documentKind: "enrollment_cert",
    fix: {
      de: "Es fehlt die Immatrikulationsbescheinigung Ihrer deutschen Hochschule. Sie finden sie im Studierendenportal.",
      en: "The enrolment certificate from your German university is missing. You can download it from your student portal.",
    },
    tests: [
      { name: "certificate present", facts: {}, expectPass: true },
      { name: "certificate missing", facts: { docs: { enrollment_cert: { present: false } } }, expectPass: false },
    ],
  },
  {
    id: "R-HOST-CONFIRM",
    version: 2,
    scope: "federal",
    title: { de: "Bestätigung der Gasthochschule", en: "Host university confirmation" },
    plain: {
      de: "Bei einem Studium im Ausland muss die Gasthochschule den Studienplatz schriftlich bestätigen (Stempel oder Unterschrift).",
      en: "For a study stay abroad the host university must confirm the place in writing (stamp or signature).",
    },
    source: SRC.par5,
    when: study,
    pass: { all: [{ truthy: { ref: "docs.host_confirmation.present" } }, { truthy: { ref: "docs.host_confirmation.sig.host" } }] },
    severity: "blocker",
    documentKind: "host_confirmation",
    fix: {
      de: "Es fehlt die unterschriebene Bestätigung Ihrer Gasthochschule. Bitten Sie das International Office dort um ein Zulassungsschreiben mit Zeitraum.",
      en: "The signed confirmation from your host university is missing. Ask its international office for an admission letter that states the period.",
    },
    recommendation: {
      de: "Im Formular eine Checkliste „Bestätigung der Gasthochschule beilegen“ ergänzen und eine Mustervorlage verlinken.",
      en: "Add a checklist item “attach host university confirmation” to the form and link a template.",
    },
    tests: [
      { name: "confirmed and signed", facts: {}, expectPass: true },
      { name: "confirmation missing", facts: { docs: { host_confirmation: { present: false, sig: {} } } }, expectPass: false },
      { name: "confirmation without signature", facts: { docs: { host_confirmation: { sig: { host: false } } } }, expectPass: false },
      { name: "internship does not need it", facts: { stay: { type: "internship" }, docs: { host_confirmation: { present: false } } }, expectPass: true },
    ],
  },
  {
    id: "R-HOST-PERIOD",
    version: 1,
    scope: "federal",
    title: { de: "Zeitraum der Bestätigung deckt den Aufenthalt ab", en: "Confirmation covers the whole stay" },
    plain: {
      de: "Der Zeitraum in der Bestätigung der Gasthochschule muss den angegebenen Aufenthalt vollständig abdecken.",
      en: "The period on the host university confirmation must cover the whole stay you entered.",
    },
    source: SRC.par5,
    when: { all: [study, { truthy: { ref: "docs.host_confirmation.present" } }] },
    pass: {
      all: [
        { lte: [{ ref: "docs.host_confirmation.fields.period_from" }, { ref: "stay.startDate" }] },
        { gte: [{ ref: "docs.host_confirmation.fields.period_to" }, { ref: "stay.endDate" }] },
      ],
    },
    severity: "blocker",
    documentKind: "host_confirmation",
    fix: {
      de: "Die Bestätigung nennt {docs.host_confirmation.fields.period_from} bis {docs.host_confirmation.fields.period_to}, Ihr Aufenthalt dauert aber {stay.startDate} bis {stay.endDate}. Bitte lassen Sie die Bestätigung anpassen oder korrigieren Sie Ihre Angaben.",
      en: "The confirmation says {docs.host_confirmation.fields.period_from} to {docs.host_confirmation.fields.period_to}, but your stay is {stay.startDate} to {stay.endDate}. Please have it corrected or fix the dates you entered.",
    },
    tests: [
      { name: "period matches", facts: {}, expectPass: true },
      { name: "confirmation ends too early", facts: { docs: { host_confirmation: { fields: { period_to: "2027-05-31" } } } }, expectPass: false },
      { name: "confirmation starts too late", facts: { docs: { host_confirmation: { fields: { period_from: "2027-03-01" } } } }, expectPass: false },
    ],
  },
  {
    id: "R-MIN-STUDY",
    version: 1,
    scope: "federal",
    title: { de: "Mindestdauer Studium außerhalb der EU", en: "Minimum length of a study stay outside the EU" },
    plain: {
      de: "Ein Studium außerhalb der EU muss mindestens sechs Monate bzw. ein Semester dauern (hier: mindestens 26 Wochen).",
      en: "A study stay outside the EU must last at least six months or one semester (here: at least 26 weeks).",
    },
    source: SRC.par5,
    when: { all: [study, { not: { truthy: { ref: "stay.isEU" } } }] },
    pass: { gte: [{ ref: "stay.weeks" }, 26] },
    severity: "blocker",
    fix: {
      de: "Ihr Aufenthalt dauert nur {stay.weeks} Wochen. Außerhalb der EU wird ein Studium erst ab etwa sechs Monaten (26 Wochen) gefördert.",
      en: "Your stay is only {stay.weeks} weeks. Outside the EU a study stay is funded from about six months (26 weeks).",
    },
    tests: [
      { name: "28 weeks in Canada", facts: {}, expectPass: true },
      { name: "12 weeks in Canada", facts: { stay: { weeks: 12 } }, expectPass: false },
      { name: "12 weeks in Spain is not affected", facts: { stay: { weeks: 12, isEU: true, country: "ES" } }, expectPass: true },
    ],
  },
  {
    id: "R-MIN-INTERN",
    version: 1,
    scope: "federal",
    title: { de: "Mindestdauer Praktikum", en: "Minimum length of an internship" },
    plain: {
      de: "Ein Auslandspraktikum muss mindestens zwölf Wochen dauern.",
      en: "An internship abroad must last at least twelve weeks.",
    },
    source: SRC.par5,
    when: internship,
    pass: { gte: [{ ref: "stay.weeks" }, 12] },
    severity: "blocker",
    fix: {
      de: "Ihr Praktikum dauert nur {stay.weeks} Wochen. Gefördert werden Praktika ab zwölf Wochen.",
      en: "Your internship is only {stay.weeks} weeks. Internships are funded from twelve weeks.",
    },
    tests: [
      { name: "16 weeks", facts: { stay: { type: "internship", weeks: 16 } }, expectPass: true },
      { name: "8 weeks", facts: { stay: { type: "internship", weeks: 8 } }, expectPass: false },
    ],
  },
  {
    id: "R-INTERN-CONTRACT",
    version: 1,
    scope: "federal",
    title: { de: "Praktikumsvertrag beidseitig unterschrieben", en: "Internship contract signed by both sides" },
    plain: {
      de: "Der Praktikumsvertrag muss vorliegen und von Praktikant:in und Praktikumsstelle unterschrieben sein.",
      en: "The internship contract must be present and signed by the intern and the host organisation.",
    },
    source: SRC.hh,
    when: internship,
    pass: {
      all: [
        { truthy: { ref: "docs.internship_contract.present" } },
        { truthy: { ref: "docs.internship_contract.sig.intern" } },
        { truthy: { ref: "docs.internship_contract.sig.employer" } },
      ],
    },
    severity: "blocker",
    documentKind: "internship_contract",
    fix: {
      de: "Der Praktikumsvertrag fehlt oder es fehlt eine Unterschrift (von Ihnen oder von der Praktikumsstelle). Bitte laden Sie die vollständig unterschriebene Fassung hoch.",
      en: "The internship contract is missing or lacks a signature (yours or the host organisation's). Please upload the fully signed version.",
    },
    recommendation: {
      de: "Im Formular ausdrücklich „unterschriebener Vertrag beider Seiten“ verlangen und ein Beispiel-Foto der Unterschriftsseite zeigen.",
      en: "Ask explicitly for “contract signed by both sides” in the form and show a sample of the signature page.",
    },
    tests: [
      { name: "both signed", facts: { stay: { type: "internship" } }, expectPass: true },
      { name: "employer unsigned", facts: { stay: { type: "internship" }, docs: { internship_contract: { sig: { employer: false } } } }, expectPass: false },
      { name: "intern unsigned", facts: { stay: { type: "internship" }, docs: { internship_contract: { sig: { intern: false } } } }, expectPass: false },
      { name: "contract missing", facts: { stay: { type: "internship" }, docs: { internship_contract: { present: false, sig: {} } } }, expectPass: false },
    ],
  },
  {
    id: "R-INTERN-UNI",
    version: 1,
    scope: "federal",
    title: { de: "Hochschule bestätigt Pflichtpraktikum", en: "University confirms the internship is mandatory" },
    plain: {
      de: "Die deutsche Hochschule muss bestätigen, dass das Praktikum nach der Prüfungsordnung vorgeschrieben ist und der Ausbildung dient.",
      en: "The German university must confirm that the internship is required by the study regulations and benefits the studies.",
    },
    source: SRC.par5,
    when: internship,
    pass: { all: [{ truthy: { ref: "docs.internship_uni_confirmation.present" } }, { eq: [{ ref: "docs.internship_uni_confirmation.fields.mandatory" }, "Ja"] }] },
    severity: "blocker",
    documentKind: "internship_uni_confirmation",
    fix: {
      de: "Es fehlt die Bestätigung Ihrer Hochschule, dass das Praktikum vorgeschrieben ist (Pflichtpraktikum).",
      en: "Your university's confirmation that the internship is mandatory is missing.",
    },
    tests: [
      { name: "mandatory", facts: { stay: { type: "internship" } }, expectPass: true },
      { name: "voluntary", facts: { stay: { type: "internship" }, docs: { internship_uni_confirmation: { fields: { mandatory: "Nein" } } } }, expectPass: false },
    ],
  },
  {
    id: "R-PARENT-FORM",
    version: 1,
    scope: "federal",
    title: { de: "Einkommensangaben der Eltern unterschrieben", en: "Parents' income form signed" },
    plain: {
      de: "Das Formblatt 3 (Angaben zum Einkommen der Eltern) muss vorliegen und von dem Elternteil unterschrieben sein.",
      en: "Formblatt 3 (parents' income) must be present and signed by the parent.",
    },
    source: SRC.hd,
    pass: { all: [{ truthy: { ref: "docs.parent_form.present" } }, { truthy: { ref: "docs.parent_form.sig.parent" } }] },
    severity: "blocker",
    documentKind: "parent_form",
    fix: {
      de: "Dem Formblatt der Eltern fehlt die Unterschrift eines Elternteils (oder es fehlt ganz). Ihre Eltern können es über ihren Link erneut hochladen.",
      en: "The parents' form has no parent signature (or is missing). Your parents can upload it again through their link.",
    },
    recommendation: {
      de: "Auf Seite 2 des Elternformulars einen deutlich sichtbaren Unterschriftskasten mit Pfeil einbauen und die Eltern-Link-Funktion früh im Antrag anbieten.",
      en: "Put a clearly visible signature box with an arrow on page 2 of the parents' form and offer the parent link early in the application.",
    },
    tests: [
      { name: "signed", facts: {}, expectPass: true },
      { name: "parent did not sign", facts: { docs: { parent_form: { sig: { parent: false } } } }, expectPass: false },
      { name: "form missing", facts: { docs: { parent_form: { present: false, sig: {} } } }, expectPass: false },
    ],
  },
  {
    id: "R-PARENT-TAX",
    version: 1,
    scope: "federal",
    title: { de: "Einkommensnachweis der Eltern liegt vor", en: "Parents' income proof present" },
    plain: {
      de: "Ein Einkommensnachweis der Eltern (z. B. Einkommensteuerbescheid) muss vorliegen.",
      en: "Proof of the parents' income (for example an income tax notice) must be present.",
    },
    source: SRC.par25,
    pass: { truthy: { ref: "docs.parent_tax.present" } },
    severity: "blocker",
    documentKind: "parent_tax",
    fix: {
      de: "Der Einkommensnachweis Ihrer Eltern fehlt. Ihre Eltern laden ihn über ihren Link hoch.",
      en: "Proof of your parents' income is missing. Your parents upload it through their link.",
    },
    tests: [
      { name: "tax notice present", facts: {}, expectPass: true },
      { name: "tax notice missing", facts: { docs: { parent_tax: { present: false, fields: {} } } }, expectPass: false },
    ],
  },
  {
    id: "R-PARENT-YEAR",
    version: 1,
    scope: "federal",
    title: { de: "Richtiges Einkommensjahr", en: "Correct income year" },
    plain: {
      de: "Maßgeblich ist das Einkommen des vorletzten Kalenderjahres vor Beginn des Bewilligungszeitraums. Der Einkommensnachweis muss dieses Jahr betreffen.",
      en: "What counts is the parents' income from the second-to-last calendar year before the funding period starts. The income proof must be for that year.",
    },
    source: SRC.par25,
    when: { truthy: { ref: "docs.parent_tax.present" } },
    pass: { eq: [{ ref: "docs.parent_tax.fields.tax_year" }, { ref: "incomeYearRequired" }] },
    severity: "blocker",
    documentKind: "parent_tax",
    fix: {
      de: "Der Einkommensnachweis Ihrer Eltern gilt für {docs.parent_tax.fields.tax_year}. Für Ihren Beginn am {stay.startDate} wird das Jahr {incomeYearRequired} benötigt.",
      en: "Your parents' income proof is for {docs.parent_tax.fields.tax_year}. For your start on {stay.startDate} the year {incomeYearRequired} is needed.",
    },
    recommendation: {
      de: "Im Antrag automatisch anzeigen, welches Einkommensjahr benötigt wird (abhängig vom Starttermin).",
      en: "Show in the application which income year is needed, based on the start date.",
    },
    tests: [
      { name: "year 2025 for a 2027 start", facts: {}, expectPass: true },
      { name: "year 2023 is outdated", facts: { docs: { parent_tax: { fields: { tax_year: "2023" } } } }, expectPass: false },
    ],
  },
  {
    id: "R-HEALTH",
    version: 1,
    scope: "federal",
    title: { de: "Nachweis der Kranken- und Pflegeversicherung", en: "Proof of health and care insurance" },
    plain: {
      de: "Für den Zuschlag zur Kranken- und Pflegeversicherung muss ein Versicherungsnachweis vorliegen.",
      en: "For the health and care insurance supplement an insurance certificate must be present.",
    },
    source: SRC.az,
    pass: { truthy: { ref: "docs.health_insurance.present" } },
    severity: "blocker",
    documentKind: "health_insurance",
    fix: {
      de: "Der Nachweis Ihrer Kranken- und Pflegeversicherung fehlt. Ihre Krankenkasse stellt ihn online aus.",
      en: "Proof of your health and care insurance is missing. Your insurer issues it online.",
    },
    tests: [
      { name: "proof present", facts: {}, expectPass: true },
      { name: "proof missing", facts: { docs: { health_insurance: { present: false, fields: {} } } }, expectPass: false },
    ],
  },
  {
    id: "R-TUITION-WAIVER",
    version: 1,
    scope: "federal",
    title: { de: "Nachweis zu Studiengebühren", en: "Proof about tuition fees" },
    plain: {
      de: "Wer einen Zuschuss zu Studiengebühren möchte, muss nachweisen, dass er einen Erlass oder eine Ermäßigung beantragt hat, und das Ergebnis vorlegen.",
      en: "Anyone asking for a tuition fee supplement must show that they asked for a waiver or reduction, and give the result.",
    },
    source: SRC.az,
    when: { truthy: { ref: "stay.hasTuition" } },
    pass: { truthy: { ref: "docs.tuition_waiver_proof.present" } },
    severity: "warning",
    documentKind: "tuition_waiver_proof",
    fix: {
      de: "Sie haben Studiengebühren angegeben. Ohne Nachweis über einen Erlass-/Ermäßigungsantrag kann der Gebührenzuschuss abgelehnt werden. Der Rest des Antrags ist davon nicht betroffen.",
      en: "You entered tuition fees. Without proof that you asked for a waiver or reduction, the fee supplement can be refused. The rest of your application is not affected.",
    },
    tests: [
      { name: "no fees", facts: {}, expectPass: true },
      { name: "fees with proof", facts: { stay: { hasTuition: true, tuitionFees: 4000 } }, expectPass: true },
      { name: "fees without proof", facts: { stay: { hasTuition: true, tuitionFees: 4000 }, docs: { tuition_waiver_proof: { present: false } } }, expectPass: false },
    ],
  },
  {
    id: "R-TUITION-CAP",
    version: 1,
    scope: "federal",
    title: { de: "Höchstbetrag Studiengebühren", en: "Tuition fee limit" },
    plain: {
      de: "Studiengebühren werden für höchstens ein Jahr und bis zu 5.600 Euro übernommen.",
      en: "Tuition fees are covered for at most one year and up to 5,600 euros.",
    },
    source: SRC.az,
    when: { truthy: { ref: "stay.hasTuition" } },
    pass: { lte: [{ ref: "stay.tuitionFees" }, 5600] },
    severity: "warning",
    fix: {
      de: "Ihre Gebühren ({stay.tuitionFees} €) liegen über 5.600 €. Übernommen werden höchstens 5.600 € für ein Jahr.",
      en: "Your fees ({stay.tuitionFees} €) are above 5,600 €. At most 5,600 € for one year is covered.",
    },
    tests: [
      { name: "4,000 €", facts: { stay: { hasTuition: true, tuitionFees: 4000 } }, expectPass: true },
      { name: "7,000 €", facts: { stay: { hasTuition: true, tuitionFees: 7000 } }, expectPass: false },
    ],
  },
  {
    id: "R-EARLY",
    version: 1,
    scope: "office",
    title: { de: "Rechtzeitig beantragen", en: "Apply early enough" },
    plain: {
      de: "Auslandsanträge brauchen oft viele Wochen bis Monate. Beginnt der Aufenthalt in weniger als vier Monaten, weisen wir darauf hin.",
      en: "Applications for abroad often take weeks to months. If the stay starts in less than four months we show a note.",
    },
    source: SRC.par15,
    pass: { gte: [{ ref: "daysUntilStart" }, 120] },
    severity: "warning",
    fix: {
      de: "Ihr Aufenthalt beginnt in {daysUntilStart} Tagen. Reichen Sie vollständig ein: Förderung gibt es frühestens ab dem Antragsmonat, und die Bearbeitung kann dauern.",
      en: "Your stay starts in {daysUntilStart} days. Submit a complete application: funding starts at the earliest in the month you apply, and processing can take time.",
    },
    tests: [
      { name: "five months ahead", facts: { daysUntilStart: 150 }, expectPass: true },
      { name: "six weeks ahead", facts: { daysUntilStart: 42 }, expectPass: false },
    ],
  },
  {
    id: "R-READABLE",
    version: 1,
    scope: "federal",
    title: { de: "Dokumente lesbar", en: "Documents readable" },
    plain: {
      de: "Alle hochgeladenen Dokumente müssen lesbar sein, damit die Angaben automatisch übernommen werden können.",
      en: "All uploaded documents must be readable so their details can be taken over automatically.",
    },
    source: SRC.hd,
    pass: { eq: [{ ref: "unreadableCount" }, 0] },
    severity: "blocker",
    fix: {
      de: "Wir konnten diese Datei nicht lesen: {unreadable}. Bitte laden Sie eine klare PDF-Version hoch.",
      en: "We could not read this file: {unreadable}. Please upload a clear PDF version.",
    },
    tests: [
      { name: "all readable", facts: {}, expectPass: true },
      { name: "a scan is unreadable", facts: { unreadableCount: 1, unreadable: "scan.jpg" }, expectPass: false },
    ],
  },
  {
    id: "R-HEALTH-ABROAD",
    version: 1,
    scope: "federal",
    title: { de: "Versicherungsschutz im Zielland", en: "Insurance covers the destination country" },
    plain: {
      de: "Der Versicherungsnachweis muss bestätigen, dass der Schutz auch im Zielland gilt.",
      en: "The insurance certificate must confirm that cover also applies in the destination country.",
    },
    source: SRC.az,
    when: { truthy: { ref: "docs.health_insurance.present" } },
    pass: { eq: [{ ref: "docs.health_insurance.fields.covers_abroad" }, "Ja"] },
    severity: "warning",
    documentKind: "health_insurance",
    fix: {
      de: "Ihr Versicherungsnachweis bestätigt den Schutz im Ausland nicht. Fragen Sie Ihre Kasse nach einer Auslandsbescheinigung.",
      en: "Your insurance certificate does not confirm cover abroad. Ask your insurer for a certificate for stays abroad.",
    },
    draftedByAi: true,
    tests: [
      { name: "covers abroad", facts: {}, expectPass: true },
      { name: "does not cover abroad", facts: { docs: { health_insurance: { fields: { covers_abroad: "Nein" } } } }, expectPass: false },
    ],
  },
];

/** Default approvals when an office starts with this rule set. The last rule is a fresh AI-assisted draft waiting for review. */
export function defaultRuleStates(): Record<string, RuleState> {
  const out: Record<string, RuleState> = {};
  for (const r of RULES) {
    out[r.id] = r.draftedByAi
      ? { status: "draft" }
      : { status: "approved", approvedBy: "Abroad unit (sample)", approvedAt: "2026-09-01T09:00:00.000Z" };
  }
  return out;
}
