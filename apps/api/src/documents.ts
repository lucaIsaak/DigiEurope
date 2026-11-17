import { BUILTIN_TEMPLATES, type DocumentKind, type DocumentTemplate, type Extraction } from "@digieurope/shared";
import { buildPdf, readPdfLines, type PdfLine } from "./pdf.js";

/** What the reader needs to know about a template. */
export interface DocSpec {
  kind: string;
  title: string;
  fields: [key: string, label: string][];
  sigs: [key: string, label: string][];
}

export const specOf = (t: DocumentTemplate): DocSpec => ({
  kind: t.id,
  title: t.title,
  fields: t.fields.map((f) => [f.key, f.label]),
  sigs: t.signatures.map((x) => [x.key, x.label]),
});

/** The built-in templates. Accepted template proposals are added by the caller. */
export const DOC_SPECS: DocSpec[] = BUILTIN_TEMPLATES.map(specOf);

export const specFor = (kind: DocumentKind, specs: DocSpec[] = DOC_SPECS) => specs.find((s) => s.kind === kind);

const FOOTER = "BEISPIELDOKUMENT: fiktive Behörde und erfundene Daten. Kein echtes Dokument.";

/** Renders a sample document. Signatures: true = signed, false = line left empty. */
export function renderDocument(kind: DocumentKind, values: Record<string, string | number>, signed: Record<string, boolean> = {}, specs: DocSpec[] = DOC_SPECS): Buffer {
  const spec = specs.find((s) => s.kind === kind)!;
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
export function extractDocument(content: Buffer, mimeType: string, specs: DocSpec[] = DOC_SPECS): { kind: DocumentKind; extraction: Extraction } {
  if (mimeType !== "application/pdf") return { kind: "unknown", extraction: unreadable };
  const lines = readPdfLines(content);
  const spec = specs.find((s) => lines.includes(s.title));
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
