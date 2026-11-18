import { CONDITION_FIELDS, CONNECTORS, NODE_CATALOG, TOKEN_KEYS, outputsOfNode, tokensIn, type FlowNode, type NodeSuggestion, type ProcessDef } from "./process.js";
import { parsePicks } from "./json.js";

/**
 * AI documentation (simulated in the prototype): reads the steps with the names and comments people gave them,
 * works out the flow and what each step is for, and proposes a name and a comment per step.
 * Nothing changes until a person decides for each step: use the AI version, merge, or reject.
 */

const GENERIC_NAME = (n: FlowNode) => {
  const t = NODE_CATALOG[n.kind].title;
  const name = (n.name ?? "").trim().toLowerCase();
  return !name || [t.en, t.de].some((x) => name === x.toLowerCase() || new RegExp(`^${x.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d+$`).test(name));
};

/** True when a person gave the step a name of their own. */
export const isRenamed = (n: FlowNode): boolean => !GENERIC_NAME(n);

/** Merging only makes sense when the step has a name of its own and a comment. */
export const canMerge = (n: FlowNode): boolean => isRenamed(n) && Boolean(n.comment?.trim());

const label = (n: FlowNode | undefined) => (n ? n.name?.trim() || NODE_CATALOG[n.kind].title.en : "the next step");
const q = (n: FlowNode | undefined) => `“${label(n)}”`;
const short = (s: string) => s.replace(/\s*\(.*\)\s*$/, "").trim();
const OP: Record<string, string> = { eq: "is", ne: "is not", contains: "contains", gte: "is at least", lte: "is at most" };

/** The step an output tile in a text points to, with the output's label: “{read.read_result}” → “Read documents · Result of reading”. */
function describeTile(def: ProcessDef, text: string): string {
  const tk = tokensIn(text)[0];
  if (!tk?.step) return text.trim() || "a value";
  const src = def.nodes.find((x) => x.id === tk.step);
  const out = src ? outputsOfNode(src).find((o) => o.name === tk.name) : undefined;
  return out ? `${short(out.label.en)} of ${q(src)}` : text.trim();
}

function nameFor(def: ProcessDef, n: FlowNode): string {
  const c = n.config;
  switch (n.kind) {
    case "condition": {
      if (String(c.field ?? "custom") === "custom") {
        const tk = tokensIn(String(c.left ?? ""))[0];
        const src = tk?.step ? def.nodes.find((x) => x.id === tk.step) : undefined;
        const out = src ? outputsOfNode(src).find((o) => o.name === tk!.name) : undefined;
        return `${out ? short(out.label.en) : "Value"} ${OP[String(c.op)] ?? "is"} ${String(c.value ?? "").trim() || "…"}?`;
      }
      const f = CONDITION_FIELDS.find((x) => x.key === c.field);
      return `${f ? short(f.label.en) : String(c.field)} ${OP[String(c.op)] ?? ""} ${String(c.value ?? "")}?`.replace(/\s+/g, " ");
    }
    case "run_rules": {
      const k = String(c.rules ?? "").split(",").filter(Boolean).length;
      return k ? `Check ${k} approved rule${k === 1 ? "" : "s"}` : "Check approved rules";
    }
    case "assign_team": return `Assign to ${String(c.team ?? "a team")}`;
    case "wait": return `Wait ${Number(c.days ?? 0)} day${Number(c.days) === 1 ? "" : "s"}`;
    case "send_notification": return `Send message to ${({ student: "the applicant", parents: "the parents", office: "the office" } as Record<string, string>)[String(c.to)] ?? "someone"}`;
    case "request_documents": return String(c.sending) === "caseworker" ? "Caseworker asks the applicant" : "Ask the applicant for documents";
    case "connector": {
      const sys = CONNECTORS.find((s) => s.id === c.system);
      const act = sys?.actions.find((a) => a.id === c.action);
      return sys && act ? `${sys.name.en}: ${act.label.en}` : NODE_CATALOG.connector.title.en;
    }
    case "http_request": {
      const raw = String(c.url ?? "").trim();
      let where = raw;
      try {
        const u = new URL(raw);
        where = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
      } catch {
        where = raw.replace(/^\{.*?\}/, "").split("/").filter(Boolean).pop() ?? "";
      }
      return `${String(c.method ?? "GET")} ${where || "API call"}`.trim();
    }
    case "read_documents": return "Read the applicant's documents";
    case "review_fields": return "Person reviews unclear fields";
    case "human_task": return "Caseworker decides";
    case "ai_draft_mail": return "AI drafts the e-mail";
    case "assign_caseworker": return "Assign caseworker by surname";
    case "check_inputs": return "Check required inputs";
    case "trigger": return "Application arrives";
    case "end": {
      const into = def.edges.find((e) => e.target === n.id);
      const from = into ? def.nodes.find((x) => x.id === into.source) : undefined;
      const handle = into ? NODE_CATALOG[from?.kind ?? "end"].outputs.find((o) => o.id === into.sourceHandle)?.label.en : undefined;
      return into && handle && into.sourceHandle !== "out" ? `End: ${handle}` : "End";
    }
  }
}

/** What a step takes from earlier steps and what later steps take from it. */
function dataFlow(def: ProcessDef, n: FlowNode): { uses: string[]; usedBy: string[] } {
  const uses = new Set<string>();
  for (const k of TOKEN_KEYS) for (const tk of tokensIn(String(n.config[k] ?? ""))) if (tk.step && tk.step !== n.id) uses.add(describeTile(def, tk.raw));
  const usedBy = new Set<string>();
  for (const m of def.nodes) {
    if (m.id === n.id) continue;
    for (const k of TOKEN_KEYS) for (const tk of tokensIn(String(m.config[k] ?? ""))) if (tk.step === n.id) usedBy.add(`${short(outputsOfNode(n).find((o) => o.name === tk.name)?.label.en ?? tk.name)} → ${q(m)}`);
  }
  return { uses: [...uses], usedBy: [...usedBy] };
}

function commentFor(def: ProcessDef, n: FlowNode): string {
  const c = n.config;
  const lines: string[] = [];
  const targets = (handle: string) => def.nodes.find((x) => x.id === def.edges.find((e) => e.source === n.id && e.sourceHandle === handle)?.target);
  const outs = NODE_CATALOG[n.kind].outputs;
  switch (n.kind) {
    case "trigger": lines.push("Starts the process when an application arrives."); break;
    case "read_documents": lines.push("Reads every uploaded document into fields. The result is “valid” when all fields were read with enough confidence, otherwise “invalid”."); break;
    case "condition": {
      const left = String(c.field ?? "custom") === "custom" ? describeTile(def, String(c.left ?? "")) : (CONDITION_FIELDS.find((x) => x.key === c.field)?.label.en ?? String(c.field));
      lines.push(`Checks whether ${left} ${OP[String(c.op)] ?? "is"} ${String(c.value ?? "").trim() || "…"}.`);
      break;
    }
    case "run_rules": lines.push("Applies the ticked, approved rules to the application. A fixed check, no AI."); break;
    case "check_inputs": lines.push("Checks that every form and answer the process asks for is there."); break;
    case "review_fields": lines.push("A person compares the unclear fields with the document and corrects them. The process waits."); break;
    case "human_task": lines.push("The caseworker decides: approve, reject or ask a question. A human always decides."); break;
    case "assign_caseworker": lines.push("Gives the case to the responsible caseworker by the first letter of the family name."); break;
    case "assign_team": lines.push(`Gives the case to ${String(c.team)}.`); break;
    case "wait": lines.push(`Holds the case for ${Number(c.days ?? 0)} day(s). A new upload before that starts the process again.`); break;
    case "ai_draft_mail": lines.push("The AI writes a clear message to the applicant from the open items. A person can still change it."); break;
    case "request_documents": lines.push(`Sets the case to “question” and sends the message${c.template ? ` from the template “${String(c.template)}”` : ""}${String(c.sending) === "caseworker" ? ", after the caseworker has checked it" : ""}.`); break;
    case "send_notification": lines.push(`Sends a message${c.template ? ` from the template “${String(c.template)}”` : ""}.`); break;
    case "connector": lines.push(`Calls ${CONNECTORS.find((s) => s.id === c.system)?.name.en ?? String(c.system)} (${String(c.action)}).`); break;
    case "http_request": {
      const picks = parsePicks(c.picks);
      lines.push(`Calls a web API (${String(c.method ?? "GET")} ${String(c.url ?? "").trim() || "no address yet"})${picks.length ? ` and picks ${picks.map((p) => p.name).join(", ")} from the answer` : ""}.`);
      break;
    }
    case "end": lines.push("The process ends here."); break;
  }
  if (outs.length > 1) {
    const parts = outs.filter((o) => targets(o.id)).map((o) => `“${o.label.en}” goes to ${q(targets(o.id))}`);
    if (parts.length) lines.push(`${parts.join("; ")}.`);
  } else if (n.kind !== "end") {
    const t = targets("out");
    if (t) lines.push(`Then ${q(t)}.`);
  }
  const flow = dataFlow(def, n);
  if (flow.uses.length && n.kind !== "condition") lines.push(`Uses ${flow.uses.join(", ")}.`);
  if (flow.usedBy.length) lines.push(`Hands on ${flow.usedBy.join(", ")}.`);
  return lines.join(" ");
}

/** The proposals for every step. A step whose name and comment already match what the AI understood gets none. */
export function documentProcess(def: ProcessDef, now = new Date().toISOString()): Record<string, NodeSuggestion> {
  const out: Record<string, NodeSuggestion> = {};
  const taken = new Set(def.nodes.map((n) => (n.name ?? "").trim().toLowerCase()));
  for (const n of def.nodes) {
    const s: NodeSuggestion = { at: now };
    if (!isRenamed(n)) {
      const name = nameFor(def, n);
      if (name.toLowerCase() !== (n.name ?? "").trim().toLowerCase() && !taken.has(name.toLowerCase())) {
        s.name = name;
        taken.add(name.toLowerCase());
      }
    }
    const comment = commentFor(def, n);
    if (comment && comment !== (n.comment ?? "").trim()) s.comment = comment;
    if (s.name || s.comment) out[n.id] = s;
  }
  return out;
}

const words = (t: string) => new Set(t.toLowerCase().match(/[a-zäöüß0-9]{5,}/g) ?? []);

/** The comment of a person plus what the AI adds that the person did not already say. */
export function mergeComments(mine: string, ai: string): string {
  const have = words(mine);
  const extra = ai.split(/(?<=\.)\s+/).filter((sentence) => {
    const w = [...words(sentence)];
    return w.length === 0 || w.filter((x) => have.has(x)).length / w.length < 0.6;
  });
  return [mine.trim(), ...extra].filter(Boolean).join(" ");
}

export type SuggestionChoice = "use" | "merge" | "reject";

/** Applies the decision of a person to one step. The proposal is gone afterwards in every case. */
export function decideSuggestion(node: FlowNode, choice: SuggestionChoice): FlowNode {
  const { suggestion, ...rest } = node;
  if (!suggestion || choice === "reject") return rest;
  if (choice === "use") return { ...rest, ...(suggestion.name ? { name: suggestion.name } : {}), ...(suggestion.comment ? { comment: suggestion.comment } : {}) };
  if (!canMerge(node)) return node;
  return { ...rest, ...(suggestion.comment ? { comment: mergeComments(node.comment ?? "", suggestion.comment) } : {}) };
}

// ---- Renaming: what else has to change -----------------------------------------------------

export interface Mention {
  nodeId: string;
  /** "name", "purpose", "comment" or the key of a text in the settings. */
  field: string;
  before: string;
  after: string;
}

export interface RenameImpact {
  /** Texts with a tile of this step. They refer to the step itself, so the tile shows the new name by itself. */
  tiles: { nodeId: string; key: string }[];
  /** Places where the old name is written out as plain text. */
  mentions: Mention[];
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where a step is used downstream, and where its old name is written out in other steps. */
export function renameImpact(def: ProcessDef, nodeId: string, oldName: string, newName: string): RenameImpact {
  const tiles: RenameImpact["tiles"] = [];
  const mentions: Mention[] = [];
  const old = oldName.trim();
  const re = old.length >= 3 ? new RegExp(escapeRe(old), "gi") : null;
  for (const m of def.nodes) {
    if (m.id === nodeId) continue;
    for (const k of TOKEN_KEYS) if (tokensIn(String(m.config[k] ?? "")).some((t) => t.step === nodeId)) tiles.push({ nodeId: m.id, key: k });
    if (!re) continue;
    const fields: [string, string | undefined][] = [["name", m.name], ["purpose", m.purpose], ["comment", m.comment], ["suggestion.comment", m.suggestion?.comment], ...Object.entries(m.config).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)] as [string, string])];
    for (const [field, text] of fields) {
      if (!text || field === "params" || field === "picks" || field === "sample") continue;
      // Not inside a tile: tiles refer by id and are never text.
      const plain = text.replace(/\{[^{}]*\}/g, (x) => " ".repeat(x.length));
      if (!new RegExp(escapeRe(old), "i").test(plain)) continue;
      mentions.push({ nodeId: m.id, field, before: text, after: text.replace(re, newName.trim()) });
    }
  }
  return { tiles, mentions };
}

/** Puts the accepted replacements into the process. */
export function applyMentions(def: ProcessDef, mentions: Mention[]): ProcessDef {
  return {
    ...def,
    nodes: def.nodes.map((n) => {
      const mine = mentions.filter((x) => x.nodeId === n.id);
      if (mine.length === 0) return n;
      let next = n;
      for (const m of mine) {
        if (m.field === "name" || m.field === "purpose" || m.field === "comment") next = { ...next, [m.field]: m.after };
        else if (m.field === "suggestion.comment") next = { ...next, suggestion: next.suggestion ? { ...next.suggestion, comment: m.after } : next.suggestion };
        else next = { ...next, config: { ...next.config, [m.field]: m.after } };
      }
      return next;
    }),
  };
}

/** A picked field got a new name: the tiles downstream that used the old name now use the new one. */
export function renameOutputTokens(def: ProcessDef, stepId: string, oldName: string, newName: string): { def: ProcessDef; changed: { nodeId: string; key: string }[] } {
  const changed: { nodeId: string; key: string }[] = [];
  const re = new RegExp(`\\{${escapeRe(stepId)}\\.${escapeRe(oldName)}(:[a-z]+)?\\}`, "g");
  const nodes = def.nodes.map((n) => {
    let config = n.config;
    for (const k of TOKEN_KEYS) {
      const v = config[k];
      if (typeof v !== "string" || !v.includes(`${stepId}.${oldName}`)) continue;
      const next = v.replace(re, (_w, f: string | undefined) => `{${stepId}.${newName}${f ?? ""}}`);
      if (next !== v) {
        config = { ...config, [k]: next };
        changed.push({ nodeId: n.id, key: k });
      }
    }
    return config === n.config ? n : { ...n, config };
  });
  return { def: changed.length ? { ...def, nodes } : def, changed };
}
