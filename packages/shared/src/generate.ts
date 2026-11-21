import { CONNECTORS, NODE_CATALOG, TEAMS, defaultConfig, uniqueStepName, validateProcess, type ConfigValue, type FlowEdge, type FlowNode, type NodeKind, type ProcessIssue } from "./process.js";
import { RULES } from "./rules.js";

/**
 * Process from a description. A person writes in plain language how a case should run and which rules apply;
 * a "draft" (steps and connections, in the vocabulary of the builder) comes back, is checked against the same
 * rules as a hand-drawn process, and is shown as a proposal. Nothing is saved or published by this.
 *
 * Two writers produce a draft: the simulated one below (keywords, works offline) and a live model (apps/api).
 * Both are held to the same checks, so a live answer can never put anything on the canvas the builder would refuse.
 */

export interface DraftStep {
  id: string;
  kind: NodeKind;
  name?: string;
  comment?: string;
  config?: Record<string, ConfigValue>;
}
export interface DraftEdge {
  from: string;
  handle?: string;
  to: string;
}
export interface ProcessDraft {
  steps: DraftStep[];
  edges: DraftEdge[];
  /** What the writer understood, one line each, for the person to check. */
  understood: string[];
  /** What it could not turn into steps or rules. Never guessed. */
  unmapped: string[];
}
export interface GeneratedProcess {
  nodes: FlowNode[];
  edges: FlowEdge[];
  understood: string[];
  unmapped: string[];
  /** Problems the builder would also report. The proposal can still be placed on the canvas and fixed there. */
  issues: ProcessIssue[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "step";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Makes a draft safe: only known kinds, settings and connections, defaults filled in, one start, names unique. */
export function draftToProcess(draft: ProcessDraft): GeneratedProcess {
  const unmapped = [...draft.unmapped];
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  const nodes: FlowNode[] = [];
  for (const s of draft.steps ?? []) {
    const spec = NODE_CATALOG[s.kind];
    if (!spec) {
      unmapped.push(`The step type “${String(s.kind)}” does not exist in the builder and was left out.`);
      continue;
    }
    let id = slug(s.id || s.kind);
    for (let i = 2; taken.has(id); i++) id = `${slug(s.id || s.kind)}-${i}`;
    taken.add(id);
    ids.set(s.id, id);
    const config = defaultConfig(s.kind);
    for (const [k, v] of Object.entries(s.config ?? {})) {
      const f = spec.fields.find((x) => x.key === k);
      if (!f) continue;
      if (f.type === "select" && !f.options?.some((o) => o.value === String(v))) {
        unmapped.push(`“${s.name ?? spec.title.en}”: the value “${String(v)}” is not an option for “${f.label.en}”; the standard was used.`);
        continue;
      }
      if (f.type === "number") config[k] = Number.isFinite(Number(v)) ? Number(v) : f.default;
      else if (f.type === "rules") config[k] = String(v).split(",").map((x) => x.trim()).filter((x) => RULES.some((r) => r.id === x)).join(",");
      else config[k] = clip(String(v), 2000);
    }
    nodes.push({ id, kind: s.kind, name: "", position: { x: 0, y: 0 }, config, ...(s.comment ? { comment: clip(s.comment, 600) } : {}) });
  }
  const names: string[] = [];
  nodes.forEach((n, i) => {
    const given = draft.steps.find((s) => ids.get(s.id) === n.id)?.name?.trim();
    n.name = uniqueStepName(clip(given || NODE_CATALOG[n.kind].title.en, 60), names);
    names.push(n.name);
    void i;
  });
  const edges: FlowEdge[] = [];
  const used = new Set<string>();
  for (const e of draft.edges ?? []) {
    const source = ids.get(e.from);
    const target = ids.get(e.to);
    const src = nodes.find((n) => n.id === source);
    const handle = e.handle ?? "out";
    if (!source || !target || !src || source === target || !NODE_CATALOG[src.kind].outputs.some((o) => o.id === handle) || used.has(`${source}:${handle}`)) continue;
    used.add(`${source}:${handle}`);
    edges.push({ id: `${source}:${handle}`, source, sourceHandle: handle, target });
  }
  // Exactly one start: add one in front of the first step that nothing leads to.
  if (!nodes.some((n) => n.kind === "trigger") && nodes.length) {
    const first = nodes.find((n) => !edges.some((e) => e.target === n.id)) ?? nodes[0]!;
    const id = taken.has("start") ? "start-1" : "start";
    nodes.unshift({ id, kind: "trigger", name: uniqueStepName("Application arrives", names), position: { x: 0, y: 0 }, config: defaultConfig("trigger") });
    edges.push({ id: `${id}:out`, source: id, sourceHandle: "out", target: first.id });
  }
  // Rough positions by depth. The builder lays the picture out again; this only keeps the data complete.
  const depth = new Map<string, number>();
  const walk = (id: string, d: number, seen: Set<string>) => {
    if (seen.has(id) || (depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    for (const e of edges.filter((x) => x.source === id)) walk(e.target, d + 1, new Set([...seen, id]));
  };
  nodes.filter((n) => n.kind === "trigger").forEach((n) => walk(n.id, 0, new Set()));
  const perRow = new Map<number, number>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const k = perRow.get(d) ?? 0;
    perRow.set(d, k + 1);
    n.position = { x: 330 + k * 260, y: d * 120 };
  }
  return { nodes, edges, understood: draft.understood ?? [], unmapped, issues: validateProcess({ nodes, edges }) };
}

/* ───────────── the simulated writer ───────────── */

const COUNTRIES: Record<string, string> = { canada: "CA", usa: "US", "united states": "US", america: "US", "united kingdom": "GB", uk: "GB", britain: "GB", australia: "AU", japan: "JP", china: "CN", switzerland: "CH", france: "FR", spain: "ES", netherlands: "NL", italy: "IT", austria: "AT", sweden: "SE", ireland: "IE", "new zealand": "NZ", singapore: "SG", india: "IN", brazil: "BR" };
const TEAM_WORDS: [RegExp, string][] = [[/zweitpr|second (?:review|opinion|check)/i, "Zweitprüfung"], [/inland|domestic/i, "Team Inland"], [/ausland|abroad|foreign|international/i, "Team Ausland"]];
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "for", "must", "be", "is", "are", "has", "have", "with", "that", "all", "in", "on", "at", "by", "as", "from", "present", "needs", "need", "should", "student", "application", "applicant", "it", "this", "their", "his", "her", "any", "its", "check", "checked", "rule", "rules"]);
const RULE_HINTS: [RegExp, string[]][] = [
  [/\bsign(?:ed|ature)?\b.*\b(form|application)\b|\b(form|application)\b.*\bsign/i, ["R-FORM-SIGNED"]],
  [/\benrol|\bimmatrikul/i, ["R-ENROLL"]],
  [/\bhost (?:university|uni)\b.*\bconfirm|\bconfirm\w*\b.*\bhost\b/i, ["R-HOST-CONFIRM"]],
  [/\bparents?\b.*\b(income|tax)\b.*\b(proof|notice|assessment)|\b(income|tax)\b.*\bparents?\b/i, ["R-PARENT-TAX"]],
  [/\bparents?\b.*\bform|formblatt 3/i, ["R-PARENT-FORM"]],
  [/\bhealth\b|\binsurance\b/i, ["R-HEALTH"]],
  [/\binternship\b.*\bcontract|\bcontract\b.*\binternship/i, ["R-INTERN-CONTRACT"]],
  [/\btuition\b.*\b(limit|cap|maximum|5,?600)/i, ["R-TUITION-CAP"]],
  [/\btuition\b/i, ["R-TUITION-WAIVER"]],
  [/\b(readable|legible)\b/i, ["R-READABLE"]],
  [/\bapply early|\bearly enough|\b(four|4) months\b/i, ["R-EARLY"]],
  [/\b(minimum|at least)\b.*\b(six months|semester)|\bstudy stay\b.*\bminimum/i, ["R-MIN-STUDY"]],
  [/\b(twelve|12) weeks\b/i, ["R-MIN-INTERN"]],
];

/** The approved rules a sentence is about: by hints first, then by words shared with a rule's title. */
function matchRules(text: string): string[] {
  const hit = new Set<string>();
  for (const [re, ids] of RULE_HINTS) if (re.test(text)) ids.forEach((i) => hit.add(i));
  if (hit.size) return [...hit];
  const words = new Set(text.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? []);
  for (const r of RULES) {
    const title = (r.title.en.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));
    if (title.length && title.filter((w) => words.has(w)).length >= Math.min(2, title.length)) hit.add(r.id);
  }
  return [...hit];
}

interface Tail {
  id: string;
  handle: string;
}
const PRIMARY: Partial<Record<NodeKind, string>> = { check_inputs: "complete", run_rules: "complete", human_task: "approved", review_fields: "confirmed", condition: "yes" };
const TRIGGER_TEXT = /\b(?:application|case|request|submission)s?\b.*\b(?:arrives?|arrived|comes? in|is submitted|submitted|is received|received|is delivered|starts?)\b/i;
const TERMINAL_MESSAGE = /\b(reject|decline|deny|refuse)\w*/i;

class Builder {
  steps: DraftStep[] = [];
  edges: DraftEdge[] = [];
  tails: Tail[] = [];
  understood: string[] = [];
  unmapped: string[] = [];
  ruleIds: string[] = [];
  private n = 0;

  add(kind: NodeKind, name: string | undefined, config: Record<string, ConfigValue>, from: string): string {
    const id = `${kind.replace(/_/g, "-")}-${++this.n}`;
    this.steps.push({ id, kind, name, config, comment: `From your description: “${clip(from.replace(/\s+/g, " ").trim(), 150)}”` });
    for (const t of this.tails) this.edges.push({ from: t.id, handle: t.handle, to: id });
    const p = kind === "end" ? undefined : (PRIMARY[kind] ?? "out");
    this.tails = p ? [{ id, handle: p }] : [];
    return id;
  }
  last(kind: NodeKind) {
    return [...this.steps].reverse().find((s) => s.kind === kind);
  }
  /** Runs a part of the flow from a given start and hands back where it ended. */
  chain(from: Tail[], run: () => void): Tail[] {
    const keep = this.tails;
    this.tails = from;
    run();
    const out = this.tails;
    this.tails = keep;
    return out;
  }
}

/** The message templates for a decision take the caseworker's explanation, if a caseworker decides earlier in the process. */
function withDecision(b: Builder, template: string): Record<string, ConfigValue> {
  const human = b.last("human_task");
  if (!template || !human) return {};
  return { template, params: `{"explanation":"{${human.id}.decision_note}"}` };
}

type Action = { at: number; run: (b: Builder, text: string) => void; said: string };

/** The actions a piece of text asks for, in the order they are written. */
function actionsIn(text: string, b: Builder): Action[] {
  const found: Action[] = [];
  const on = (re: RegExp, said: string, run: Action["run"]) => {
    const m = re.exec(text);
    if (m) found.push({ at: m.index, run, said });
  };
  const url = /https?:\/\/[^\s,)]+/i.exec(text);
  if (url) found.push({ at: url.index, said: `Call ${url[0]}`, run: (bb, t) => bb.add("http_request", "Call the system", { url: url[0], method: /\bpost\b/i.test(t) ? "POST" : "GET" }, t) });
  on(/\b(?:read|extract|scan|ocr)\b[^.,;]*?\b(?:documents?|uploads?|files?|forms?|certificates?)\b|\bdocuments? (?:are |is )?(?:read|scanned)\b/i, "Read the documents", (bb, t) => bb.add("read_documents", "Read the documents", {}, t));
  on(/\b(?:check|verify|make sure|ensure|validate)\b[^.,;]*\b(?:complete(?:ness)?|required (?:inputs|information|answers|documents)|nothing (?:is )?missing)\b|\bcompleteness\b/i, "Check that everything is there", (bb, t) => bb.add("check_inputs", "Everything required is there?", {}, t));
  const rulesAsked = /\b(?:check|verify|run|apply|validate|test)\b[^.,;]*\b(?:rules?|requirements?|criteria|eligibility)\b/i.exec(text);
  if (rulesAsked) {
    const ids = matchRules(text);
    const have = b.last("run_rules");
    found.push({
      at: rulesAsked.index,
      said: ids.length ? `Check ${ids.length} approved rule${ids.length === 1 ? "" : "s"}` : have ? "Check the rules named above" : "Check all approved rules",
      run: (bb, t) => {
        // Rules named earlier in the text already form the step; asking to "check the rules" does not add a second one.
        if (have && !ids.length) return;
        if (have) have.config = { rules: [...new Set([...String(have.config?.rules ?? "").split(",").filter(Boolean), ...ids])].join(",") };
        else bb.add("run_rules", undefined, { rules: (ids.length ? ids : RULES.map((r) => r.id)).join(",") }, t);
      },
    });
  }
  const assign = /\b(?:assign|route|send|forward|give|hand)\b[^.,;]*\bteam\b|\bteam (?:ausland|inland)\b|\bzweitpr/i.exec(text);
  if (assign && !/\bcaseworker\b.*\b(?:decides?|reviews?)\b/i.test(text)) {
    const team = TEAM_WORDS.find(([re]) => re.test(text))?.[1] ?? TEAMS.find((t) => text.toLowerCase().includes(t.toLowerCase()));
    if (team) found.push({ at: assign.index, said: `Assign to ${team}`, run: (bb, t) => bb.add("assign_team", `Assign to ${team}`, { team }, t) });
    else b.unmapped.push(`I did not know which team: “${clip(text.trim(), 90)}”. Choose one in the step.`);
  }
  on(/\bassign\w*\b[^.,;]*\b(?:caseworker|case worker|handler|clerk)\b|\bresponsible (?:caseworker|person)\b/i, "Assign the responsible caseworker", (bb, t) => bb.add("assign_caseworker", "Assign the responsible caseworker", {}, t));
  const wait = /\b(?:wait|remind\w*|reminder|deadline|follow up)\b[^.,;]*?(\d+)\s*(days?|weeks?)|(\d+)\s*(days?|weeks?)\s*(?:deadline|reminder|to answer)/i.exec(text);
  if (wait) {
    const num = Number(wait[1] ?? wait[3]);
    const days = /week/i.test(wait[2] ?? wait[4] ?? "") ? num * 7 : num;
    found.push({ at: wait.index, said: `Wait ${days} days`, run: (bb, t) => bb.add("wait", `Wait ${days} day${days === 1 ? "" : "s"}`, { days }, t) });
  }
  on(/\b(?:draft|write|compose|formulate)\b[^.,;]*\b(?:mail|e-?mail|message|letter)\b[^.,;]*\b(?:ai|automatic\w*)\b|\bai\b[^.,;]*\b(?:draft|write|compose)\w*/i, "AI drafts a message", (bb, t) => bb.add("ai_draft_mail", "AI drafts the message", {}, t));
  on(/\b(?:ask|request|chase|require|invite)\b[^.,;]*\b(?:student|applicant|them|him|her|documents?|missing|upload\w*|information)\b/i, "Ask the applicant", (bb, t) => bb.add("request_documents", "Ask the applicant for the missing documents", { sending: "auto" }, t));
  const note = /\b(?:send|notify|inform|e-?mail|tell|write to|message)\b[^.,;]*\b(?:student|applicant|parents?|office|him|her|them)\b|\bnotif\w+\b/i.exec(text);
  const askedAlready = found.some((f) => f.said === "Ask the applicant");
  if (note && !askedAlready) {
    const to = /parents?/i.test(text) ? "parents" : /\boffice\b|internal/i.test(text) ? "office" : "student";
    const template = TERMINAL_MESSAGE.test(text) ? "msg-rejected" : /\bapprov\w+|\bgranted\b/i.test(text) ? "msg-approved" : "";
    const label = template === "msg-rejected" ? "Tell the applicant: rejected" : template === "msg-approved" ? "Tell the applicant: approved" : `Send message to ${to === "student" ? "the applicant" : to === "parents" ? "the parents" : "the office"}`;
    found.push({ at: note.index, said: label, run: (bb, t) => bb.add("send_notification", label, { to, ...withDecision(bb, template) }, t) });
  }
  const pay = /\b(?:payment|pay out|payout|pay\b|disburse)/i.exec(text);
  const sys = /\bcase software|fachverfahren|create (?:a )?case\b/i.test(text) ? (["case_software", "create_case"] as const) : /\barchiv\w+|e-?file\b/i.test(text) ? (["efile", "archive_case"] as const) : pay ? (["payment", "create_payment_order"] as const) : null;
  if (sys) {
    const sysName = CONNECTORS.find((c) => c.id === sys[0])!.name.en;
    found.push({ at: pay?.index ?? text.search(/case|archiv|file/i), said: `Call ${sysName}`, run: (bb, t) => bb.add("connector", sys[0] === "payment" ? "Create the payment order" : sysName, { system: sys[0], action: sys[1] }, t) });
  }
  on(/\b(?:manual(?:ly)?|human|caseworker|case worker|officer|clerk|person|someone|staff|team lead)\b[^.,;]*\b(?:decides?|review\w*|approv\w+|checks?|signs? off)\b|\bmanual (?:review|decision|check)\b|\bhuman decision\b/i, "A person decides", (bb, t) => bb.add("human_task", "Caseworker decides", { instruction: "Review the case and decide.", instruction_en: "Review the case and decide." }, t));
  if (TERMINAL_MESSAGE.test(text) && !found.some((f) => f.said.startsWith("Tell the applicant: rejected"))) {
    const at = text.search(TERMINAL_MESSAGE);
    found.push({
      at,
      said: "Reject and tell the applicant",
      run: (bb, t) => {
        bb.add("send_notification", "Tell the applicant: rejected", { to: "student", ...withDecision(bb, "msg-rejected") }, t);
        bb.add("end", "Rejected", {}, t);
      },
    });
  }
  on(/\b(?:end|finish|close|stop)\b[^.,;]*\b(?:process|case|here)\b|\bprocess ends\b/i, "End the process", (bb, t) => bb.add("end", "Finished", {}, t));
  found.sort((a, c) => a.at - c.at);
  // A step that two patterns both caught ("ask the applicant" and "send a message"): keep one per kind of wording.
  return found.filter((f, i) => found.findIndex((g) => g.said === f.said) === i);
}

type Cond =
  | { kind: "value"; config: Record<string, ConfigValue>; label: string; needsRead?: boolean }
  /** A branch from an output of an earlier step: "if incomplete", "if the rules are not met", "if rejected". */
  | { kind: "branch"; of: NodeKind; handle: string; label: string };

/** The condition in an "if …" part. null when it is not something the builder can branch on. */
function conditionIn(text: string): Cond | null {
  const t = text.toLowerCase();
  const num = /(\d[\d.,]*)/.exec(t.replace(/(\d),(\d{3})/g, "$1$2"));
  const value = num ? num[1]!.replace(",", ".") : "";
  const op = /\b(?:over|above|more than|greater than|exceeds?|at least|higher than|>=?)\b|[>]/.test(t) ? "gte" : /\b(?:under|below|less than|fewer than|at most|lower than|up to|<=?)\b|[<]/.test(t) ? "lte" : null;
  const opWord = op === "gte" ? "at least" : "at most";
  const numeric = (field: string, label: string): Cond | null => (op && value ? { kind: "value", config: { field, op, value }, label: `${label} ${opWord} ${value}?` } : null);
  if (/\b(?:not readable|unreadable|illegible|can ?not be read|could not be read|invalid)\b|\b(?:documents?|files?) (?:are|is) not (?:valid|readable)/.test(t)) return { kind: "value", config: { field: "custom", op: "eq", value: "invalid" }, label: "Documents unreadable?", needsRead: true };
  if (/\b(?:readable|valid)\b/.test(t) && /\bdocuments?\b/.test(t)) return { kind: "value", config: { field: "custom", op: "eq", value: "valid" }, label: "Documents readable?", needsRead: true };
  if (/\b(?:rules?|requirements?)\b[^.]*\b(?:fail\w*|not (?:met|fulfilled|passed)|violated|broken)\b|\bopen items?\b|\b(?:blocker|blocking)/.test(t)) return { kind: "branch", of: "run_rules", handle: "incomplete", label: "Rules not met" };
  if (/\b(?:incomplete|missing|not complete|something is missing|not everything)\b/.test(t)) return { kind: "branch", of: "check_inputs", handle: "incomplete", label: "Incomplete" };
  if (/\b(?:reject\w*|declin\w+|denied|deny|denies|refus\w+)\b/.test(t)) return { kind: "branch", of: "human_task", handle: "rejected", label: "Rejected" };
  if (/\b(?:approv\w+|granted|grants?)\b/.test(t)) return { kind: "branch", of: "human_task", handle: "approved", label: "Approved" };
  if (/\b(?:question|more information|needs? information|unclear)\b/.test(t) && /\b(?:caseworker|person|decision)\b/.test(t)) return { kind: "branch", of: "human_task", handle: "info", label: "Question" };
  if (/\b(?:funding|support|amount|grant|bafög|bafoeg|money|payment)\b/.test(t) || /€|eur\b|euros?/.test(t)) {
    if (/tuition/.test(t)) return numeric("tuitionFees", "Tuition fees (€)");
    return numeric("estimateMonthly", "Funding per month (€)");
  }
  if (/\btuition\b/.test(t)) return numeric("tuitionFees", "Tuition fees (€)");
  if (/\b(?:weeks?|duration|length)\b/.test(t)) return numeric("weeks", "Weeks abroad");
  if (/\bmonths?\b/.test(t) && op && value) return { kind: "value", config: { field: "weeks", op, value: String(Math.round(Number(value) * 4.35)) }, label: `Weeks abroad ${opWord} ${Math.round(Number(value) * 4.35)}?` };
  if (/\bwarnings?\b/.test(t)) return numeric("warnings", "Warnings");
  if (/\binternship\b/.test(t)) return { kind: "value", config: { field: "stayType", op: "eq", value: "internship" }, label: "Internship?" };
  if (/\b(?:study|studying)\b/.test(t)) return { kind: "value", config: { field: "stayType", op: "eq", value: "study" }, label: "Study stay?" };
  if (/\boutside (?:of )?the eu\b|\bnot in the eu\b|\bnon-eu\b/.test(t)) return { kind: "value", config: { field: "isEU", op: "eq", value: "false" }, label: "Outside the EU?" };
  if (/\b(?:in|inside|within) the eu\b|\beu countr/.test(t)) return { kind: "value", config: { field: "isEU", op: "eq", value: "true" }, label: "In the EU?" };
  const country = Object.keys(COUNTRIES).find((c) => new RegExp(`\\b${c}\\b`).test(t));
  if (country) return { kind: "value", config: { field: "country", op: /\bnot\b/.test(t) ? "ne" : "eq", value: COUNTRIES[country]! }, label: `${/\bnot\b/.test(t) ? "Not " : ""}${country[0]!.toUpperCase()}${country.slice(1)}?` };
  if (/\bportal\b/.test(t)) return { kind: "value", config: { field: "source", op: "eq", value: "portal" }, label: "Came through the portal?" };
  return null;
}

/**
 * The simulated writer: reads the description sentence by sentence and builds a draft from keywords.
 * It understands a fixed set of phrasings (listed in the docs); anything else is reported, not guessed.
 */
export function simulateDraft(description: string): ProcessDraft {
  const b = new Builder();
  const text = description.replace(/\r/g, "\n").slice(0, 4000);
  const first = /\bportal\b/i.test(text.split(/[.\n]/)[0] ?? "") && /\b(?:arrives?|comes? in|submitted|received|starts?)\b/i.test(text.split(/[.\n]/)[0] ?? "");
  b.add("trigger", "Application arrives", first ? { source: "portal" } : {}, text.split(/[.\n]/)[0] ?? "");
  b.steps[0]!.comment = "Every process starts here.";
  const sentences = text.split(/(?<=[.;!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  let open: { tail: Tail } | null = null;
  const plain = (s: string) => s.replace(/[.;!?]+$/, "");
  const apply = (acts: Action[], from: string, quiet = false) => acts.forEach((a) => { a.run(b, from); if (!quiet) b.understood.push(a.said); });
  /** The pending "no" path of the last condition: closed by an "otherwise" sentence, or left to continue. */
  const closeOpen = () => {
    open = null;
  };

  for (const raw of sentences) {
    let s = plain(raw);
    if (!s) continue;
    // "Reject the application if the stay is outside the EU" reads the same as "If the stay is outside the EU, reject the application".
    const trailing = /^(?!(?:if|when|whenever|unless|in case)\b)(.+?),?\s+(if|unless|when|in case)\s+(.+)$/i.exec(s);
    if (trailing && !/^(?:otherwise|else)/i.test(s)) s = `${trailing[2]} ${trailing[3]}, ${trailing[1]}`;
    const other = /^(?:otherwise|else|if not|if it (?:is|does) not|if (?:they|it) (?:are|is) not)\b[,\s]*/i.exec(s);
    if (other && open) {
      const rest = s.slice(other[0].length);
      const acts = actionsIn(rest, b);
      if (!acts.length) {
        b.unmapped.push(`I did not understand what happens otherwise: “${clip(s, 100)}”.`);
        continue;
      }
      const target: Tail = open.tail;
      const out = b.chain([target], () => apply(acts, s, true));
      b.understood.push(`Otherwise: ${acts.map((a) => a.said).join(", ")}`);
      b.tails = [...b.tails.filter((t) => !(t.id === target.id && t.handle === target.handle)), ...out];
      closeOpen();
      continue;
    }
    closeOpen();
    const cond = /^(?:if|when|whenever|in case|in cases where|as soon as|unless)\b\s*(.+?)(?:,\s*(?:then\s+)?|\s+then\s+)(.+)$/i.exec(s);
    if (cond) {
      const unless = /^unless\b/i.test(s);
      const [, ifPart, thenPartAll] = cond as unknown as [string, string, string];
      if (TRIGGER_TEXT.test(ifPart)) {
        const acts = actionsIn(thenPartAll, b);
        if (/\bportal\b/i.test(ifPart)) b.steps[0]!.config = { source: "portal" };
        if (/\b(?:directly|web form|website)\b/i.test(ifPart)) b.steps[0]!.config = { source: "web" };
        apply(acts, s);
        continue;
      }
      const [thenPart, elsePart] = thenPartAll.split(/,?\s+(?:otherwise|else|if not)\s+|;\s*otherwise\s+/i) as [string, string | undefined];
      const c = conditionIn(ifPart);
      const acts = actionsIn(thenPart, b);
      if (!c || (!acts.length && !(unless && elsePart))) {
        b.unmapped.push(`I could not turn this into a branch: “${clip(s, 120)}”. ${!c ? "The builder branches on funding, tuition, weeks abroad, stay type, country, EU, source, readable documents, missing items or failed rules." : "No action in it that I know."}`);
        continue;
      }
      if (c.kind === "branch") {
        let src = b.last(c.of);
        if (!src) {
          const cfg: Record<string, ConfigValue> = c.of === "run_rules" ? { rules: RULES.map((r) => r.id).join(",") } : c.of === "human_task" ? { instruction: "Review the case and decide.", instruction_en: "Review the case and decide." } : {};
          const keep = b.tails;
          const id = b.add(c.of, c.of === "check_inputs" ? "Everything required is there?" : undefined, cfg, s);
          src = b.steps.find((x) => x.id === id)!;
          void keep;
        }
        const primary = PRIMARY[c.of] ?? "out";
        const side: Tail = { id: src.id, handle: c.handle };
        const rest = b.tails.filter((t) => !(t.id === side.id && t.handle === side.handle));
        const out = b.chain([side], () => {
          apply(acts, s, true);
          const lastStep = b.steps[b.steps.length - 1];
          // A side branch that does not lead on (asking, telling) ends there; the main way carries on.
          if (c.handle !== primary && b.tails.length && lastStep?.kind !== "end") b.add("end", lastStep?.kind === "request_documents" ? "Waiting for the applicant" : "Finished", {}, s);
        });
        b.tails = c.handle === primary ? out : rest;
        const mainTail: Tail = { id: src.id, handle: primary };
        if (c.handle !== primary && !b.tails.some((t) => t.id === mainTail.id && t.handle === mainTail.handle) && !b.edges.some((e) => e.from === mainTail.id && e.handle === mainTail.handle)) b.tails = [...b.tails, mainTail];
        b.understood.push(`${c.label}: ${acts.map((a) => a.said).join(", ")}`);
        continue;
      }
      if (c.needsRead && !b.last("read_documents")) {
        b.add("read_documents", "Read the documents", {}, s);
        b.understood.push("Read the documents (needed for the next branch)");
      }
      const read = b.last("read_documents");
      const config = c.needsRead && read ? { ...c.config, left: `{${read.id}.read_result}` } : c.config;
      const condId = b.add("condition", c.label, config, s);
      b.tails = [];
      const elseActs = elsePart ? actionsIn(elsePart, b) : [];
      const main = unless ? elseActs : acts;
      const side = unless ? acts : elseActs;
      const waits = () => {
        // Asking the applicant for something stops the process there: it starts again when they answer.
        if (b.tails.length && b.steps[b.steps.length - 1]?.kind === "request_documents") b.add("end", "Waiting for the applicant", {}, s);
      };
      const yes = b.chain([{ id: condId, handle: "yes" }], () => { apply(main, s, true); waits(); });
      const noStart: Tail = { id: condId, handle: "no" };
      const no = side.length ? b.chain([noStart], () => { apply(side, s, true); waits(); }) : [noStart];
      b.tails = [...yes, ...no];
      b.understood.push(`If ${c.label.replace(/\?$/, "").toLowerCase()}: ${[...main, ...side].map((a) => a.said).join(", ")}`);
      if (!side.length) open = { tail: noStart };
      continue;
    }

    const requirement = /\b(?:must|should|has to|have to|needs? to|required|mandatory)\b/i.test(s) && !/\b(?:check|verify|run|apply|validate)\b[^.]*\b(?:rules?|requirements?)\b/i.test(s);
    if (requirement) {
      const ids = matchRules(s);
      if (ids.length) {
        b.ruleIds.push(...ids.filter((i) => !b.ruleIds.includes(i)));
        let rs = b.last("run_rules");
        if (!rs) {
          b.add("run_rules", undefined, { rules: "" }, s);
          rs = b.last("run_rules")!;
        }
        rs.config = { rules: [...new Set([...String(rs.config?.rules ?? "").split(",").filter(Boolean), ...b.ruleIds])].join(",") };
        const titles = ids.map((i) => RULES.find((r) => r.id === i)!.title.en);
        b.understood.push(`Rule “${titles.join("”, “")}” (already approved) goes into “Check approved rules”`);
        continue;
      }
      b.unmapped.push(`No approved rule matches “${clip(s, 110)}”. A new rule has to be written, tested and approved under Rules; I did not create one.`);
      continue;
    }
    const acts = actionsIn(s, b);
    if (!acts.length) {
      b.unmapped.push(`I could not map: “${clip(s, 120)}”.`);
      continue;
    }
    apply(acts, s);
  }

  // Close the open ends: whatever still leads nowhere finishes the process.
  if (b.tails.length) b.add("end", "Finished", {}, "End of the description.");
  for (const s of b.steps) {
    if (s.kind === "end") continue;
    for (const o of NODE_CATALOG[s.kind].outputs) {
      if (o.optional || b.edges.some((e) => e.from === s.id && (e.handle ?? "out") === o.id)) continue;
      const id = `end-${o.id}-${s.id}`;
      b.steps.push({ id, kind: "end", name: `Finished (${s.name ?? s.kind}: ${o.label.en})`, comment: "Added so every outcome of the step has a place to go. Connect it to what should happen." });
      b.edges.push({ from: s.id, handle: o.id, to: id });
    }
  }
  return { steps: b.steps, edges: b.edges, understood: b.understood, unmapped: b.unmapped };
}

/** The process a description turns into, with everything the person must check. */
export const generateProcess = (description: string): GeneratedProcess => draftToProcess(simulateDraft(description));

/* ───────────── the live writer: prompt and parser ───────────── */

/** What a model is told: the vocabulary of the builder, the approved rules, and the shape of the answer. */
export function generationPrompt(): string {
  const kinds = (Object.keys(NODE_CATALOG) as NodeKind[])
    .map((k) => {
      const s = NODE_CATALOG[k];
      const outs = s.outputs.map((o) => o.id + (o.optional ? " (optional)" : "")).join(", ") || "none";
      const fields = s.fields
        .filter((f) => !f.hidden)
        .map((f) => `${f.key}${f.options ? `=${f.options.map((o) => o.value).join("|")}` : ""}`)
        .join("; ");
      return `- ${k}: ${s.description.en} Outputs: ${outs}. Settings: ${fields || "none"}.`;
    })
    .join("\n");
  const rules = RULES.map((r) => `- ${r.id}: ${r.title.en}`).join("\n");
  return [
    "You turn a plain-language description of a case process into steps and connections for a process builder (Auslands-BAföG, fictional office).",
    "Use ONLY the step types below. Every step but “end” has outputs; each output may lead to one step. Start with exactly one “trigger”. Every output that is not optional must be connected, usually to an “end” step.",
    "A “condition” compares a value: settings field=custom with left set to a tile like {STEP_ID.read_result}, or field=estimateMonthly|tuitionFees|weeks|blockers|warnings|stayType|country|isEU|source, op=eq|ne|contains|gte|lte, value. Its outputs are yes and no.",
    "Rules: a “run_rules” step lists approved rule ids in its “rules” setting (comma-separated). Use only the ids below. If the description asks for a rule that is not below, do NOT invent one; add a sentence to “unmapped” instead.",
    "Anything you cannot express with these step types goes to “unmapped”, never into a guessed step.",
    `\nSTEP TYPES\n${kinds}`,
    `\nAPPROVED RULES\n${rules}`,
    '\nReply with JSON only: {"steps":[{"id":"short-id","kind":"…","name":"short name","comment":"why this step is there","config":{…}}],"edges":[{"from":"id","handle":"output id","to":"id"}],"understood":["one line per thing you understood"],"unmapped":["one line per thing you could not map"]}',
  ].join("\n");
}

/** Reads a model's answer. null when it is not a usable draft. */
export function parseDraft(text: string): ProcessDraft | null {
  const a = text.indexOf("{");
  const z = text.lastIndexOf("}");
  if (a < 0 || z <= a) return null;
  try {
    const v = JSON.parse(text.slice(a, z + 1)) as Partial<ProcessDraft>;
    if (!Array.isArray(v.steps) || !Array.isArray(v.edges)) return null;
    const str = (x: unknown) => (typeof x === "string" ? x : undefined);
    const steps: DraftStep[] = v.steps
      .filter((s): s is DraftStep => Boolean(s) && typeof s === "object" && typeof (s as DraftStep).id === "string" && typeof (s as DraftStep).kind === "string")
      .slice(0, 60)
      .map((s) => ({ id: s.id, kind: s.kind, name: str(s.name), comment: str(s.comment), config: s.config && typeof s.config === "object" ? Object.fromEntries(Object.entries(s.config).filter(([, x]) => typeof x === "string" || typeof x === "number")) : {} }));
    const edges: DraftEdge[] = v.edges.filter((e): e is DraftEdge => Boolean(e) && typeof (e as DraftEdge).from === "string" && typeof (e as DraftEdge).to === "string").slice(0, 200).map((e) => ({ from: e.from, handle: str(e.handle), to: e.to }));
    const lines = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string").slice(0, 30).map((y) => clip(y, 300)) : []);
    return { steps, edges, understood: lines(v.understood), unmapped: lines(v.unmapped) };
  } catch {
    return null;
  }
}
