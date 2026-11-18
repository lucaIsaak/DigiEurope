import { CONNECTORS, NODE_CATALOG, type FlowNode, type ProcessDef, type ProcessInput } from "./process.js";
import { DOCUMENT_KINDS, type Bilingual, type DocumentKind, type ExtractionMethod, type Lang } from "./types.js";

/** Office-level settings that influence how a process behaves. Compared next to the process itself. */
export interface OfficeSettings {
  approvedRules: string[];
  extractionDefault: ExtractionMethod;
  extractionByType: Partial<Record<DocumentKind, { method: ExtractionMethod; minConfidence: number }>>;
  slaDays: number;
  languages: Lang[];
}

/**
 * What makes two steps "the same step" when comparing offices: the kind of step and the settings that change its meaning.
 * Local wording (team names, message texts, subjects) is ignored on purpose.
 */
export function stepSignature(n: Pick<FlowNode, "kind" | "config">): string {
  const c = n.config;
  switch (n.kind) {
    case "connector": return `connector|${c.system}.${c.action}`;
    case "condition": return `condition|${c.field} ${c.op}`;
    case "read_documents": return `read_documents|${c.scope}/${c.method ?? "default"}`;
    case "trigger": return `trigger|${c.source}`;
    case "send_notification": return `send_notification|${c.to}`;
    case "ai_draft_mail": return "ai_draft_mail|";
    default: return `${n.kind}|`;
  }
}

export function signatureLabel(sig: string): { kind: string; title: Bilingual; detail: string } {
  const [kind, detail = ""] = sig.split("|");
  const title = NODE_CATALOG[kind as keyof typeof NODE_CATALOG]?.title ?? { de: kind!, en: kind! };
  if (kind === "connector") {
    const [system, action] = detail.split(".");
    const sys = CONNECTORS.find((c) => c.id === system);
    const act = sys?.actions.find((a) => a.id === action);
    return { kind, title, detail: `${sys?.name.en ?? system} · ${act?.label.en ?? action}` };
  }
  return { kind: kind!, title, detail };
}

function counts(xs: string[]) {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/** Jaccard similarity of two multisets. Two empty sets are identical. */
export function jaccard(a: string[], b: string[]): number {
  const ca = counts(a);
  const cb = counts(b);
  let inter = 0;
  let union = 0;
  for (const k of new Set([...ca.keys(), ...cb.keys()])) {
    const x = ca.get(k) ?? 0;
    const y = cb.get(k) ?? 0;
    inter += Math.min(x, y);
    union += Math.max(x, y);
  }
  return union === 0 ? 1 : inter / union;
}

const sigOf = (def: Pick<ProcessDef, "nodes">) => new Map(def.nodes.map((n) => [n.id, stepSignature(n)]));
const edgeSigs = (def: Pick<ProcessDef, "nodes" | "edges">) => {
  const sig = sigOf(def);
  return def.edges.map((e) => `${sig.get(e.source)}#${e.sourceHandle}>${sig.get(e.target)}`);
};

export interface ProcessDiff {
  /** Steps present in the base but not in the other process, and the reverse. */
  stepsOnlyInA: string[];
  stepsOnlyInB: string[];
  /** Connections (step, output, next step) only in one of them. */
  edgesOnlyInA: string[];
  edgesOnlyInB: string[];
  /** Node ids with no counterpart in the other process, for highlighting. */
  unmatchedA: string[];
  unmatchedB: string[];
  /** 0 to 1: how similar steps and connections are. */
  structure: number;
}

function onlyIn(a: string[], b: string[]): string[] {
  const cb = counts(b);
  const out: string[] = [];
  for (const x of a) {
    const left = cb.get(x) ?? 0;
    if (left > 0) cb.set(x, left - 1);
    else out.push(x);
  }
  return out;
}

/** Greedy matching of equal steps; whatever is left over has no counterpart. */
function unmatched(a: FlowNode[], b: FlowNode[]): string[] {
  const pool = counts(b.map(stepSignature));
  const out: string[] = [];
  for (const n of a) {
    const s = stepSignature(n);
    const left = pool.get(s) ?? 0;
    if (left > 0) pool.set(s, left - 1);
    else out.push(n.id);
  }
  return out;
}

export function diffProcesses(a: Pick<ProcessDef, "nodes" | "edges">, b: Pick<ProcessDef, "nodes" | "edges">): ProcessDiff {
  const sa = a.nodes.map(stepSignature);
  const sb = b.nodes.map(stepSignature);
  const ea = edgeSigs(a);
  const eb = edgeSigs(b);
  return {
    stepsOnlyInA: onlyIn(sa, sb),
    stepsOnlyInB: onlyIn(sb, sa),
    edgesOnlyInA: onlyIn(ea, eb),
    edgesOnlyInB: onlyIn(eb, ea),
    unmatchedA: unmatched(a.nodes, b.nodes),
    unmatchedB: unmatched(b.nodes, a.nodes),
    structure: (jaccard(sa, sb) + jaccard(ea, eb)) / 2,
  };
}

export const systemsOf = (def: Pick<ProcessDef, "nodes">): string[] =>
  [...new Set(def.nodes.filter((n) => n.kind === "connector").map((n) => `${n.config.system}.${n.config.action}`))].sort();

export interface SettingsComparison {
  score: number;
  parts: { key: "rules" | "extraction" | "systems" | "sla" | "languages"; score: number }[];
}

const effectiveMethod = (s: OfficeSettings, kind: DocumentKind) => s.extractionByType[kind]?.method ?? s.extractionDefault;

export function compareSettings(a: { settings: OfficeSettings; def: Pick<ProcessDef, "nodes"> }, b: { settings: OfficeSettings; def: Pick<ProcessDef, "nodes"> }): SettingsComparison {
  const parts: SettingsComparison["parts"] = [
    { key: "rules", score: jaccard(a.settings.approvedRules, b.settings.approvedRules) },
    { key: "extraction", score: DOCUMENT_KINDS.filter((k) => effectiveMethod(a.settings, k) === effectiveMethod(b.settings, k)).length / DOCUMENT_KINDS.length },
    { key: "systems", score: jaccard(systemsOf(a.def), systemsOf(b.def)) },
    { key: "sla", score: Math.max(0, 1 - Math.abs(a.settings.slaDays - b.settings.slaDays) / 10) },
    { key: "languages", score: jaccard(a.settings.languages, b.settings.languages) },
  ];
  return { score: parts.reduce((s, p) => s + p.score, 0) / parts.length, parts };
}

export interface Harmony {
  /** All 0 to 100. */
  structure: number;
  settings: number;
  inputs: number;
  total: number;
}

/** How close an office is to the reference: 60 % structure of the process, 40 % settings. */
/** A required input as a comparable string: what it is, whether it is required, and when it applies. */
export function inputSignature(i: ProcessInput): string {
  return `${i.type}:${i.ref}:${i.required ? "required" : "optional"}:${JSON.stringify(i.when ?? null)}`;
}

export interface InputsDiff {
  onlyInA: string[];
  onlyInB: string[];
  /** 0 to 1. */
  similarity: number;
}

export function diffInputs(a: { inputs?: ProcessInput[] }, b: { inputs?: ProcessInput[] }): InputsDiff {
  const sa = (a.inputs ?? []).map(inputSignature);
  const sb = (b.inputs ?? []).map(inputSignature);
  return { onlyInA: onlyIn(sa, sb), onlyInB: onlyIn(sb, sa), similarity: jaccard(sa, sb) };
}

/** How close an office is to the reference: 50 % structure of the process, 25 % settings and systems, 25 % required inputs. */
export function harmony(office: { def: ProcessDef; settings: OfficeSettings }, reference: { def: ProcessDef; settings: OfficeSettings }): Harmony {
  const structure = diffProcesses(office.def, reference.def).structure;
  const settings = compareSettings(office, reference).score;
  const inputs = diffInputs(office.def, reference.def).similarity;
  return { structure: Math.round(structure * 100), settings: Math.round(settings * 100), inputs: Math.round(inputs * 100), total: Math.round((0.5 * structure + 0.25 * settings + 0.25 * inputs) * 100) };
}
