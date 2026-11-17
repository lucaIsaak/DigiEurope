import type { DocumentKind, Extraction, ExtractionMethod } from "@digieurope/shared";
import { DOC_SPECS, extractDocument, type DocSpec } from "./documents.js";
import type { OfficeConfig } from "./store.js";

export const DEFAULT_MIN_CONFIDENCE = 0.8;

export interface MethodInfo {
  id: ExtractionMethod;
  name: { de: string; en: string };
  description: { de: string; en: string };
  /** connected: really works. simulated: behaves like the real thing in the demo. placeholder: not connected, falls back. */
  status: "connected" | "simulated" | "placeholder";
}

export const aiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

export function methodsInfo(): MethodInfo[] {
  return [
    {
      id: "builtin",
      name: { de: "Eingebauter Vorlagenleser", en: "Built-in template reader" },
      description: { de: "Liest die bekannten Formulare des Prototyps. Schnell, ohne Kosten, nur für feste Vorlagen.", en: "Reads the prototype's known forms. Fast and free, for fixed templates only." },
      status: "connected",
    },
    {
      id: "ai",
      name: { de: "KI-Dokumentenlesen", en: "AI document reading" },
      description: { de: "Ein KI-Modell liest PDFs und Scans und füllt die bestätigten Felder, mit Sicherheit je Feld. Für uneinheitliche Dokumente und Fremdsprachen.", en: "An AI model reads PDFs and scans and fills the confirmed fields, with a confidence per field. For varied documents and foreign languages." },
      status: aiAvailable() ? "connected" : "simulated",
    },
    {
      id: "ocr_rules",
      name: { de: "OCR mit Regeln", en: "OCR with rules" },
      description: { de: "Texterkennung plus feste Feldpositionen oder Muster. Platzhalter: nicht angebunden.", en: "Text recognition plus fixed field positions or patterns. Placeholder: not connected." },
      status: "placeholder",
    },
    {
      id: "external",
      name: { de: "Externer Dienst", en: "External service" },
      description: { de: "Ein vorhandener Dienst des Amtes, zum Beispiel Azure Document Intelligence oder AWS Textract. Platzhalter: nicht angebunden.", en: "A service the office already has, for example Azure Document Intelligence or AWS Textract. Placeholder: not connected." },
      status: "placeholder",
    },
  ];
}

function flagReview(e: Extraction, min: number): Extraction {
  const low = e.readable && Object.values(e.confidence ?? {}).some((c) => c < min);
  return { ...e, needsReview: low };
}

type Read = { kind: DocumentKind; extraction: Extraction };

/** Reads a file with the AI reader: the model gets the document and the field list, and must return JSON. Never guesses. */
export async function aiExtract(content: Buffer, mimeType: string, fetchImpl: typeof fetch = fetch, specs: DocSpec[] = DOC_SPECS): Promise<Read | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const catalog = specs.map((s) => `- ${s.kind}: "${s.title}". Fields: ${s.fields.map(([k, l]) => `${k} (${l})`).join("; ")}.${s.sigs.length ? ` Signatures: ${s.sigs.map(([k, l]) => `${k} (${l})`).join("; ")}.` : ""}`).join("\n");
  const system =
    "You read German administrative documents for a student funding office. Identify which document type it is from the list and extract only the listed fields. " +
    "Never guess: if a value is missing, cut off or unreadable, return an empty string with confidence 0. Report the page number (1-based) for each field. " +
    "For signatures say whether a handwritten or digital signature is present. If the document is none of the listed types, return documentType \"unknown\".\n" +
    `Reply with JSON only: {"documentType": string, "fields": {key: {"value": string, "confidence": number 0..1, "page": number}}, "signatures": {key: {"present": boolean}}}\n\nDOCUMENT TYPES:\n${catalog}`;
  const block =
    mimeType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: content.toString("base64") } }
      : { type: "image", source: { type: "base64", media_type: mimeType, data: content.toString("base64") } };
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_EXTRACT_MODEL ?? "claude-sonnet-5-5",
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: [block, { type: "text", text: "Extract the fields as JSON." }] }],
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
      documentType?: string;
      fields?: Record<string, { value?: unknown; confidence?: unknown; page?: unknown }>;
      signatures?: Record<string, { present?: unknown }>;
    };
    const spec = specs.find((s) => s.kind === parsed.documentType);
    if (!spec) return { kind: "unknown", extraction: { readable: false, fields: {}, signatures: {}, engine: "ai" } };
    const fields: Record<string, string> = {};
    const confidence: Record<string, number> = {};
    const pages: Record<string, number> = {};
    for (const [k] of spec.fields) {
      const f = parsed.fields?.[k];
      if (!f) continue;
      fields[k] = String(f.value ?? "").trim();
      confidence[k] = fields[k] === "" ? 0 : Math.min(1, Math.max(0, Number(f.confidence) || 0));
      pages[k] = Math.max(1, Math.round(Number(f.page) || 1));
    }
    const signatures: Record<string, boolean> = {};
    for (const [k] of spec.sigs) signatures[k] = parsed.signatures?.[k]?.present === true;
    const readable = Object.values(fields).some((v) => v !== "");
    return { kind: spec.kind, extraction: { readable, fields, signatures, confidence, pages, engine: "ai" } };
  } catch {
    return null;
  }
}

/** Applies one method to a file. Methods that cannot run fall back to the built-in reader and say so in `note`. */
export async function readWithMethod(
  content: Buffer,
  mimeType: string,
  method: ExtractionMethod,
  minConfidence: number,
  fetchImpl: typeof fetch = fetch,
  specs: DocSpec[] = DOC_SPECS,
): Promise<Read> {
  const base = extractDocument(content, mimeType, specs);
  if (method === "builtin") return { kind: base.kind, extraction: flagReview({ ...base.extraction, engine: "builtin" }, minConfidence) };
  if (method === "ai") {
    const live = await aiExtract(content, mimeType, fetchImpl, specs);
    if (live) return { kind: live.kind, extraction: flagReview(live.extraction, minConfidence) };
    const note = aiAvailable() ? "AI reading failed; built-in reader used." : "No AI key set; simulated with the built-in reader.";
    return { kind: base.kind, extraction: flagReview({ ...base.extraction, engine: aiAvailable() ? "builtin" : "ai-simulated", note }, minConfidence) };
  }
  return { kind: base.kind, extraction: flagReview({ ...base.extraction, engine: "builtin", note: `${method} is a placeholder: not connected, built-in reader used.` }, minConfidence) };
}

/** Reads an uploaded file with the method the office configured for its document type. */
export async function readConfigured(content: Buffer, mimeType: string, config: OfficeConfig, override?: ExtractionMethod, fetchImpl: typeof fetch = fetch, specs: DocSpec[] = DOC_SPECS): Promise<Read> {
  const first = extractDocument(content, mimeType, specs);
  const setting = first.kind !== "unknown" ? config.extraction[first.kind] : undefined;
  const method = override ?? setting?.method ?? config.defaultMethod;
  return readWithMethod(content, mimeType, method, setting?.minConfidence ?? DEFAULT_MIN_CONFIDENCE, fetchImpl, specs);
}
