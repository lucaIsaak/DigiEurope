import { NODE_CATALOG, applyEdit, draftToProcess, editPrompt, generationPrompt, interpretEdit, parseDraft, parseEdit, simulateDraft, type Bilingual, type ConfigValue, type EditOp, type FlowEdge, type FlowNode, type GeneratedProcess, type Graph, type NodeKind, type SummaryLine } from "@digieurope/shared";

export type GenerateMode = "simulated" | "live";

export interface GenerateResult extends GeneratedProcess {
  /** Who wrote the draft. "simulated" is the keyword writer; "live" is a model. */
  mode: GenerateMode;
  /** Set when live was asked for but the simulated writer answered, and why. */
  fellBack?: string;
}

export const liveProcessAiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const processAiModel = () => process.env.PROCESS_AI_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

/**
 * Optional live writer. The model only proposes a draft in the vocabulary of the builder; the draft then goes through the
 * same clean-up and validation as the simulated one, so a model can never put an unknown step or rule on the canvas.
 * If the first answer has problems the builder would report, the model gets them once and may correct itself.
 * Any failure falls back to the simulated writer.
 */
export async function generateLive(description: string, fetchImpl: typeof fetch = fetch): Promise<GenerateResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ...draftToProcess(simulateDraft(description)), mode: "simulated", fellBack: "No ANTHROPIC_API_KEY is set." };
  const system = generationPrompt();
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: description.slice(0, 4000) }];
  const ask = async (): Promise<string> => {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: processAiModel(), max_tokens: 4000, system, messages }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) throw new Error(`The AI service answered with status ${res.status}.`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    return body.content?.find((c) => c.type === "text")?.text ?? "";
  };
  try {
    let text = await ask();
    let draft = parseDraft(text);
    if (!draft) throw new Error("The answer was not a usable process.");
    let result = draftToProcess(draft);
    if (result.issues.length) {
      messages.push({ role: "assistant", content: text }, { role: "user", content: `The builder reports these problems. Fix them and reply with the whole JSON again:\n${result.issues.map((i) => `- ${i.message.en}`).join("\n")}` });
      text = await ask();
      draft = parseDraft(text);
      if (draft) result = draftToProcess(draft);
    }
    return { ...result, mode: "live" };
  } catch (e) {
    return { ...draftToProcess(simulateDraft(description)), mode: "simulated", fellBack: e instanceof Error ? e.message : "The AI service could not be reached." };
  }
}

export async function generateProcessFrom(description: string, mode: GenerateMode, fetchImpl?: typeof fetch): Promise<GenerateResult> {
  if (mode === "live") return generateLive(description, fetchImpl);
  return { ...draftToProcess(simulateDraft(description)), mode: "simulated" };
}

/* ───────────── the assistant: change a process by talking about it ───────────── */

export interface AssistResult {
  reply: string;
  /** What would change, as plain sentences. Nothing is applied here: the page shows it and the person decides. */
  changes: Bilingual[];
  skipped: Bilingual[];
  ops: EditOp[];
  summary?: SummaryLine[];
  proposal?: Graph;
  action?: "document";
  unmapped: Bilingual[];
  mode: GenerateMode;
  fellBack?: string;
}

/** The process as the page sends it, reduced to what the builder knows. Never trusted as it comes. */
export function asGraph(v: unknown): Graph | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges) || o.nodes.length > 80) return null;
  const nodes: FlowNode[] = [];
  for (const n of o.nodes as Record<string, unknown>[]) {
    if (!n || typeof n.id !== "string" || typeof n.kind !== "string" || !(n.kind in NODE_CATALOG)) continue;
    const pos = n.position as { x?: unknown; y?: unknown } | undefined;
    nodes.push({
      id: n.id.slice(0, 60),
      kind: n.kind as NodeKind,
      name: typeof n.name === "string" ? n.name.slice(0, 80) : undefined,
      position: { x: Number(pos?.x) || 0, y: Number(pos?.y) || 0 },
      config: n.config && typeof n.config === "object" ? (Object.fromEntries(Object.entries(n.config as Record<string, unknown>).filter(([, x]) => typeof x === "string" || typeof x === "number")) as Record<string, ConfigValue>) : {},
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = (o.edges as Record<string, unknown>[])
    .filter((e) => e && typeof e.source === "string" && typeof e.target === "string" && ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ id: String(e.id ?? `${e.source}:${e.sourceHandle}`), source: String(e.source), sourceHandle: String(e.sourceHandle ?? "out"), target: String(e.target) }));
  return { nodes, edges };
}

const reviewOps = (g: Graph, ops: EditOp[]) => (ops.length ? applyEdit(g, ops) : null);

/** The simulated assistant: understands common requests with keywords, and says plainly when it does not. */
export function assistSimulated(message: string, g: Graph, lang: "de" | "en"): AssistResult {
  const i = interpretEdit(message, g);
  const r = reviewOps(g, i.ops);
  const noteLine = (xs: Bilingual[]) => xs.map((x) => `• ${x[lang]}`).join("\n");
  const reply = [i.reply[lang], r && r.skipped.length ? noteLine(r.skipped) : "", i.unmapped.length ? noteLine(i.unmapped) : ""].filter(Boolean).join("\n");
  return { reply, changes: r?.changes ?? [], skipped: r?.skipped ?? [], ops: i.ops, summary: i.summary, proposal: i.proposal, action: i.action, unmapped: i.unmapped, mode: "simulated" };
}

export async function assistLive(message: string, g: Graph, lang: "de" | "en", history: { role: "user" | "assistant"; content: string }[], fetchImpl: typeof fetch = fetch): Promise<AssistResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  const fallback = (why: string): AssistResult => ({ ...assistSimulated(message, g, lang), fellBack: why });
  if (!key) return fallback("No ANTHROPIC_API_KEY is set.");
  // Questions about the process (explain, check, describe) are answered by the same code in both modes: they need no model.
  const local = interpretEdit(message, g);
  if (local.summary || local.action || (local.ops.length === 0 && /\b(?:mistakes?|wrong|errors?)\b/i.test(message))) return { ...assistSimulated(message, g, lang), mode: "live" };
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: processAiModel(), max_tokens: 1500, system: `${editPrompt(g)}\nReply in ${lang === "de" ? "German" : "English"}.`, messages: [...history.slice(-8), { role: "user", content: message.slice(0, 1500) }] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`The AI service answered with status ${res.status}.`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const parsed = parseEdit(body.content?.find((c) => c.type === "text")?.text ?? "");
    if (!parsed) throw new Error("The answer was not usable.");
    const r = reviewOps(g, parsed.ops);
    return { reply: parsed.reply || (lang === "de" ? "Das würde ich ändern:" : "Here is what I would change:"), changes: r?.changes ?? [], skipped: r?.skipped ?? [], ops: parsed.ops, unmapped: [], mode: "live" };
  } catch (e) {
    return fallback(e instanceof Error ? e.message : "The AI service could not be reached.");
  }
}

export async function assistProcess(message: string, g: Graph, mode: GenerateMode, lang: "de" | "en", history: { role: "user" | "assistant"; content: string }[], fetchImpl?: typeof fetch): Promise<AssistResult> {
  return mode === "live" ? assistLive(message, g, lang, history, fetchImpl) : assistSimulated(message, g, lang);
}
