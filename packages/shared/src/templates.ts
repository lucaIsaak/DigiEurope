import type { Bilingual, DocumentTemplate, FieldType, TemplateField } from "./types.js";

const f = (key: string, label: string, type: FieldType = "text", required = true): TemplateField => ({ key, label, type, required });
const sig = (key: string, label: string) => ({ key, label });
const b = (de: string, en: string): Bilingual => ({ de, en });

/**
 * The templates the prototype can read out of the box. Field lists of Formblatt 6 and 8 are simplified examples,
 * not the official layouts. How a template is read (method, confidence) is decided separately by the extractor owner.
 */
const GERMAN_TEMPLATES: DocumentTemplate[] = [
  {
    id: "application_form", category: "official_form", formblatt: "Formblatt 1", source: "builtin", providedBy: "student",
    name: b("Antrag (Formblatt 1)", "Application (Formblatt 1)"),
    title: "Antrag auf Ausbildungsförderung im Ausland (Formblatt 1)",
    purpose: b("Der eigentliche Antrag auf Förderung.", "The application for funding itself."),
    fields: [f("name", "Name der antragstellenden Person"), f("birth_date", "Geburtsdatum", "date"), f("university", "Deutsche Hochschule"), f("destination", "Zielland"), f("stay_type", "Art des Aufenthalts"), f("period_from", "Aufenthalt von", "date"), f("period_to", "Aufenthalt bis", "date"), f("assets", "Eigenes Vermögen (EUR)", "number", false)],
    signatures: [sig("student", "Unterschrift Antragsteller:in")],
  },
  {
    id: "fb06", category: "official_form", formblatt: "Formblatt 6", source: "builtin", providedBy: "student",
    name: b("Ergänzungsblatt Ausland (Formblatt 6)", "Supplement for training abroad (Formblatt 6)"),
    title: "Formblatt 6: Ergänzungsblatt zum Antrag bei Ausbildung im Ausland",
    purpose: b("Ergänzt Formblatt 1, wenn die Ausbildung ganz oder teilweise im Ausland stattfindet.", "Supplements Formblatt 1 when the training takes place wholly or partly abroad."),
    fields: [f("name", "Name der antragstellenden Person"), f("stay_type", "Art des Aufenthalts"), f("abroad_institution", "Ausbildungsstätte im Ausland"), f("country", "Land"), f("period_from", "Beginn", "date"), f("period_to", "Ende", "date"), f("credit_recognition", "Anerkennung im Inland geplant", "yesno"), f("tuition_fees", "Studiengebühren (EUR)", "number", false)],
    signatures: [sig("student", "Unterschrift Antragsteller:in")],
  },
  {
    id: "fb08", category: "official_form", formblatt: "Formblatt 8", source: "builtin", providedBy: "student",
    name: b("Antrag auf Vorausleistung (Formblatt 8)", "Request for advance payment (Formblatt 8)"),
    title: "Formblatt 8: Antrag auf Vorausleistung von Ausbildungsförderung",
    purpose: b("Wenn Eltern den angerechneten Unterhalt nicht zahlen: Förderung wird vorab geleistet.", "When parents do not pay the maintenance that is counted: funding is paid in advance."),
    fields: [f("name", "Name der antragstellenden Person"), f("parent_name", "Name des Elternteils"), f("reason", "Grund der Nichtzahlung"), f("refused_since", "Zahlung verweigert seit", "date"), f("parents_asked", "Eltern wurden zur Zahlung aufgefordert", "yesno")],
    signatures: [sig("student", "Unterschrift Antragsteller:in")],
  },
  {
    id: "enrollment_cert", category: "study", source: "builtin", providedBy: "student",
    name: b("Immatrikulationsbescheinigung", "Enrolment certificate"),
    title: "Immatrikulationsbescheinigung (§ 9 BAföG)",
    purpose: b("Bestätigt die Einschreibung an der deutschen Hochschule.", "Confirms enrolment at the German university."),
    fields: [f("name", "Name"), f("university", "Hochschule"), f("term", "Semester"), f("course", "Studiengang")],
    signatures: [],
  },
  {
    id: "host_confirmation", category: "study", source: "builtin", providedBy: "third_party",
    name: b("Bestätigung der Gasthochschule", "Host university confirmation"),
    title: "Bestätigung der Gasthochschule",
    purpose: b("Die Gasthochschule bestätigt den Studienplatz und den Zeitraum.", "The host university confirms the place and the period."),
    fields: [f("name", "Name der Studierenden"), f("host_institution", "Gasthochschule"), f("country", "Land"), f("period_from", "Studienzeit von", "date"), f("period_to", "Studienzeit bis", "date")],
    signatures: [sig("host", "Unterschrift und Stempel Gasthochschule")],
  },
  {
    id: "internship_contract", category: "work", source: "builtin", providedBy: "student",
    name: b("Praktikumsvertrag", "Internship contract"),
    title: "Praktikumsvertrag",
    purpose: b("Vertrag zwischen Praktikant:in und Praktikumsstelle.", "Contract between the intern and the host organisation."),
    fields: [f("name", "Praktikant:in"), f("company", "Praktikumsstelle"), f("country", "Land"), f("period_from", "Beginn", "date"), f("period_to", "Ende", "date")],
    signatures: [sig("intern", "Unterschrift Praktikant:in"), sig("employer", "Unterschrift Praktikumsstelle")],
  },
  {
    id: "internship_uni_confirmation", category: "study", source: "builtin", providedBy: "third_party",
    name: b("Hochschulbestätigung Pflichtpraktikum", "University confirmation (mandatory internship)"),
    title: "Bestätigung der Hochschule zum Pflichtpraktikum",
    purpose: b("Die Hochschule bestätigt, dass das Praktikum vorgeschrieben ist.", "The university confirms that the internship is required."),
    fields: [f("name", "Name der Studierenden"), f("mandatory", "Praktikum vorgeschrieben", "yesno"), f("min_weeks", "Mindestdauer in Wochen", "number")],
    signatures: [sig("university", "Unterschrift Hochschule")],
  },
  {
    id: "health_insurance", category: "insurance", source: "builtin", providedBy: "student",
    name: b("Versicherungsnachweis", "Insurance certificate"),
    title: "Versicherungsnachweis Kranken- und Pflegeversicherung",
    purpose: b("Nachweis der Kranken- und Pflegeversicherung.", "Proof of health and care insurance."),
    fields: [f("name", "Versicherte Person"), f("insurer", "Versicherer"), f("insurance_type", "Art der Versicherung"), f("covers_abroad", "Schutz im Zielland", "yesno")],
    signatures: [],
  },
  {
    id: "tuition_waiver_proof", category: "money", source: "builtin", providedBy: "student",
    name: b("Nachweis zu Studiengebühren", "Proof about tuition fees"),
    title: "Nachweis zum Erlass oder zur Ermäßigung der Studiengebühren",
    purpose: b("Zeigt, dass ein Erlass oder eine Ermäßigung versucht wurde.", "Shows that a waiver or reduction was tried."),
    fields: [f("name", "Name der Studierenden"), f("requested", "Erlass oder Ermäßigung beantragt", "yesno"), f("result", "Ergebnis"), f("fees", "Gebühren nach Ermäßigung (EUR)", "number")],
    signatures: [],
  },
  {
    id: "parent_form", category: "official_form", formblatt: "Formblatt 3", source: "builtin", providedBy: "parents",
    name: b("Einkommen der Eltern (Formblatt 3)", "Parents' income (Formblatt 3)"),
    title: "Formblatt 3: Angaben zum Einkommen der Eltern",
    purpose: b("Angaben der Eltern zu Einkommen und Familie.", "Parents' details on income and family."),
    fields: [f("student_name", "Name der Tochter oder des Sohnes"), f("parent_name", "Name des Elternteils"), f("parents_married", "Eltern verheiratet", "yesno"), f("siblings_in_education", "Geschwister in förderfähiger Ausbildung", "number")],
    signatures: [sig("parent", "Unterschrift Elternteil")],
  },
  {
    id: "parent_tax", category: "money", source: "builtin", providedBy: "parents",
    name: b("Einkommensnachweis der Eltern", "Parents' income proof"),
    title: "Einkommensteuerbescheid (Auszug)",
    purpose: b("Nachweis des Einkommens der Eltern.", "Proof of the parents' income."),
    fields: [f("parent_name", "Steuerpflichtige Person"), f("tax_year", "Veranlagungsjahr", "number"), f("sum_of_income", "Summe der Einkünfte (EUR)", "number"), f("income_tax", "Festgesetzte Einkommensteuer (EUR)", "number")],
    signatures: [],
  },
  {
    id: "decision_letter", category: "office", source: "builtin", providedBy: "office",
    name: b("Bescheid", "Decision letter"),
    title: "Bescheid über Ausbildungsförderung im Ausland",
    purpose: b("Der Bescheid des Amtes. Wird für die Folgeprüfung gelesen.", "The office's decision letter. Read for the follow-up check."),
    fields: [
      f("name", "Antragsteller:in"), f("reference", "Aktenzeichen"), f("period_from", "Bewilligungszeitraum von", "date"), f("period_to", "Bewilligungszeitraum bis", "date"), f("country", "Land"),
      f("need_monthly", "Monatlicher Bedarf (EUR)", "number"), f("parent_income_year", "Einkommensjahr der Eltern", "number"), f("parent_net_monthly", "Anrechenbares Nettoeinkommen der Eltern pro Monat (EUR)", "number"),
      f("parents_married", "Eltern verheiratet", "yesno"), f("siblings_in_education", "Geschwister in förderfähiger Ausbildung", "number"), f("parent_contribution", "Angerechnetes Elterneinkommen pro Monat (EUR)", "number"),
      f("grant_monthly", "Monatliche Förderung (EUR)", "number"), f("tuition_supplement", "Zuschuss Studiengebühren einmalig (EUR)", "number"), f("tuition_months", "Gebührenzuschuss für Monate", "number"), f("travel_allowance", "Reisekostenpauschale (EUR)", "number"),
    ],
    signatures: [sig("office", "Unterschrift Sachbearbeitung")],
  },
];


type En = NonNullable<DocumentTemplate["en"]>;
const e = (title: string, fields: Record<string, string>, signatures: Record<string, string> = {}): En => ({ title, fields, signatures });
const APPLICANT = "Applicant's signature";
/** English versions of the forms, so the demo can be shown with English documents. */
const ENGLISH: Record<string, En> = {
  application_form: e("Application for Training Funding Abroad (Formblatt 1)", { name: "Name of applicant", birth_date: "Date of birth", university: "German university", destination: "Destination country", stay_type: "Type of stay", period_from: "Stay from", period_to: "Stay until", assets: "Own assets (EUR)" }, { student: APPLICANT }),
  fb06: e("Formblatt 6: Supplement to the application for training abroad", { name: "Name of applicant", stay_type: "Type of stay", abroad_institution: "Institution abroad", country: "Country", period_from: "Start", period_to: "End", credit_recognition: "Credit recognition planned at home", tuition_fees: "Tuition fees (EUR)" }, { student: APPLICANT }),
  fb08: e("Formblatt 8: Application for advance payment of training funding", { name: "Name of applicant", parent_name: "Name of parent", reason: "Reason for non-payment", refused_since: "Payment refused since", parents_asked: "Parents were asked to pay" }, { student: APPLICANT }),
  enrollment_cert: e("Certificate of Enrolment (§ 9 BAföG)", { name: "Name", university: "University", term: "Semester", course: "Course of study" }),
  host_confirmation: e("Confirmation from the Host University", { name: "Name of student", host_institution: "Host university", country: "Country", period_from: "Study period from", period_to: "Study period until" }, { host: "Signature and stamp of host university" }),
  internship_contract: e("Internship Contract", { name: "Intern", company: "Host organisation", country: "Country", period_from: "Start", period_to: "End" }, { intern: "Intern's signature", employer: "Host organisation's signature" }),
  internship_uni_confirmation: e("University Confirmation of Mandatory Internship", { name: "Name of student", mandatory: "Internship is mandatory", min_weeks: "Minimum length in weeks" }, { university: "University signature" }),
  health_insurance: e("Proof of Health and Care Insurance", { name: "Insured person", insurer: "Insurer", insurance_type: "Type of insurance", covers_abroad: "Cover in destination country" }),
  tuition_waiver_proof: e("Proof of Tuition Fee Waiver or Reduction", { name: "Name of student", requested: "Waiver or reduction requested", result: "Result", fees: "Fees after reduction (EUR)" }),
  parent_form: e("Formblatt 3: Information on the Parents' Income", { student_name: "Name of daughter or son", parent_name: "Name of parent", parents_married: "Parents married", siblings_in_education: "Siblings in eligible education" }, { parent: "Parent's signature" }),
  parent_tax: e("Income Tax Assessment (Extract)", { parent_name: "Taxpayer", tax_year: "Assessment year", sum_of_income: "Total income (EUR)", income_tax: "Income tax assessed (EUR)" }),
};

export const BUILTIN_TEMPLATES: DocumentTemplate[] = GERMAN_TEMPLATES.map((t) => (ENGLISH[t.id] ? { ...t, en: ENGLISH[t.id] } : t));

/** Splits "Label: value" lines out of a sample document and proposes a template from them. Heuristic stand-in for an AI suggestion. */
export function suggestTemplateFromLines(lines: string[]): { title: string; fields: TemplateField[]; signatures: { key: string; label: string }[] } {
  const slug = (s: string) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";
  // The title is the first line that is not the letterhead or the sample footer; fields come after it.
  const titleIdx = lines.findIndex((l) => !/^Studierendenwerk/i.test(l) && !/^(BEISPIEL|SAMPLE)/i.test(l) && l.trim().length > 3);
  const title = titleIdx >= 0 ? lines[titleIdx]! : "";
  const fields: TemplateField[] = [];
  const signatures: { key: string; label: string }[] = [];
  const used = new Set<string>();
  for (const line of lines.slice(titleIdx + 1)) {
    const i = line.indexOf(": ");
    if (i < 0) continue;
    const label = line.slice(0, i).trim();
    const value = line.slice(i + 2).trim();
    let key = slug(label);
    for (let n = 2; used.has(key); n++) key = `${slug(label)}_${n}`;
    used.add(key);
    if (/^(BEISPIEL|SAMPLE)/i.test(label)) continue;
    if (/unterschrift|stempel|signature|stamp/i.test(label) || /\((gezeichnet|fehlt|signed|missing)\)/.test(value)) {
      signatures.push({ key: key.replace(/^unterschrift_?/, "") || key, label });
      continue;
    }
    const type: FieldType = /^\d{4}-\d{2}-\d{2}$/.test(value) ? "date" : /^(ja|nein|yes|no)$/i.test(value) ? "yesno" : /^-?\d+([.,]\d+)?$/.test(value) ? "number" : "text";
    fields.push({ key, label, type, required: true });
  }
  return { title, fields, signatures };
}
