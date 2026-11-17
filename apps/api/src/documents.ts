import type { DocumentKind, Extraction } from "@digieurope/shared";
import { buildPdf, readPdfLines, type PdfLine } from "./pdf.js";

interface DocSpec {
  kind: Exclude<DocumentKind, "unknown">;
  title: string;
  fields: [key: string, label: string][];
  sigs: [key: string, label: string][];
}

/** The document types the office accepts, with the labels the reader looks for. */
export const DOC_SPECS: DocSpec[] = [
  {
    kind: "application_form",
    title: "Antrag auf Ausbildungsförderung im Ausland (Formblatt 1)",
    fields: [["name", "Name der antragstellenden Person"], ["birth_date", "Geburtsdatum"], ["university", "Deutsche Hochschule"], ["destination", "Zielland"], ["stay_type", "Art des Aufenthalts"], ["period_from", "Aufenthalt von"], ["period_to", "Aufenthalt bis"]],
    sigs: [["student", "Unterschrift Antragsteller:in"]],
  },
  {
    kind: "enrollment_cert",
    title: "Immatrikulationsbescheinigung (§ 9 BAföG)",
    fields: [["name", "Name"], ["university", "Hochschule"], ["term", "Semester"], ["course", "Studiengang"]],
    sigs: [],
  },
  {
    kind: "host_confirmation",
    title: "Bestätigung der Gasthochschule",
    fields: [["name", "Name der Studierenden"], ["host_institution", "Gasthochschule"], ["country", "Land"], ["period_from", "Studienzeit von"], ["period_to", "Studienzeit bis"]],
    sigs: [["host", "Unterschrift und Stempel Gasthochschule"]],
  },
  {
    kind: "internship_contract",
    title: "Praktikumsvertrag",
    fields: [["name", "Praktikant:in"], ["company", "Praktikumsstelle"], ["country", "Land"], ["period_from", "Beginn"], ["period_to", "Ende"]],
    sigs: [["intern", "Unterschrift Praktikant:in"], ["employer", "Unterschrift Praktikumsstelle"]],
  },
  {
    kind: "internship_uni_confirmation",
    title: "Bestätigung der Hochschule zum Pflichtpraktikum",
    fields: [["name", "Name der Studierenden"], ["mandatory", "Praktikum vorgeschrieben"], ["min_weeks", "Mindestdauer in Wochen"]],
    sigs: [["university", "Unterschrift Hochschule"]],
  },
  {
    kind: "health_insurance",
    title: "Versicherungsnachweis Kranken- und Pflegeversicherung",
    fields: [["name", "Versicherte Person"], ["insurer", "Versicherer"], ["insurance_type", "Art der Versicherung"], ["covers_abroad", "Schutz im Zielland"]],
    sigs: [],
  },
  {
    kind: "tuition_waiver_proof",
    title: "Nachweis zum Erlass oder zur Ermäßigung der Studiengebühren",
    fields: [["name", "Name der Studierenden"], ["requested", "Erlass oder Ermäßigung beantragt"], ["result", "Ergebnis"], ["fees", "Gebühren nach Ermäßigung (EUR)"]],
    sigs: [],
  },
  {
    kind: "parent_form",
    title: "Formblatt 3: Angaben zum Einkommen der Eltern",
    fields: [["student_name", "Name der Tochter oder des Sohnes"], ["parent_name", "Name des Elternteils"], ["parents_married", "Eltern verheiratet"], ["siblings_in_education", "Geschwister in förderfähiger Ausbildung"]],
    sigs: [["parent", "Unterschrift Elternteil"]],
  },
  {
    kind: "parent_tax",
    title: "Einkommensteuerbescheid (Auszug)",
    fields: [["parent_name", "Steuerpflichtige Person"], ["tax_year", "Veranlagungsjahr"], ["sum_of_income", "Summe der Einkünfte (EUR)"], ["income_tax", "Festgesetzte Einkommensteuer (EUR)"]],
    sigs: [],
  },
  {
    kind: "decision_letter",
    title: "Bescheid über Ausbildungsförderung im Ausland",
    fields: [
      ["name", "Antragsteller:in"], ["reference", "Aktenzeichen"], ["period_from", "Bewilligungszeitraum von"], ["period_to", "Bewilligungszeitraum bis"], ["country", "Land"],
      ["need_monthly", "Monatlicher Bedarf (EUR)"], ["parent_income_year", "Einkommensjahr der Eltern"], ["parent_net_monthly", "Anrechenbares Nettoeinkommen der Eltern pro Monat (EUR)"],
      ["parents_married", "Eltern verheiratet"], ["siblings_in_education", "Geschwister in förderfähiger Ausbildung"], ["parent_contribution", "Angerechnetes Elterneinkommen pro Monat (EUR)"],
      ["grant_monthly", "Monatliche Förderung (EUR)"], ["tuition_supplement", "Zuschuss Studiengebühren einmalig (EUR)"], ["tuition_months", "Gebührenzuschuss für Monate"], ["travel_allowance", "Reisekostenpauschale (EUR)"],
    ],
    sigs: [["office", "Unterschrift Sachbearbeitung"]],
  },
];

export const specFor = (kind: DocumentKind) => DOC_SPECS.find((s) => s.kind === kind);

const FOOTER = "BEISPIELDOKUMENT: fiktive Behörde und erfundene Daten. Kein echtes Dokument.";

/** Renders a sample document. Signatures: true = signed, false = line left empty. */
export function renderDocument(kind: Exclude<DocumentKind, "unknown">, values: Record<string, string | number>, signed: Record<string, boolean> = {}): Buffer {
  const spec = DOC_SPECS.find((s) => s.kind === kind)!;
  const lines: PdfLine[] = [
    { text: "Studierendenwerk Musterstadt", size: 10 },
    { text: spec.title, size: 16, bold: true, gap: 10 },
  ];
  for (const [key, label] of spec.fields) lines.push({ text: `${label}: ${values[key] ?? ""}`, gap: 4 });
  for (const [key, label] of spec.sigs) {
    const name = String(values.signer_name ?? values.name ?? values.parent_name ?? "");
    lines.push({ text: `${label}: ${signed[key] === false ? "________ (fehlt)" : `${name} (gezeichnet)`}`, gap: 22, rule: true });
  }
  lines.push({ text: FOOTER, size: 8, gap: 60 });
  return buildPdf(lines);
}

const unreadable: Extraction = { readable: false, fields: {}, signatures: {} };

/** The "reader": turns a PDF into fields. Only documents of the office's known types are readable. */
export function extractDocument(content: Buffer, mimeType: string): { kind: DocumentKind; extraction: Extraction } {
  if (mimeType !== "application/pdf") return { kind: "unknown", extraction: unreadable };
  const lines = readPdfLines(content);
  const spec = DOC_SPECS.find((s) => lines.includes(s.title));
  if (!spec) return { kind: "unknown", extraction: unreadable };
  const fields: Record<string, string> = {};
  const signatures: Record<string, boolean> = {};
  for (const line of lines) {
    const i = line.indexOf(": ");
    if (i < 0) continue;
    const label = line.slice(0, i);
    const value = line.slice(i + 2).trim();
    const f = spec.fields.find(([, l]) => l === label);
    if (f) fields[f[0]] = value;
    const s = spec.sigs.find(([, l]) => l === label);
    if (s) signatures[s[0]] = value !== "" && !/fehlt|_{3,}/.test(value);
  }
  const found = Object.keys(fields).length > 0;
  // The template reader knows when a value is smudged or cut off: it marks those with a "?" or "unleserlich". Everything else is sure.
  const confidence = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, /\?|unleserlich/i.test(v) ? 0.55 : 0.98]));
  const pages = Object.fromEntries(Object.keys(fields).map((k) => [k, 1]));
  return { kind: spec.kind, extraction: found ? { readable: true, fields, signatures, confidence, pages, engine: "builtin" } : unreadable };
}
