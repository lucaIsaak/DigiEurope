import { conditionIn, generateProcess } from "./generate.js";
import type { Bilingual } from "./types.js";
import { NODE_CATALOG, defaultConfig, outputsOf, uniqueStepName, validateProcess, type ConfigValue, type FlowEdge, type FlowNode, type NodeKind } from "./process.js";

/**
 * Editing a process in words. A person (or a model) asks for a change; what comes back is a short list of operations from a
 * fixed vocabulary, never a free-form rewrite. Every operation is checked before it is applied, and the person sees the result
 * as a list of plain sentences first. A change can only ever be one of the operations below, so a wrong answer cannot damage
 * the process or touch the rules: it can only be refused, or discarded by the person.
 */
export interface AddSpec {
  kind: NodeKind;
  name?: string;
  config?: Record<string, ConfigValue>;
}

export type Comparator = "eq" | "ne" | "gte" | "lte" | "contains";

export type EditOp =
  /** A step after another one, on one of its outputs. What the output led to before now follows the new step. */
  | { op: "add"; spec: AddSpec; after: string; handle?: string }
  | { op: "remove"; step: string }
  | { op: "rename"; step: string; name: string }
  | { op: "set"; step: string; key: string; value: ConfigValue }
  /** A condition on a connection. Both answers carry on to what the connection led to, each through its own extra step if one is given. */
  | { op: "branch"; on: { step: string; handle?: string }; field: string; cmp: Comparator; value: string; label?: string; yes?: AddSpec; no?: AddSpec }
  | { op: "connect"; from: string; handle?: string; to: string }
  | { op: "disconnect"; from: string; handle?: string };

export type Graph = { nodes: FlowNode[]; edges: FlowEdge[] };
export interface EditResult extends Graph {
  /** What changed, as plain sentences. */
  changes: Bilingual[];
  /** What could not be done, and why. */
  skipped: Bilingual[];
}

const b = (de: string, en: string): Bilingual => ({ de, en });
const kinds = Object.keys(NODE_CATALOG) as NodeKind[];
const COMPARATORS: Comparator[] = ["eq", "ne", "gte", "lte", "contains"];

export const stepName = (n: Pick<FlowNode, "kind" | "name">) => n.name?.trim() || NODE_CATALOG[n.kind].title.en;

/** Finds a step by id, by its name, or by what it is ("the caseworker", "payment", "the start"). */
export function findStep(g: Graph, ref: string): FlowNode | undefined {
  const r = ref.trim().replace(/^(?:the|a|an)\s+/i, "").replace(/\s+step$/i, "").replace(/^["“”']|["“”']$/g, "").toLowerCase();
  if (!r) return undefined;
  const byId = g.nodes.find((n) => n.id === ref || n.id.toLowerCase() === r);
  if (byId) return byId;
  const named = g.nodes.find((n) => stepName(n).toLowerCase() === r) ?? g.nodes.find((n) => stepName(n).toLowerCase().includes(r)) ?? g.nodes.find((n) => r.includes(stepName(n).toLowerCase()) && stepName(n).length > 4);
  if (named) return named;
  const kindWords: [RegExp, (n: FlowNode) => boolean][] = [
    [/start|trigger|arriv/, (n) => n.kind === "trigger"],
    [/caseworker|case worker|decision|decides|review/, (n) => n.kind === "human_task"],
    [/payment|pay/, (n) => n.kind === "connector" && String(n.config.system) === "payment"],
    [/wait|deadline|remind/, (n) => n.kind === "wait"],
    [/ask|request|missing|documents? request/, (n) => n.kind === "request_documents"],
    [/message|notif|e-?mail|tell|inform/, (n) => n.kind === "send_notification" || n.kind === "ai_draft_mail"],
    [/read/, (n) => n.kind === "read_documents"],
    [/rules?/, (n) => n.kind === "run_rules"],
    [/inputs?|complete/, (n) => n.kind === "check_inputs"],
    [/condition|decision point/, (n) => n.kind === "condition"],
    [/end|finish/, (n) => n.kind === "end"],
  ];
  for (const [re, test] of kindWords) if (re.test(r)) { const hit = g.nodes.find(test); if (hit) return hit; }
  return undefined;
}

const firstOut = (n: FlowNode) => outputsOf(n.kind)[0]?.id;
const edgeFrom = (g: Graph, id: string, handle: string) => g.edges.find((e) => e.source === id && e.sourceHandle === handle);
const nextId = (g: Graph, kind: string) => { let i = g.nodes.length + 1; while (g.nodes.some((n) => n.id === `${kind}-${i}`)) i++; return `${kind}-${i}`; };

function makeNode(g: Graph, spec: AddSpec, near: FlowNode | undefined): FlowNode {
  const cat = NODE_CATALOG[spec.kind];
  return {
    id: nextId(g, spec.kind),
    kind: spec.kind,
    name: uniqueStepName(spec.name ?? cat.title.en, g.nodes.map((n) => n.name ?? "")),
    position: { x: near?.position.x ?? 0, y: (near?.position.y ?? 0) + 160 },
    config: defaultConfig(spec.kind, spec.config ?? {}),
  };
}

const link = (g: Graph, from: string, handle: string, to: string) => {
  g.edges = g.edges.filter((e) => !(e.source === from && e.sourceHandle === handle));
  g.edges.push({ id: `${from}:${handle}`, source: from, sourceHandle: handle, target: to });
};

/** Applies operations to a copy of the process. An operation that cannot be done is skipped with its reason; the others still go through. */
export function applyEdit(def: Graph, ops: EditOp[]): EditResult {
  const g: Graph = { nodes: def.nodes.map((n) => ({ ...n, config: { ...n.config }, position: { ...n.position } })), edges: def.edges.map((e) => ({ ...e })) };
  const changes: Bilingual[] = [];
  const skipped: Bilingual[] = [];
  const miss = (ref: string) => skipped.push(b(`Ich finde keinen Schritt „${ref}“.`, `I can't find a step called “${ref}”.`));
  for (const op of ops.slice(0, 20)) {
    if (op.op === "add") {
      const src = findStep(g, op.after);
      if (!src) { miss(op.after); continue; }
      if (!kinds.includes(op.spec.kind)) { skipped.push(b("Diesen Schritt kenne ich nicht.", "I don't know that kind of step.")); continue; }
      const handle = op.handle ?? firstOut(src);
      if (!handle || !outputsOf(src.kind).some((o) => o.id === handle)) { skipped.push(b(`Nach „${stepName(src)}“ kann nichts folgen.`, `Nothing can follow “${stepName(src)}”.`)); continue; }
      const old = edgeFrom(g, src.id, handle)?.target;
      const node = makeNode(g, op.spec, src);
      g.nodes.push(node);
      link(g, src.id, handle, node.id);
      const out = firstOut(node);
      if (old && out) link(g, node.id, out, old);
      changes.push(b(`„${stepName(node)}“ nach „${stepName(src)}“ eingefügt.`, `Added “${stepName(node)}” after “${stepName(src)}”.`));
    } else if (op.op === "remove") {
      const n = findStep(g, op.step);
      if (!n) { miss(op.step); continue; }
      if (n.kind === "trigger") { skipped.push(b("Der Start kann nicht entfernt werden.", "The start cannot be removed.")); continue; }
      const outs = g.edges.filter((e) => e.source === n.id);
      const target = outs[0]?.target;
      for (const e of g.edges.filter((x) => x.target === n.id)) if (target && outs.length <= 1) link(g, e.source, e.sourceHandle, target);
      g.edges = g.edges.filter((e) => e.source !== n.id && e.target !== n.id);
      g.nodes = g.nodes.filter((x) => x.id !== n.id);
      changes.push(b(`„${stepName(n)}“ entfernt.`, `Removed “${stepName(n)}”.`));
    } else if (op.op === "rename") {
      const n = findStep(g, op.step);
      if (!n) { miss(op.step); continue; }
      const old = stepName(n);
      n.name = uniqueStepName(op.name.slice(0, 80), g.nodes.filter((x) => x.id !== n.id).map((x) => x.name ?? ""));
      changes.push(b(`„${old}“ heißt jetzt „${n.name}“.`, `Renamed “${old}” to “${n.name}”.`));
    } else if (op.op === "set") {
      const n = findStep(g, op.step);
      if (!n) { miss(op.step); continue; }
      const f = NODE_CATALOG[n.kind].fields.find((x) => x.key === op.key);
      if (!f) { skipped.push(b(`„${stepName(n)}“ hat die Einstellung „${op.key}“ nicht.`, `“${stepName(n)}” has no setting “${op.key}”.`)); continue; }
      let v: ConfigValue = op.value;
      if (f.type === "number") { v = Number(op.value); if (!Number.isFinite(v)) { skipped.push(b("Das ist keine Zahl.", "That is not a number.")); continue; } }
      if (f.type === "select" && !f.options?.some((o) => o.value === String(v))) { skipped.push(b(`„${String(v)}“ ist für „${f.label.de}“ nicht möglich.`, `“${String(v)}” is not an option for “${f.label.en}”.`)); continue; }
      n.config[op.key] = v;
      changes.push(b(`„${f.label.de}“ bei „${stepName(n)}“ ist jetzt ${String(v)}.`, `“${f.label.en}” of “${stepName(n)}” is now ${String(v)}.`));
    } else if (op.op === "branch") {
      const src = findStep(g, op.on.step);
      if (!src) { miss(op.on.step); continue; }
      const handle = op.on.handle ?? firstOut(src);
      if (!handle || !outputsOf(src.kind).some((o) => o.id === handle)) { skipped.push(b(`Nach „${stepName(src)}“ kann keine Bedingung stehen.`, `A condition cannot follow “${stepName(src)}” there.`)); continue; }
      if (!COMPARATORS.includes(op.cmp)) { skipped.push(b("Diesen Vergleich kenne ich nicht.", "I don't know that comparison.")); continue; }
      const old = edgeFrom(g, src.id, handle)?.target;
      const cond = makeNode(g, { kind: "condition", name: op.label ?? "Check", config: { field: op.field, op: op.cmp, value: op.value } }, src);
      g.nodes.push(cond);
      link(g, src.id, handle, cond.id);
      const through = (answer: "yes" | "no", spec: AddSpec | undefined) => {
        let to = old;
        if (spec && kinds.includes(spec.kind)) {
          const extra = makeNode(g, spec, cond);
          g.nodes.push(extra);
          const out = firstOut(extra);
          if (old && out) link(g, extra.id, out, old);
          to = extra.id;
        }
        if (!to) { const end = makeNode(g, { kind: "end", name: "Finished" }, cond); g.nodes.push(end); to = end.id; }
        link(g, cond.id, answer, to);
      };
      through("yes", op.yes);
      through("no", op.no);
      changes.push(b(`Entscheidungspunkt „${stepName(cond)}“ nach „${stepName(src)}“ eingefügt.`, `Added the decision point “${stepName(cond)}” after “${stepName(src)}”.`));
      const yesNode = g.nodes.find((n) => n.id === g.edges.find((e) => e.source === cond.id && e.sourceHandle === "yes")?.target);
      const noNode = g.nodes.find((n) => n.id === g.edges.find((e) => e.source === cond.id && e.sourceHandle === "no")?.target);
      if (op.yes && yesNode) changes.push(b(`Bei „ja“: „${stepName(yesNode)}“, danach geht es normal weiter.`, `If yes: “${stepName(yesNode)}”, then it carries on as before.`));
      if (op.no && noNode) changes.push(b(`Bei „nein“: „${stepName(noNode)}“, danach geht es normal weiter.`, `If no: “${stepName(noNode)}”, then it carries on as before.`));
      if (!op.yes && !op.no) changes.push(b("Beide Antworten führen zunächst weiter wie bisher. Legen Sie fest, was bei „ja“ oder „nein“ anders laufen soll.", "Both answers carry on as before for now. Say what should happen differently for yes or no."));
    } else if (op.op === "connect") {
      const from = findStep(g, op.from);
      const to = findStep(g, op.to);
      if (!from) { miss(op.from); continue; }
      if (!to) { miss(op.to); continue; }
      const handle = op.handle ?? firstOut(from);
      if (!handle || !outputsOf(from.kind).some((o) => o.id === handle) || from.id === to.id || to.kind === "trigger") { skipped.push(b("Diese Verbindung ist nicht möglich.", "That connection is not possible.")); continue; }
      link(g, from.id, handle, to.id);
      changes.push(b(`„${stepName(from)}“ führt jetzt zu „${stepName(to)}“.`, `“${stepName(from)}” now leads to “${stepName(to)}”.`));
    } else if (op.op === "disconnect") {
      const from = findStep(g, op.from);
      if (!from) { miss(op.from); continue; }
      const handle = op.handle ?? firstOut(from);
      if (!handle || !edgeFrom(g, from.id, handle)) { skipped.push(b("Da ist keine Verbindung.", "There is no connection there.")); continue; }
      g.edges = g.edges.filter((e) => !(e.source === from.id && e.sourceHandle === handle));
      changes.push(b(`Verbindung von „${stepName(from)}“ gelöst.`, `Removed the connection from “${stepName(from)}”.`));
    }
  }
  return { ...g, changes, skipped };
}

/** Reads operations from untrusted JSON (a model's answer). Anything that is not a known operation is dropped. */
export function sanitizeOps(v: unknown): EditOp[] {
  if (!Array.isArray(v)) return [];
  const s = (x: unknown, n = 120) => (typeof x === "string" ? x.slice(0, n) : undefined);
  const spec = (x: unknown): AddSpec | undefined => {
    if (!x || typeof x !== "object") return undefined;
    const o = x as Record<string, unknown>;
    if (typeof o.kind !== "string" || !kinds.includes(o.kind as NodeKind) || o.kind === "trigger") return undefined;
    const config = o.config && typeof o.config === "object" ? (Object.fromEntries(Object.entries(o.config as Record<string, unknown>).filter(([, y]) => typeof y === "string" || typeof y === "number")) as Record<string, ConfigValue>) : undefined;
    return { kind: o.kind as NodeKind, name: s(o.name, 80), config };
  };
  const out: EditOp[] = [];
  for (const raw of v.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    if (o.op === "add" && spec(o.spec) && s(o.after)) out.push({ op: "add", spec: spec(o.spec)!, after: s(o.after)!, handle: s(o.handle, 40) });
    else if (o.op === "remove" && s(o.step)) out.push({ op: "remove", step: s(o.step)! });
    else if (o.op === "rename" && s(o.step) && s(o.name, 80)) out.push({ op: "rename", step: s(o.step)!, name: s(o.name, 80)! });
    else if (o.op === "set" && s(o.step) && s(o.key, 40) && (typeof o.value === "string" || typeof o.value === "number")) out.push({ op: "set", step: s(o.step)!, key: s(o.key, 40)!, value: o.value });
    else if (o.op === "branch" && o.on && typeof o.on === "object" && s((o.on as Record<string, unknown>).step) && s(o.field, 40) && COMPARATORS.includes(o.cmp as Comparator) && (typeof o.value === "string" || typeof o.value === "number")) {
      const on = o.on as Record<string, unknown>;
      out.push({ op: "branch", on: { step: s(on.step)!, handle: s(on.handle, 40) }, field: s(o.field, 40)!, cmp: o.cmp as Comparator, value: String(o.value), label: s(o.label, 80), yes: spec(o.yes), no: spec(o.no) });
    } else if (o.op === "connect" && s(o.from) && s(o.to)) out.push({ op: "connect", from: s(o.from)!, handle: s(o.handle, 40), to: s(o.to)! });
    else if (o.op === "disconnect" && s(o.from)) out.push({ op: "disconnect", from: s(o.from)!, handle: s(o.handle, 40) });
  }
  return out;
}

/* ───────────── plain-language reading of a process ───────────── */

export interface SummaryLine { depth: number; text: Bilingual }

const sentence = (n: FlowNode): Bilingual => {
  const c = n.config;
  switch (n.kind) {
    case "trigger": return b("Wenn ein Antrag eingeht", "When an application arrives");
    case "check_inputs": return b("Prüfen, ob alles Nötige da ist", "Check that everything required is there");
    case "run_rules": return b("Die Regeln prüfen", "Check the rules");
    case "read_documents": return b("Die Unterlagen lesen", "Read the documents");
    case "review_fields": return b("Unklar gelesene Felder von einer Person prüfen lassen", "A person checks the unclear fields");
    case "human_task": return b("Eine Sachbearbeitung entscheidet", "A caseworker decides");
    case "ai_draft_mail": return b("Die KI entwirft eine Nachricht", "The AI drafts a message");
    case "request_documents": return b("Die antragstellende Person um Fehlendes bitten", "Ask the applicant for what is missing");
    case "send_notification": return b("Eine Nachricht an die Person senden", "Send a message to the applicant");
    case "wait": return b(`${String(c.days)} Tage warten`, `Wait ${String(c.days)} day${Number(c.days) === 1 ? "" : "s"}`);
    case "assign_team": return b(`Dem Team ${String(c.team)} zuweisen`, `Assign to ${String(c.team)}`);
    case "assign_caseworker": return b("Die zuständige Sachbearbeitung zuweisen", "Assign the responsible caseworker");
    case "connector": return b(`Das System „${String(c.system)}“ aufrufen`, `Call the system “${String(c.system)}”: ${String(c.action).replace(/_/g, " ")}`);
    case "http_request": return b("Ein anderes System über das Internet aufrufen", "Call another system");
    case "condition": return b(`Entscheidungspunkt: ${n.name ?? ""}`, `Decision point: ${n.name ?? "check"}`);
    case "end": return b(`Ende: ${n.name ?? ""}`, `End: ${n.name ?? "finished"}`);
    default: return b(stepName(n), stepName(n));
  }
};

/** The process as a numbered, indented story. Branches read "if …"; a step reached twice says where it was told before. */
export function summarizeProcess(def: Graph): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const seen = new Map<string, number>();
  const start = def.nodes.find((n) => n.kind === "trigger") ?? def.nodes[0];
  const walk = (id: string, depth: number) => {
    const n = def.nodes.find((x) => x.id === id);
    if (!n) return;
    const at = seen.get(id);
    if (at !== undefined) { lines.push({ depth, text: b(`weiter wie in Schritt ${at}`, `carries on as in step ${at}`) }); return; }
    const number = seen.size + 1;
    seen.set(id, number);
    const s = sentence(n);
    lines.push({ depth, text: b(`${number}. ${s.de}`, `${number}. ${s.en}`) });
    const outs = outputsOf(n.kind);
    if (outs.length <= 1) { const e = def.edges.find((x) => x.source === id); if (e) walk(e.target, depth); return; }
    for (const o of outs) {
      const e = def.edges.find((x) => x.source === id && x.sourceHandle === o.id);
      if (!e) continue;
      lines.push({ depth: depth + 1, text: b(`Wenn „${o.label.de}“:`, `If “${o.label.en}”:`) });
      walk(e.target, depth + 2);
    }
  };
  if (start) walk(start.id, 0);
  return lines;
}

/* ───────────── the demo writer: understands common requests ───────────── */

export interface Interpretation {
  reply: Bilingual;
  ops: EditOp[];
  /** The whole process, when the description started one from scratch. */
  proposal?: Graph;
  /** Things the page does itself: documenting the steps. */
  action?: "document";
  /** Read-out of the process, when it was asked for. */
  summary?: SummaryLine[];
  unmapped: Bilingual[];
}

export const ASSIST_HELP = b(
  "Ich kann Schritte hinzufügen, entfernen und umbenennen, Wartezeiten und Erinnerungen setzen, Entscheidungspunkte einfügen, den Ablauf erklären und nach Fehlern suchen.",
  "I can add, remove and rename steps, set waiting times and reminders, add decision points, explain the process in plain words and look for mistakes.",
);

/** The step a clause talks about: "after X", or a sensible default. */
function anchorOf(g: Graph, clause: string, prefer: (n: FlowNode) => boolean): FlowNode | undefined {
  const m = /\b(?:after|behind|following|below)\s+(?:the\s+)?["“]?(.+?)["”]?(?:\s+step)?$/i.exec(clause.trim());
  if (m) { const hit = findStep(g, m[1]!); if (hit) return hit; }
  return [...g.nodes].reverse().find(prefer);
}

/** What a phrase names as a step to add. */
function specOf(text: string): AddSpec | null {
  const t = text.toLowerCase();
  if (/\b(?:second|extra|additional|another)\b.*\b(?:review|check|look|caseworker|opinion)\b|\bfour[- ]eyes\b/.test(t)) return { kind: "human_task", name: "Second review", config: { instruction: "Take a second look and decide.", instruction_en: "Take a second look and decide." } };
  if (/\b(?:caseworker|case worker|person|someone|officer)\b.*\b(?:decides?|reviews?|checks?|approves?)\b|\bmanual (?:review|decision|check)\b/.test(t)) return { kind: "human_task", name: "Caseworker decides" };
  if (/\bpay(?:ment| out)?\b|\bdisburse/.test(t)) return { kind: "connector", name: "Create the payment order", config: { system: "payment", action: "create_payment_order" } };
  if (/\bai\b.*\b(?:draft|write|e-?mail|message)|\bdraft\b.*\b(?:e-?mail|message|letter)/.test(t)) return { kind: "ai_draft_mail", name: "AI drafts the message" };
  if (/\b(?:ask|request|chase)\b.*\b(?:applicant|student|documents?|missing|information)\b|\brequest documents\b/.test(t)) return { kind: "request_documents", name: "Ask the applicant for the missing documents", config: { sending: "auto" } };
  if (/\b(?:send|notify|tell|inform|e-?mail|message|notification)\b/.test(t)) return { kind: "send_notification", name: /reminder|remind/.test(t) ? "Remind the applicant" : "Send message to the applicant" };
  if (/\bwait\b/.test(t)) { const m = /(\d+)\s*(day|week)/.exec(t); return { kind: "wait", config: { days: m ? Number(m[1]) * (m[2] === "week" ? 7 : 1) : 7 } }; }
  if (/\bread\b.*\b(?:documents?|files?)/.test(t)) return { kind: "read_documents", name: "Read the documents" };
  if (/\b(?:check|run|apply)\b.*\brules?\b/.test(t)) return { kind: "run_rules", name: "Check the rules" };
  if (/\bassign\b.*\bcaseworker\b/.test(t)) return { kind: "assign_caseworker", name: "Assign the responsible caseworker" };
  if (/\b(?:end|finish|close)\b/.test(t)) return { kind: "end", name: "Finished" };
  return null;
}

/** A change request in plain English, turned into operations. Keyword based: it says so when it does not understand. */
export function interpretEdit(message: string, def: Graph): Interpretation {
  const text = message.trim();
  const t = text.toLowerCase();
  const none = (reply: Bilingual, extra: Partial<Interpretation> = {}): Interpretation => ({ reply, ops: [], unmapped: [], ...extra });

  if (/^(?:help|what can you do|what do you do)\b|\bwhat can (?:you|i)\b/.test(t)) return none(ASSIST_HELP);
  if (/\b(?:improve|document|describe)\b.*\b(?:steps?|process)\b|\badd (?:descriptions?|comments?)\b/.test(t)) return none(b("Ich beschreibe jeden Schritt in einfachen Worten. Sie nehmen jeden Vorschlag an oder lehnen ihn ab.", "I'll describe each step in plain words. You accept or reject every suggestion."), { action: "document" });
  if (/\b(?:explain|summari[sz]e|walk me through|what does|how does|describe)\b.*\b(?:process|this|flow)\b|\bwhat happens\b/.test(t)) {
    return none(b("So läuft der Ablauf:", "Here is how the process runs:"), { summary: summarizeProcess(def) });
  }
  if (/\b(?:mistakes?|errors?|problems?|wrong|issues?|validate|broken)\b/.test(t) && /\b(?:check|find|any|is there|look|validate|anything)\b/.test(t)) {
    const issues = validateProcess({ nodes: def.nodes, edges: def.edges });
    return none(issues.length ? b(`Ich habe ${issues.length} Punkt${issues.length === 1 ? "" : "e"} gefunden:\n${issues.map((i) => `• ${i.message.de}`).join("\n")}`, `I found ${issues.length} thing${issues.length === 1 ? "" : "s"} to fix:\n${issues.map((i) => `• ${i.message.en}`).join("\n")}`) : b("Ich habe keine Fehler gefunden.", "I found no mistakes."));
  }

  // An empty process and a description: draft it from scratch.
  if (def.nodes.length <= 1 && text.length >= 25) {
    const g = generateProcess(text);
    if (g.nodes.length > 1) return { reply: b(`Hier ist ein erster Entwurf mit ${g.nodes.length} Schritten.`, `Here is a first draft with ${g.nodes.length} steps.`), ops: [], proposal: { nodes: g.nodes, edges: g.edges }, unmapped: g.unmapped.map((x) => b(x, x)) };
  }

  const ops: EditOp[] = [];
  const unmapped: Bilingual[] = [];
  const clauses = text.split(/\s*(?:[.;!]|,?\s+and\s+(?=(?:add|send|remove|delete|ask|wait|make|rename|change|let|insert|put|also)\b)|\s+then\s+)\s*/i).map((c) => c.trim()).filter(Boolean);
  const g0 = { nodes: def.nodes, edges: def.edges };
  for (const raw of clauses) {
    const c = raw.replace(/^(?:please\s+|also\s+|can you\s+|could you\s+|i want to\s+|i'd like to\s+|let's\s+)/i, "").trim();
    const l = c.toLowerCase();
    let m: RegExpExecArray | null;

    if ((m = /^(?:rename|call)\s+(?:the\s+)?(?:step\s+)?["“]?(.+?)["”]?\s+(?:to|as)\s+["“]?(.+?)["”]?$/i.exec(c))) { ops.push({ op: "rename", step: m[1]!, name: m[2]! }); continue; }
    if ((m = /^(?:remove|delete|drop|take out|get rid of)\s+(?:the\s+)?(?:step\s+)?["“]?(.+?)["”]?(?:\s+step)?$/i.exec(c))) { ops.push({ op: "remove", step: m[1]! }); continue; }
    if ((m = /\b(?:change|set|make)\b.*\b(?:wait|waiting|deadline|reminder)\b.*\b(?:to|=)\s+(\d+)\s*(day|week)/i.exec(c))) {
      const w = g0.nodes.find((n) => n.kind === "wait");
      if (w) { ops.push({ op: "set", step: w.id, key: "days", value: Number(m[1]) * (/week/i.test(m[2]!) ? 7 : 1) }); continue; }
    }

    // "add a reminder after 7 days"
    if (/\bremind|reminder\b/.test(l)) {
      const d = /(\d+)\s*(day|week)/.exec(l);
      const days = d ? Number(d[1]) * (d[2] === "week" ? 7 : 1) : 7;
      const anchor = anchorOf(g0, c.replace(/\bafter\s+\d+\s*(?:days?|weeks?)/i, ""), (n) => n.kind === "request_documents") ?? findStep(g0, "request");
      if (!anchor) { unmapped.push(b("Ich weiß nicht, wo die Erinnerung hin soll. Nennen Sie den Schritt: „… nach Schritt X“.", "I don't know where the reminder goes. Name the step: “… after step X”.")); continue; }
      const waitName = `Wait ${days} day${days === 1 ? "" : "s"}`;
      ops.push({ op: "add", spec: { kind: "wait", name: waitName, config: { days } }, after: anchor.id });
      ops.push({ op: "add", spec: { kind: "send_notification", name: "Remind the applicant" }, after: waitName });
      continue;
    }

    // A decision point with an action: "if funding is over 1200, add a second review"
    const ifm = /^(?:(?:add|insert|put)\s+(?:a\s+)?(?:condition|decision point|check|branch)\s+)?(?:only\s+)?(?:if|when|for)\s+(.+?)(?:,\s*|\s+then\s+)(.+)$/i.exec(c) ?? /^(.+?)\s+(?:if|when)\s+((?:the\s+)?(?:funding|amount|tuition|stay|weeks|country|grant).+)$/i.exec(c);
    if (ifm) {
      const first = ifm[1]!;
      const second = ifm[2]!;
      const firstIsCondition = /\b(?:over|above|more than|under|below|less than|at least|at most|eu|funding|amount|tuition|weeks|country|internship|study)\b/i.test(first);
      const cond = conditionIn(firstIsCondition ? first : second);
      const spec = specOf(firstIsCondition ? second : first);
      if (cond && cond.kind === "value" && spec) {
        const anchor = anchorOf(g0, c, (n) => n.kind === "human_task");
        if (anchor) {
          ops.push({ op: "branch", on: { step: anchor.id, handle: anchor.kind === "human_task" ? "approved" : undefined }, field: String(cond.config.field), cmp: cond.config.op as Comparator, value: String(cond.config.value), label: cond.label, yes: spec });
          continue;
        }
      }
    }

    // A decision point without an action: "add a condition if funding is over 1200"
    if (/\b(?:condition|decision point|branch)\b/.test(l)) {
      const cond = conditionIn(c);
      const anchor = anchorOf(g0, c, (n) => n.kind === "human_task" || n.kind === "read_documents" || n.kind === "trigger");
      if (cond && cond.kind === "value" && anchor) {
        ops.push({ op: "branch", on: { step: anchor.id, handle: anchor.kind === "human_task" ? "approved" : undefined }, field: String(cond.config.field), cmp: cond.config.op as Comparator, value: String(cond.config.value), label: cond.label });
        continue;
      }
      unmapped.push(b("Welche Bedingung? Zum Beispiel „wenn die Förderung über 1200 liegt“.", "Which condition? For example “if the funding is over 1200”."));
      continue;
    }

    // "add X [after/before Y]"
    const add = /^(?:add|insert|put|include|create|then|next|also)\s+(?:a|an|the|another)?\s*(.+)$/i.exec(c);
    if (add) {
      const body = add[1]!;
      const spec = specOf(body);
      if (!spec) { unmapped.push(b(`Ich weiß nicht, welchen Schritt „${body}“ meint.`, `I don't know which step “${body}” is.`)); continue; }
      const before = /\bbefore\s+(?:the\s+)?["“]?(.+?)["”]?(?:\s+step)?$/i.exec(body);
      if (before) {
        const target = findStep(g0, before[1]!);
        const inc = target && g0.edges.find((e) => e.target === target.id);
        if (inc) { ops.push({ op: "add", spec, after: inc.source, handle: inc.sourceHandle }); continue; }
      }
      const anchor = anchorOf(g0, body, (n) => n.kind !== "end" && n.kind !== "trigger") ?? anchorOf(g0, body, () => true);
      if (!anchor) { unmapped.push(b("Ich weiß nicht, wo der Schritt hin soll.", "I don't know where the step goes.")); continue; }
      ops.push({ op: "add", spec, after: anchor.id, handle: anchor.kind === "human_task" && /approved|approval/.test(l) ? "approved" : undefined });
      continue;
    }

    unmapped.push(b(`Das habe ich nicht verstanden: „${c.slice(0, 80)}“.`, `I didn't understand: “${c.slice(0, 80)}”.`));
  }

  if (ops.length === 0) {
    return { reply: b(`${unmapped.length ? "" : "Das habe ich nicht verstanden. "}${ASSIST_HELP.de}`, `${unmapped.length ? "" : "I didn't understand that. "}${ASSIST_HELP.en}`), ops: [], unmapped };
  }
  return { reply: b("Das würde ich ändern:", "Here is what I would change:"), ops, unmapped };
}

/** The chips under the chat box: what to try next, depending on the process. */
export function assistSuggestions(def: Graph): Bilingual[] {
  if (def.nodes.length <= 1) return [b("Wenn ein Antrag eingeht, die Unterlagen lesen. Fehlt etwas, die Person bitten. Sonst entscheidet eine Sachbearbeitung.", "When an application arrives, read the documents. If something is missing, ask the applicant. Otherwise a caseworker decides.")];
  const out: Bilingual[] = [b("Erkläre den Ablauf", "Explain this process"), b("Gibt es Fehler?", "Is anything wrong?")];
  if (def.nodes.some((n) => n.kind === "request_documents")) out.push(b("Erinnerung nach 7 Tagen hinzufügen", "Add a reminder after 7 days"));
  if (def.nodes.some((n) => n.kind === "human_task")) out.push(b("Zweite Prüfung, wenn die Förderung über 1200 liegt", "If funding is over 1200, add a second review"));
  out.push(b("Beschreibe jeden Schritt", "Describe each step"));
  return out;
}

/* ───────────── the live writer: prompt and parser ───────────── */

export function editPrompt(def: Graph): string {
  const kindsList = kinds.filter((k) => k !== "trigger").map((k) => `- ${k}: ${NODE_CATALOG[k].description.en} Outputs: ${NODE_CATALOG[k].outputs.map((o) => o.id).join(", ") || "none"}.`).join("\n");
  const steps = def.nodes.map((n) => `- id=${n.id} kind=${n.kind} name="${stepName(n)}" config=${JSON.stringify(n.config)}`).join("\n");
  const edges = def.edges.map((e) => `- ${e.source} --${e.sourceHandle}--> ${e.target}`).join("\n");
  return [
    "You help a person with no technical background change a process in a process builder (Auslands-BAföG, fictional office). Talk in short, plain, friendly sentences. Never use words like node, handle, JSON or config in your reply.",
    "You can ONLY change the process with the operations below. You cannot change rules, laws or settings outside the process. If a request cannot be done with them, say so in the reply and return no operations.",
    'Operations (JSON): {"op":"add","spec":{"kind":"…","name":"…","config":{}},"after":"step id or name","handle":"optional output"} | {"op":"remove","step":"…"} | {"op":"rename","step":"…","name":"…"} | {"op":"set","step":"…","key":"…","value":…} | {"op":"branch","on":{"step":"…","handle":"optional"},"field":"estimateMonthly|tuitionFees|weeks|blockers|warnings|stayType|country|isEU|source","cmp":"eq|ne|gte|lte|contains","value":"…","label":"short question","yes":{spec},"no":{spec}} | {"op":"connect","from":"…","handle":"…","to":"…"} | {"op":"disconnect","from":"…","handle":"…"}',
    `\nSTEP KINDS YOU MAY ADD\n${kindsList}`,
    `\nTHE PROCESS NOW\nSteps:\n${steps}\nConnections:\n${edges}`,
    'Reply with JSON only: {"reply":"one or two plain sentences","ops":[…]}. Use [] for ops when you only answer a question.',
  ].join("\n");
}

export function parseEdit(text: string): { reply: string; ops: EditOp[] } | null {
  const a = text.indexOf("{");
  const z = text.lastIndexOf("}");
  if (a < 0 || z <= a) return null;
  try {
    const v = JSON.parse(text.slice(a, z + 1)) as { reply?: unknown; ops?: unknown };
    return { reply: typeof v.reply === "string" ? v.reply.slice(0, 1200) : "", ops: sanitizeOps(v.ops) };
  } catch {
    return null;
  }
}
