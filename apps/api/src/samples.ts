import { addDays, isoDate, monthlyNeed, netMonthlyFromTax, parentContribution, type DocumentKind, type StayInfo, type StudentInfo } from "@digieurope/shared";
import { renderDocument } from "./documents.js";
import { buildPdf, type PdfLine } from "./pdf.js";

export type Defect =
  | "parent_unsigned"
  | "host_missing"
  | "contract_unsigned"
  | "form_unsigned"
  | "wrong_income_year"
  | "host_period_short"
  | "tax_missing"
  | "insurance_missing"
  | "enroll_missing"
  | "no_abroad_cover"
  | "unclear_income";

export interface SamplePerson {
  key: string;
  student: StudentInfo;
  stay: StayInfo;
  parents: { name: string; married: boolean; siblings: number; sumOfIncome: number; incomeTax: number };
  company?: string;
  hostInstitution?: string;
  insurer: string;
  waiverResult?: string;
}

const BASE_PEOPLE: Record<string, SamplePerson> = {
  mira: {
    key: "mira",
    student: { firstName: "Mira", lastName: "Sommer", birthDate: "2003-05-17", email: "mira.sommer@example.org", university: "Universität Musterstadt", course: "Politikwissenschaft (B.A.)" },
    stay: { type: "study", country: "CA", city: "Toronto", institution: "Lakeshore University", startDate: "2027-02-01", endDate: "2027-08-15", tuitionFees: 4200 },
    parents: { name: "Katrin Sommer", married: true, siblings: 0, sumOfIncome: 78000, incomeTax: 14000 },
    hostInstitution: "Lakeshore University",
    insurer: "Musterkasse Gesundheit",
    waiverResult: "Ermäßigung abgelehnt, Gebühren 4200 EUR",
  },
  jonas: {
    key: "jonas",
    student: { firstName: "Jonas", lastName: "Weber", birthDate: "2002-11-02", email: "jonas.weber@example.org", university: "Technische Hochschule Musterstadt", course: "Wirtschaftsinformatik (B.Sc.)" },
    stay: { type: "internship", country: "PT", city: "Lissabon", institution: "Atlântico Software Lda.", startDate: "2027-03-01", endDate: "2027-06-27", tuitionFees: 0 },
    parents: { name: "Peter Weber", married: true, siblings: 0, sumOfIncome: 52000, incomeTax: 7000 },
    company: "Atlântico Software Lda.",
    insurer: "Musterkasse Gesundheit",
  },
  lea: {
    key: "lea",
    student: { firstName: "Lea", lastName: "Martin", birthDate: "2003-02-09", email: "lea.martin@example.org", university: "Universität Musterstadt", course: "Romanistik (B.A.)" },
    stay: { type: "study", country: "ES", city: "Madrid", institution: "Universidad Ficticia de Madrid", startDate: "2027-03-01", endDate: "2027-07-31", tuitionFees: 0 },
    parents: { name: "Sabine Martin", married: true, siblings: 0, sumOfIncome: 36000, incomeTax: 3500 },
    hostInstitution: "Universidad Ficticia de Madrid",
    insurer: "Musterkasse Gesundheit",
  },
  paul: {
    key: "paul",
    student: { firstName: "Paul", lastName: "Neumann", birthDate: "2002-04-12", email: "paul.neumann@example.org", university: "Technische Hochschule Musterstadt", course: "Wirtschaftsingenieurwesen (B.Sc.)" },
    stay: { type: "internship", country: "NL", city: "Rotterdam", institution: "Delta Logistics BV", startDate: "2027-03-01", endDate: "2027-06-27", tuitionFees: 0 },
    parents: { name: "Ines Neumann", married: true, siblings: 0, sumOfIncome: 54000, incomeTax: 8200 },
    company: "Delta Logistics BV",
    insurer: "Musterkasse Gesundheit",
  },
  noah: {
    key: "noah",
    student: { firstName: "Noah", lastName: "Keller", birthDate: "2002-08-21", email: "noah.keller@example.org", university: "Universität Musterstadt", course: "Informatik (B.Sc.)" },
    stay: { type: "study", country: "CA", city: "Toronto", institution: "Lakeshore University", startDate: "2025-09-01", endDate: "2026-08-31", tuitionFees: 5200 },
    parents: { name: "Andrea Keller", married: true, siblings: 0, sumOfIncome: 73000, incomeTax: 12500 },
    hostInstitution: "Lakeshore University",
    insurer: "Musterkasse Gesundheit",
  },
};

/** Stays start a few months after "now" so the sample cases stay realistic whenever the demo runs. Last year's letter case is fixed. */
export function getPerson(key: string, now: Date = new Date()): SamplePerson {
  const base = BASE_PEOPLE[key]!;
  if (key === "noah") return base;
  const offsets: Record<string, [number, number]> = { mira: [140, 28], jonas: [170, 17], lea: [155, 21], paul: [165, 17] };
  const [days, weeks] = offsets[key]!;
  const later = new Date(now.getTime() + days * 86_400_000);
  const start = isoDate(new Date(Date.UTC(later.getUTCFullYear(), later.getUTCMonth() + 1, 1)));
  return { ...base, stay: { ...base.stay, startDate: start, endDate: addDays(start, weeks * 7) } };
}

export interface GeneratedDoc {
  kind: DocumentKind;
  filename: string;
  content: Buffer;
}

const fullName = (p: SamplePerson) => `${p.student.firstName} ${p.student.lastName}`;

/** Creates the set of documents a student and parents would upload, with the given typical mistakes built in. */
export function sampleDocuments(p: SamplePerson, defects: Defect[] = []): GeneratedDoc[] {
  const d = (x: Defect) => defects.includes(x);
  const name = fullName(p);
  const out: GeneratedDoc[] = [];
  const add = (kind: GeneratedDoc["kind"], filename: string, values: Record<string, string | number>, signed: Record<string, boolean> = {}) =>
    out.push({ kind, filename, content: renderDocument(kind, values, signed) });
  const intern = p.stay.type === "internship";
  const incomeYear = Number(p.stay.startDate.slice(0, 4)) - 2;
  add("fb06", "Formblatt6_Ausland.pdf", {
    name, stay_type: intern ? "Praktikum" : "Studium", abroad_institution: p.stay.institution, country: p.stay.country,
    period_from: p.stay.startDate, period_to: p.stay.endDate, credit_recognition: "Ja", tuition_fees: p.stay.tuitionFees,
  }, { student: !d("form_unsigned") });

  add("application_form", "Antrag_Formblatt1.pdf", {
    name, birth_date: p.student.birthDate, university: p.student.university, destination: `${p.stay.city}, ${p.stay.country}`,
    stay_type: intern ? "Praktikum" : "Studium", period_from: p.stay.startDate, period_to: p.stay.endDate,
  }, { student: !d("form_unsigned") });
  if (!d("enroll_missing")) add("enrollment_cert", "Immatrikulationsbescheinigung.pdf", { name, university: p.student.university, term: "Wintersemester 2026/27", course: p.student.course });
  if (!intern && !d("host_missing")) {
    add("host_confirmation", "Bestaetigung_Gasthochschule.pdf", {
      name, host_institution: p.hostInstitution ?? p.stay.institution, country: p.stay.country, period_from: p.stay.startDate,
      period_to: d("host_period_short") ? addDays(p.stay.endDate, -75) : p.stay.endDate,
    }, { host: true });
  }
  if (intern) {
    add("internship_contract", "Praktikumsvertrag.pdf", { name, company: p.company ?? p.stay.institution, country: p.stay.country, period_from: p.stay.startDate, period_to: p.stay.endDate, signer_name: name }, { intern: !d("contract_unsigned"), employer: true });
    add("internship_uni_confirmation", "Bestaetigung_Pflichtpraktikum.pdf", { name, mandatory: "Ja", min_weeks: 12, signer_name: "Prüfungsamt" }, { university: true });
  }
  if (!d("insurance_missing")) {
    add("health_insurance", "Versicherungsnachweis.pdf", { name, insurer: p.insurer, insurance_type: "gesetzlich", covers_abroad: d("no_abroad_cover") ? "Nein" : "Ja" });
  }
  if (p.stay.tuitionFees > 0) {
    add("tuition_waiver_proof", "Nachweis_Studiengebuehren.pdf", { name, requested: "Ja", result: p.waiverResult ?? "abgelehnt", fees: p.stay.tuitionFees });
  }
  add("parent_form", "Formblatt3_Eltern.pdf", {
    student_name: name, parent_name: p.parents.name, parents_married: p.parents.married ? "Ja" : "Nein", siblings_in_education: p.parents.siblings,
  }, { parent: !d("parent_unsigned") });
  if (!d("tax_missing")) {
    add("parent_tax", "Einkommensteuerbescheid.pdf", {
      parent_name: p.parents.name, tax_year: d("wrong_income_year") ? incomeYear - 2 : incomeYear, sum_of_income: d("unclear_income") ? `${String(p.parents.sumOfIncome).slice(0, 2)}?${String(p.parents.sumOfIncome).slice(3)} (unleserlich)` : p.parents.sumOfIncome, income_tax: p.parents.incomeTax,
    });
  }
  return out;
}

/** Documents that fix the typical mistakes above. */
export function fixDocuments(p: SamplePerson): Record<string, GeneratedDoc> {
  const full = Object.fromEntries(sampleDocuments(p).map((x) => [x.kind, x]));
  const rename = (x: GeneratedDoc | undefined, filename: string): GeneratedDoc | undefined => (x ? { ...x, filename } : undefined);
  return Object.fromEntries(
    Object.entries({
      parent_form: rename(full.parent_form, "Formblatt3_Eltern_unterschrieben.pdf"),
      host_confirmation: rename(full.host_confirmation, "Bestaetigung_Gasthochschule.pdf"),
      internship_contract: rename(full.internship_contract, "Praktikumsvertrag_unterschrieben.pdf"),
    }).filter(([, v]) => v),
  ) as Record<string, GeneratedDoc>;
}

/** A decision letter for last year's stay. Numbers come from the same calculator the estimate uses, so they agree. */
export function sampleLetter(p: SamplePerson): GeneratedDoc {
  const net = Math.round(netMonthlyFromTax(p.parents.sumOfIncome, p.parents.incomeTax));
  const contribution = parentContribution({ netMonthly: net, married: p.parents.married, siblings: p.parents.siblings });
  const need = monthlyNeed(p.stay.country).total;
  const grant = Math.max(0, need - contribution);
  const content = renderDocument("decision_letter", {
    name: fullName(p), reference: "MS-2025-04711", period_from: p.stay.startDate, period_to: p.stay.endDate, country: p.stay.country,
    need_monthly: need, parent_income_year: Number(p.stay.startDate.slice(0, 4)) - 2, parent_net_monthly: net,
    parents_married: p.parents.married ? "Ja" : "Nein", siblings_in_education: p.parents.siblings, parent_contribution: contribution,
    grant_monthly: grant, tuition_supplement: Math.min(p.stay.tuitionFees, 5600), tuition_months: 12, travel_allowance: 1000, signer_name: "Studierendenwerk Musterstadt",
  }, { office: true });
  return { kind: "decision_letter", filename: "Bescheid_Vorjahr_Keller.pdf", content };
}

export const SAMPLE_SETS = [
  { id: "mira", person: "mira", defects: ["parent_unsigned", "host_missing"] as Defect[], title: { de: "Mira Sommer: Semester in Toronto", en: "Mira Sommer: semester in Toronto" }, note: { de: "Typische Fehler: Unterschrift der Eltern fehlt, Bestätigung der Gasthochschule fehlt.", en: "Typical mistakes: parent signature missing, host university confirmation missing." } },
  { id: "jonas", person: "jonas", defects: ["contract_unsigned"] as Defect[], title: { de: "Jonas Weber: Praktikum in Lissabon", en: "Jonas Weber: internship in Lisbon" }, note: { de: "Typischer Fehler: Praktikumsvertrag nicht unterschrieben.", en: "Typical mistake: internship contract not signed." } },
  { id: "paul", person: "paul", defects: ["unclear_income"] as Defect[], title: { de: "Paul Neumann: Praktikum in Rotterdam", en: "Paul Neumann: internship in Rotterdam" }, note: { de: "Typischer Fehler: Einkommensbetrag im Steuerbescheid unleserlich (Scan). Das Lesen ist unsicher und geht zur Prüfung durch eine Person.", en: "Typical mistake: the income amount on the tax notice is smudged (scan). Reading is doubtful and goes to a person for review." } },
  { id: "lea", person: "lea", defects: [] as Defect[], title: { de: "Lea Martin: Semester in Madrid", en: "Lea Martin: semester in Madrid" }, note: { de: "Vollständig und korrekt.", en: "Complete and correct." } },
];

/** Formblatt 8, only needed when the parents do not pay the maintenance that is counted. */
export function formblatt8(p: SamplePerson): GeneratedDoc {
  const name = `${p.student.firstName} ${p.student.lastName}`;
  return {
    kind: "fb08",
    filename: "Formblatt8_Vorausleistung.pdf",
    content: renderDocument("fb08", { name, parent_name: p.parents.name, reason: "Unterhalt wird nicht gezahlt", refused_since: "2026-09-01", parents_asked: "Ja" }, { student: true }),
  };
}

/** A form the office does not know yet. Used to try the "propose a template" flow. */
export const PROPOSAL_SAMPLE_TITLE = "Formblatt 7: Antrag auf Aktualisierung (§ 24 Abs. 3 BAföG)";
export function proposalSample(): GeneratedDoc {
  const lines: PdfLine[] = [
    { text: "Studierendenwerk Musterstadt", size: 10 },
    { text: PROPOSAL_SAMPLE_TITLE, size: 16, bold: true, gap: 10 },
    { text: "Name der antragstellenden Person: Mira Sommer", gap: 4 },
    { text: "Name des Elternteils: Katrin Sommer", gap: 4 },
    { text: "Einkommensjahr laut Bescheid: 2025", gap: 4 },
    { text: "Einkommen laut Bescheid (EUR): 78000", gap: 4 },
    { text: "Voraussichtliches Einkommen im Bewilligungszeitraum (EUR): 52000", gap: 4 },
    { text: "Grund der Minderung: Elternteil arbeitet in Teilzeit", gap: 4 },
    { text: "Nachweise liegen bei: Ja", gap: 4 },
    { text: "Unterschrift Antragsteller:in: Mira Sommer (gezeichnet)", gap: 22, rule: true },
    { text: "BEISPIELDOKUMENT: fiktive Behörde und erfundene Daten. Kein echtes Dokument.", size: 8, gap: 60 },
  ];
  return { kind: "unknown", filename: "Beispiel_Formblatt7_fuer_Vorlagenvorschlag.pdf", content: buildPdf(lines) };
}
