import { BUILTIN_TEMPLATES, type DocumentKind, type DocumentTemplate, type Extraction } from "@digieurope/shared";
import { buildPdf, readPdfLines, type PdfLine } from "./pdf.js";

/** What the reader needs to know about a template. */
export interface DocSpec {
  kind: string;
  title: string;
  fields: [key: string, label: string][];
  sigs: [key: string, label: string][];
  /** The English version of the same document. The reader recognises both. */
  alt?: { title: string; fields: [key: string, label: string][]; sigs: [key: string, label: string][] };
}

export const specOf = (t: DocumentTemplate): DocSpec => ({
  kind: t.id,
  title: t.title,
  fields: t.fields.map((f) => [f.key, f.label]),
  sigs: t.signatures.map((x) => [x.key, x.label]),
  ...(t.en
    ? { alt: { title: t.en.title, fields: t.fields.map((f) => [f.key, t.en!.fields[f.key] ?? f.label] as [string, string]), sigs: t.signatures.map((x) => [x.key, t.en!.signatures[x.key] ?? x.label] as [string, string]) } }
    : {}),
});

/** The built-in templates. Accepted template proposals are added by the caller. */
export const DOC_SPECS: DocSpec[] = BUILTIN_TEMPLATES.map(specOf);

export const specFor = (kind: DocumentKind, specs: DocSpec[] = DOC_SPECS) => specs.find((s) => s.kind === kind);

const FOOTER = "BEISPIELDOKUMENT: fiktive Behörde und erfundene Daten. Kein echtes Dokument.";
const FOOTER_EN = "SAMPLE DOCUMENT: fictional authority and invented data. Not a real document.";
/** English words a sample document may use, mapped to the values the rules and the estimate expect. */
const NORMAL: Record<string, string> = { yes: "Ja", no: "Nein", statutory: "gesetzlich", voluntary: "freiwillig", denied: "abgelehnt", granted: "bewilligt" };

/** Renders a sample document. Signatures: true = signed, false = line left empty. */
export function renderDocument(kind: DocumentKind, values: Record<string, string | number>, signed: Record<string, boolean> = {}, specs: DocSpec[] = DOC_SPECS, lang: "de" | "en" = "de"): Buffer {
  const base = specs.find((s) => s.kind === kind)!;
  const en = lang === "en" && base.alt;
  const spec = en ? { ...base, ...base.alt! } : base;
  const lines: PdfLine[] = [
    { text: "Studierendenwerk Musterstadt", size: 10 },
    { text: spec.title, size: 16, bold: true, gap: 10 },
  ];
  for (const [key, label] of spec.fields) lines.push({ text: `${label}: ${values[key] ?? ""}`, gap: 4 });
  for (const [key, label] of spec.sigs) {
    const name = String(values.signer_name ?? values.name ?? values.parent_name ?? "");
    lines.push({ text: `${label}: ${signed[key] === false ? (en ? "________ (missing)" : "________ (fehlt)") : `${name} (${en ? "signed" : "gezeichnet"})`}`, gap: 22, rule: true });
  }
  lines.push({ text: en ? FOOTER_EN : FOOTER, size: 8, gap: 60 });
  return buildPdf(lines);
}

const unreadable: Extraction = { readable: false, fields: {}, signatures: {} };

/** The "reader": turns a PDF into fields. Only documents of the office's known types are readable. */
export function extractDocument(content: Buffer, mimeType: string, specs: DocSpec[] = DOC_SPECS): { kind: DocumentKind; extraction: Extraction } {
  if (mimeType !== "application/pdf") return { kind: "unknown", extraction: unreadable };
  const lines = readPdfLines(content);
  const spec = specs.find((s) => lines.includes(s.title) || (s.alt && lines.includes(s.alt.title)));
  if (!spec) return { kind: "unknown", extraction: unreadable };
  const english = Boolean(spec.alt && lines.includes(spec.alt.title));
  const fieldLabels = english ? spec.alt!.fields : spec.fields;
  const sigLabels = english ? spec.alt!.sigs : spec.sigs;
  const fields: Record<string, string> = {};
  const signatures: Record<string, boolean> = {};
  for (const line of lines) {
    const i = line.indexOf(": ");
    if (i < 0) continue;
    const label = line.slice(0, i);
    const value = line.slice(i + 2).trim();
    const f = fieldLabels.find(([, l]) => l === label);
    if (f) fields[f[0]] = english ? (NORMAL[value.toLowerCase()] ?? value) : value;
    const s = sigLabels.find(([, l]) => l === label);
    if (s) signatures[s[0]] = value !== "" && !/fehlt|missing|_{3,}/i.test(value);
  }
  const found = Object.keys(fields).length > 0;
  // The template reader knows when a value is smudged or cut off: it marks those with a "?" or "unleserlich". Everything else is sure.
  const confidence = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, /\?|unleserlich|illegible/i.test(v) ? 0.55 : 0.98]));
  const pages = Object.fromEntries(Object.keys(fields).map((k) => [k, 1]));
  return { kind: spec.kind, extraction: found ? { readable: true, fields, signatures, confidence, pages, engine: "builtin" } : unreadable };
}
