import { randomUUID } from "node:crypto";
import {
  NODE_CATALOG,
  STEP_OUTPUTS,
  buildFacts,
  estimate,
  evaluate,
  ruleSelection,
  type Application,
  type Bilingual,
  type Check,
  type CheckReport,
  type DocumentKind,
  type DocumentRef,
  type Extraction,
  type ExtractionMethod,
  type FlowNode,
  type Mail,
  type ProcessDef,
  type RunLogEntry,
} from "@digieurope/shared";

export interface TemplateView {
  id: string;
  name: string;
  version: number;
  subject: Bilingual;
  body: Bilingual;
}

export interface EngineCtx {
  now: Date;
  /** Runs the approved rules and the required inputs of the office, or only one of the two. */
  check: (app: Application, ruleIds?: string[] | null, scope?: "all" | "rules" | "inputs") => CheckReport;
  /** The unclear documents and fields of a case: a brief list and the reasons, in the language of the applicant. */
  review?: (app: Application) => { list: string; details: string };
  /** Who handles the case, by the office's table of family-name letters. */
  assign?: (app: Application) => { id: string; name: string; via: "range" | "substitute" | "fallback"; letter: string; covering?: string } | null;
  /** Reads a stored document again with the configured (or overridden) method. */
  reread?: (doc: DocumentRef, override?: ExtractionMethod) => Promise<{ kind: DocumentKind; extraction: Extraction } | null>;
  /** The approved version of a message template. */
  template?: (id: string) => TemplateView | null;
  /** The office's connection to a system: switched on or off, and in which mode. */
  connection?: (system: string) => { enabled: boolean; mode: "sandbox" | "live"; name: string } | null;
  /** In a test run a timer does not hold the process back. */
  instantWaits?: boolean;
}

export type Outcome = "approved" | "rejected" | "info" | "confirmed";
const MAX_STEPS = 80;

const OUTPUT_TYPE = new Map(Object.values(STEP_OUTPUTS).flat().map((o) => [o.name, o.type]));
const stepName = (node: FlowNode) => node.name?.trim() || NODE_CATALOG[node.kind].title.en;

/** A text of a step in the language of the applicant: "subject" or "subject_en", with the German one as the fallback. */
const textOf = (node: FlowNode, key: string, app: Application): string => {
  const en = node.config[`${key}_en`];
  return app.language === "en" && typeof en === "string" && en.trim() !== "" ? en : String(node.config[key] ?? "");
};

/** A list shown as bullets (the default), as a comma-separated line, as a count, or just its first item. */
function formatValue(value: string, name: string, fmt?: string): string {
  if (!fmt || OUTPUT_TYPE.get(name) !== "list") return value;
  const items = value.split("\n").map((l) => l.replace(/^•\s*/, "").trim()).filter(Boolean);
  if (fmt === "comma") return items.join(", ");
  if (fmt === "count") return String(items.length);
  if (fmt === "first") return items[0] ?? "";
  return value;
}

const basics = (text: string, app: Application) =>
  text
    .replace(/\{name\}/g, `${app.student.firstName} ${app.student.lastName}`)
    .replace(/\{reference\}/g, app.reference)
    .replace(/\{amount\}/g, app.decision ? `${app.decision.monthlyAmount} €` : `${estimate(app).monthly} €`);

/** Fills {name}, {reference}, {amount} and what earlier steps produced, written {stepId.output} with an optional :format. Unknown names stay as they are. */
const fill = (text: string, app: Application, vars: Record<string, string> = {}) =>
  basics(text, app).replace(/\{([A-Za-z0-9_-]+)\.([a-z_]+)(?::([a-z]+))?\}/g, (whole, step: string, name: string, fmt?: string) => {
    const key = `${step}.${name}`;
    return key in vars ? formatValue(vars[key]!, name, fmt) : whole;
  });

/** The text of a message template with its parameters filled in. */
const fillTemplate = (text: string, app: Application, params: Record<string, string>) => basics(text, app).replace(/\{([a-z_]+)\}/g, (whole, key: string) => (key in params ? params[key]! : whole));

const parseParams = (raw: unknown, app: Application, vars: Record<string, string>): Record<string, string> => {
  try {
    const obj = JSON.parse(String(raw || "{}")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fill(String(v ?? ""), app, vars)]));
  } catch {
    return {};
  }
};

/** A text of a step with everything filled in: the applicant's language, the name, the reference and what earlier steps produced. */
export const nodeText = (node: FlowNode, key: string, app: Application, vars: Record<string, string>): string => fill(textOf(node, key, app), app, vars);

/** A message template of a step, filled in: subject and middle part of the message. */
export const templateText = (tpl: TemplateView, node: FlowNode, app: Application, vars: Record<string, string>): { subject: string; middle: string } => {
  const params = parseParams(node.config.params, app, vars);
  return { subject: fillTemplate(tpl.subject[app.language], app, params), middle: fillTemplate(tpl.body[app.language], app, params) };
};

const bullets = (items: string[]) => items.map((x) => `• ${x}`).join("\n");

/** Greeting, the middle part and the sign-off around a message to the student. */
export function frameMail(app: Application, middle: string, tone = "friendly"): string {
  const de = app.language === "de";
  const first = app.student.firstName;
  const formal = tone === "formal";
  const greeting = de ? (formal ? `Sehr geehrte:r ${first} ${app.student.lastName},` : `Hallo ${first},`) : formal ? `Dear ${first} ${app.student.lastName},` : `Hi ${first},`;
  return `${greeting}\n\n${middle}\n\n${de ? "Freundliche Grüße" : "Kind regards"}\nStudierendenwerk Musterstadt`;
}

/** The middle part of a question to the student: what is missing and what to do. `extra` are further open items, for example unclear documents. */
export function questionText(app: Application, report: CheckReport, extra: string[] = []): string {
  const de = app.language === "de";
  const items = [...report.findings.filter((f) => f.severity === "blocker").map((f) => f.fix[app.language]), ...extra].map((x) => `• ${x}`).join("\n");
  const intro = de
    ? `vielen Dank für Ihren Antrag ${app.reference}. Bevor wir ihn bearbeiten können, brauchen wir noch Folgendes:`
    : `thank you for your application ${app.reference}. Before we can process it we still need the following:`;
  const outro = de
    ? "Laden Sie die Unterlagen einfach in Ihrem Antrag hoch. Sobald alles vollständig ist, geht Ihr Antrag direkt in die Prüfung."
    : "Simply upload the documents in your application. As soon as everything is complete, your application goes straight to review.";
  return `${intro}\n\n${items}\n\n${outro}`;
}

/** The "AI" mail draft, simulated: a clear message built from the open items, in the student's language. */
export function draftMail(app: Application, report: CheckReport, tone: string, extra: string[] = []): { subject: string; body: string } {
  const de = app.language === "de";
  const count = report.blockers + extra.length;
  return {
    subject: de ? `Ihr Antrag ${app.reference}: Das fehlt noch (${count})` : `Your application ${app.reference}: what is still missing (${count})`,
    body: frameMail(app, questionText(app, report, extra), tone),
  };
}

function connectorResponse(system: string, action: string, app: Application) {
  const id = `${system.slice(0, 2).toUpperCase()}-${app.reference.slice(-5)}`;
  return { ok: true, externalId: id, mode: "prototype connector: no real system was called", system, action };
}

/** The condition compares one value of the case with the compare-to text. */
function conditionHolds(node: FlowNode, app: Application, report: CheckReport, now: Date, valueText: string): boolean {
  const facts = buildFacts(app, now);
  const values: Record<string, unknown> = {
    blockers: report.blockers, warnings: report.warnings, estimateMonthly: estimate(app, now).monthly, tuitionFees: app.stay.tuitionFees,
    weeks: facts.stay.weeks, stayType: app.stay.type, country: app.stay.country, isEU: String(facts.stay.isEU), source: app.source,
  };
  const field = String(node.config.field);
  const op = String(node.config.op);
  const value = valueText;
  const check: Check =
    op === "ne" ? { not: { eq: [{ ref: "v" }, value] } } : op === "eq" ? { eq: [{ ref: "v" }, value] } : op === "lte" ? { lte: [{ ref: "v" }, value] } : { gte: [{ ref: "v" }, value] };
  return evaluate(check, { v: values[field] });
}



/** What the step hands on, as the log and the data inspector show it. */
type Pending = Record<string, string>;

interface Run {
  app: Application;
  log: RunLogEntry[];
  vars: Record<string, string>;
  waiting?: string;
  waitUntil?: string;
  briefing?: string;
  finished: boolean;
  failed?: { nodeId: string; message: string; at: string };
}

async function execute(def: ProcessDef, start: string, input: Application, ctx: EngineCtx, begin: RunLogEntry[], vars: Record<string, string> = {}): Promise<Application> {
  let app = input;
  const de = () => app.language === "de";
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const log: RunLogEntry[] = [...begin];
  let mailDraft: { subject: string; body: string } | null = null;
  let waiting: string | undefined;
  let waitUntil: string | undefined;
  let briefing: string | undefined;
  let finished = false;
  let failed: Run["failed"];
  let current: string | undefined = start;
  const at = () => ctx.now.toISOString();
  const next = (id: string, handle: string) => def.edges.find((e) => e.source === id && e.sourceHandle === handle)?.target;
  const send = (mail: Omit<Mail, "id" | "at">) => (app = { ...app, outbox: [...(app.outbox ?? []), { ...mail, id: randomUUID(), at: at() }] });

  let steps = 0;
  while (current) {
    if (++steps > MAX_STEPS) {
      failed = { nodeId: current, message: `More than ${MAX_STEPS} steps in one run. Check the process for a loop.`, at: at() };
      log.push({ at: at(), nodeId: current, kind: byId.get(current)?.kind ?? "end", note: `Stopped: ${failed.message}` });
      break;
    }
    const node = byId.get(current);
    if (!node) {
      failed = { nodeId: current, message: "The next step does not exist any more.", at: at() };
      log.push({ at: at(), nodeId: current, kind: "end", note: `Stopped: ${failed.message}` });
      break;
    }
    const pend: Pending = {};
    const entry = (note: string, handle?: string) => log.push({ at: at(), nodeId: node.id, kind: node.kind, handle, note, outputs: pend });
    /** An output of this step. It is kept under the step's id, so two steps of the same kind never get mixed up. */
    const out = (k: string, v: string) => {
      vars[`${node.id}.${k}`] = v;
      pend[k] = v;
    };
    const fail = (message: string) => {
      failed = { nodeId: node.id, message, at: at() };
      entry(`Stopped: ${message}`);
      current = undefined;
    };
    let handle = "out";
    try {
      switch (node.kind) {
        case "trigger": {
          const src = String(node.config.source);
          if (src !== "any" && src !== app.source) {
            entry(`Not for this source (${app.source})`);
            current = undefined;
            finished = true;
            continue;
          }
          entry(`Started (${app.source})`);
          break;
        }
        case "check_inputs": {
          const report = ctx.check(app, null, "inputs");
          handle = report.ready ? "complete" : "incomplete";
          const missing = (report.requirements ?? []).filter((r) => r.applies && r.required && r.state !== "ok").map((r) => r.label[app.language]);
          out("missing_inputs", bullets(missing));
          out("missing_inputs_count", String(missing.length));
          entry(report.ready ? "Every required input is there" : `${missing.length} required input(s) missing`, handle);
          break;
        }
        case "run_rules": {
          const report = ctx.check(app, ruleSelection(node), String(node.config.withInputs ?? "yes") === "yes" ? "all" : "rules");
          handle = report.ready ? "complete" : "incomplete";
          out("open_items", bullets(report.findings.filter((f) => f.severity === "blocker").map((f) => f.fix[app.language])));
          out("warnings", bullets(report.findings.filter((f) => f.severity !== "blocker").map((f) => f.fix[app.language])));
          out("missing_documents", bullets((report.requirements ?? []).filter((r) => r.type === "document" && r.applies && r.required && r.state !== "ok").map((r) => r.label[app.language])));
          out("open_count", String(report.blockers));
          entry(report.ready ? "All approved rules pass" : `${report.blockers} blocking item(s): ${report.findings.filter((f) => f.severity === "blocker").map((f) => f.ruleId).join(", ")}`, handle);
          break;
        }
        case "read_documents": {
          const scope = String(node.config.scope);
          // Older steps may still force one method; new steps leave it to the setting of each document type.
          const override = node.config.method && node.config.method !== "default" ? (node.config.method as ExtractionMethod) : undefined;
          const inScope = (d: DocumentRef) => scope === "all" || (scope === "parents" ? d.kind.startsWith("parent") : !d.kind.startsWith("parent"));
          const docs = [...app.documents];
          const engines = new Set<string>();
          const doubtful: string[] = [];
          let unreadable = 0;
          for (let i = 0; i < docs.length; i++) {
            const d = docs[i]!;
            if (!inScope(d)) continue;
            const again = ctx.reread ? await ctx.reread(d, override) : null;
            const extraction = again?.extraction ?? d.extraction;
            docs[i] = { ...d, kind: again && again.kind !== "unknown" ? again.kind : d.kind, extraction };
            engines.add(extraction.engine ?? "builtin");
            if (!extraction.readable) unreadable += 1;
            else if (extraction.needsReview) doubtful.push(docs[i]!.kind);
          }
          app = { ...app, documents: docs };
          out("documents_read", bullets(docs.filter((d) => inScope(d) && d.extraction.readable).map((d) => `${d.filename} (${d.extraction.engine ?? "builtin"})`)));
          out("unreadable_documents", bullets(docs.filter((d) => inScope(d) && !d.extraction.readable).map((d) => d.filename)));
          handle = doubtful.length || unreadable ? "review" : "clear";
          entry(`${docs.filter(inScope).length} document(s) read with ${[...engines].join(", ") || "no reader"}${doubtful.length ? `; low confidence: ${doubtful.join(", ")}` : ""}${unreadable ? `; ${unreadable} unreadable` : ""}`, handle);
          break;
        }
        case "review_fields": {
          const r = ctx.review?.(app);
          out("review_list", r?.list ?? "");
          out("review_details", r?.details ?? "");
          waiting = node.id;
          briefing = fill(textOf(node, "instruction", app), app, vars).trim() || undefined;
          entry(`Waiting for a person to check the fields${briefing ? `: ${briefing}` : ""}`);
          current = undefined;
          continue;
        }
        case "condition": {
          const report = ctx.check(app);
          const yes = conditionHolds(node, app, report, ctx.now, fill(String(node.config.value ?? ""), app, vars));
          handle = yes ? "yes" : "no";
          out("condition_result", handle);
          entry(`${node.config.field} ${node.config.op} ${fill(String(node.config.value ?? ""), app, vars)}: ${handle}`, handle);
          break;
        }
        case "assign_caseworker": {
          const who = ctx.assign?.(app);
          if (!who) {
            entry("No caseworker table is set up");
            break;
          }
          out("caseworker", who.name);
          app = {
            ...app,
            assignedTo: { id: who.id, name: who.name, via: who.via, at: at() },
            history: [...app.history, { at: at(), kind: "assigned", text: `${who.name}` }],
          };
          entry(`Assigned to ${who.name} (${who.via === "range" ? `family name under ${who.letter}` : who.via === "substitute" ? `covering for an absent colleague, family name under ${who.letter}` : who.letter ? `no one available for ${who.letter}` : "no letter in the family name"})`);
          break;
        }
        case "assign_team":
          app = { ...app, assignedTeam: String(node.config.team) };
          out("team", String(node.config.team));
          entry(`Assigned to ${node.config.team}`);
          break;
        case "wait": {
          const days = Number(node.config.days || 0);
          const until = new Date(ctx.now.getTime() + days * 86_400_000);
          out("reminder_date", until.toISOString().slice(0, 10));
          if (ctx.instantWaits || days <= 0) {
            entry(`Waits ${days} day(s) (not held in a test run)`);
            break;
          }
          waiting = node.id;
          waitUntil = until.toISOString();
          entry(`Waiting until ${until.toISOString().slice(0, 10)}`);
          current = undefined;
          continue;
        }
        case "ai_draft_mail": {
          const report = ctx.check(app);
          mailDraft = draftMail(app, report, String(node.config.tone));
          out("draft_subject", mailDraft.subject);
          out("draft_body", mailDraft.body);
          entry("Mail drafted by AI (simulated)");
          break;
        }
        case "request_documents": {
          const tplId = String(node.config.template ?? "");
          const tpl = tplId ? ctx.template?.(tplId) ?? null : null;
          if (tplId && !tpl) {
            fail(`The message template “${tplId}” does not exist or has no approved version.`);
            continue;
          }
          const defaultSubject = de() ? `Ihr Antrag ${app.reference}` : `Your application ${app.reference}`;
          if (String(node.config.sending ?? "auto") === "caseworker" && app.officeMessage?.trim()) {
            const subject = tpl ? templateText(tpl, node, app, vars).subject : de() ? `Rückfrage zu Ihrem Antrag ${app.reference}` : `Question about your application ${app.reference}`;
            const text = frameMail(app, app.officeMessage.trim());
            send({ to: "student", subject, body: text, aiDraft: false, nodeId: node.id });
            out("request_subject", subject);
            out("request_text", text);
            entry(`Question sent, written by the caseworker${tpl ? ` (template “${tpl.name}” v${tpl.version})` : ""}`);
            break;
          }
          let subject: string;
          let body: string;
          let middle: string;
          let aiDraft = false;
          if (tpl) {
            const t = templateText(tpl, node, app, vars);
            subject = t.subject;
            middle = t.middle;
            body = frameMail(app, middle);
          } else if (mailDraft && String(node.config.use_draft ?? "yes") === "yes") {
            subject = mailDraft.subject;
            body = mailDraft.body;
            middle = body.split("\n\n").slice(1, -1).join("\n\n") || body;
            aiDraft = true;
          } else {
            subject = fill(textOf(node, "subject", app), app, vars).trim() || defaultSubject;
            body = fill(textOf(node, "fallback", app), app, vars);
            middle = body.split("\n\n").slice(1, -1).join("\n\n") || body;
            // The text is the AI draft when it was put in as the draft's tile.
            aiDraft = Boolean(mailDraft && body.trim() === mailDraft.body.trim());
          }
          send({ to: "student", subject, body, aiDraft, nodeId: node.id });
          out("request_subject", subject);
          out("request_text", body);
          app = { ...app, status: "info_requested", officeMessage: middle, history: [...app.history, { at: at(), kind: "info_requested", text: "Automatisch durch den Ablauf" }] };
          entry(`Documents requested, message sent${tpl ? ` (template “${tpl.name}” v${tpl.version})` : aiDraft ? " (AI draft)" : ""}`);
          break;
        }
        case "send_notification": {
          const tplId = String(node.config.template ?? "");
          const tpl = tplId ? ctx.template?.(tplId) ?? null : null;
          if (tplId && !tpl) {
            fail(`The message template “${tplId}” does not exist or has no approved version.`);
            continue;
          }
          let subject: string;
          let body: string;
          if (tpl) {
            const t = templateText(tpl, node, app, vars);
            subject = t.subject;
            body = frameMail(app, t.middle);
          } else {
            subject = fill(textOf(node, "subject", app), app, vars);
            body = fill(textOf(node, "body", app), app, vars);
          }
          send({ to: node.config.to as Mail["to"], subject, body, aiDraft: false, nodeId: node.id });
          out("message_subject", subject);
          out("message_body", body);
          entry(`Message to ${node.config.to}${tpl ? ` (template “${tpl.name}” v${tpl.version})` : ""}`);
          break;
        }
        case "connector": {
          const system = String(node.config.system);
          const action = String(node.config.action);
          const conn = ctx.connection?.(system) ?? null;
          const retries = Math.max(0, Math.min(5, Number(node.config.retries || 0)));
          const simulate = String(node.config.simulate ?? "none");
          let error: string | null = null;
          let attempt = 0;
          for (; attempt <= retries; attempt++) {
            error = null;
            if (conn && !conn.enabled) error = `The office's connection to ${conn.name} is switched off.`;
            else if (simulate === "always" || (simulate === "once" && attempt === 0)) error = `The system did not answer (simulated failure).`;
            if (!error) break;
            if (attempt < retries) log.push({ at: at(), nodeId: node.id, kind: node.kind, note: `Attempt ${attempt + 1} failed: ${error}. Trying again.`, outputs: {} });
          }
          if (error) {
            out("connector_error", error);
            const errorTarget = next(node.id, "error");
            if (!errorTarget) {
              fail(`${error} The “error” output of this step is not connected.`);
              continue;
            }
            entry(`${system}.${action} failed after ${retries + 1} attempt(s): ${error}`, "error");
            current = errorTarget;
            continue;
          }
          const response = connectorResponse(system, action, app);
          out("connector_id", response.externalId);
          out("connector_system", system);
          out("connector_action", action);
          app = { ...app, integrations: [...(app.integrations ?? []), { at: at(), nodeId: node.id, system, action, request: { reference: app.reference, amount: app.decision?.monthlyAmount, payload: fill(String(node.config.payload ?? ""), app, vars), connection: conn ? `${conn.name} (${conn.mode})` : undefined }, response }] };
          entry(`${system}.${action} → ${response.externalId}${attempt > 0 ? ` (after ${attempt} retry)` : ""}`);
          break;
        }
        case "human_task":
          waiting = node.id;
          briefing = fill(textOf(node, "instruction", app), app, vars).trim() || undefined;
          entry(`Waiting for the caseworker${briefing ? `: ${briefing}` : ""}`);
          current = undefined;
          continue;
        case "end":
          entry("Finished");
          finished = true;
          current = undefined;
          continue;
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : "Something went wrong in this step.");
      continue;
    }
    if (current === undefined) continue;
    const target = next(node.id, handle);
    if (!target) {
      fail(`The output “${handle}” of “${stepName(node)}” is not connected to anything.`);
      continue;
    }
    current = target;
  }
  for (const e of log) if (e.outputs && Object.keys(e.outputs).length === 0) delete e.outputs;
  const flow = {
    processId: def.id, version: def.version, startedAt: app.flow?.startedAt ?? at(), log, waiting, finished, vars, briefing,
    ...(failed ? { failed: true, error: failed } : {}),
    ...(waitUntil ? { waitUntil } : {}),
  };
  return { ...app, flow, updatedAt: at() };
}

/** Starts the live process for a submitted application. */
export async function startRun(def: ProcessDef, app: Application, ctx: EngineCtx): Promise<Application> {
  const trigger = def.nodes.find((n) => n.kind === "trigger");
  if (!trigger) return app;
  const previous = app.flow?.log ?? [];
  const marker: RunLogEntry[] = previous.length ? [...previous, { at: ctx.now.toISOString(), nodeId: trigger.id, kind: "trigger", note: "— new run —" }] : [];
  return execute(def, trigger.id, app, ctx, marker, {});
}

const stopped = (app: Application, log: RunLogEntry[], nodeId: string, kind: string, message: string, at: string): Application => ({
  ...app,
  flow: { ...app.flow!, log: [...log, { at, nodeId, kind, note: `Stopped: ${message}` }], waiting: undefined, waitUntil: undefined, finished: false, failed: true, error: { nodeId, message, at } },
});

/** Continues after a caseworker acted on a waiting step. */
export async function resumeRun(def: ProcessDef, app: Application, outcome: Outcome, ctx: EngineCtx): Promise<Application> {
  const waiting = app.flow?.waiting;
  if (!waiting) return app;
  const waitingNode = def.nodes.find((n) => n.id === waiting);
  // Only outcomes the waiting step offers can continue it (a caseworker deciding while fields still need review does not).
  if (waitingNode && !NODE_CATALOG[waitingNode.kind].outputs.some((o) => o.id === outcome)) return app;
  const edge = def.edges.find((e) => e.source === waiting && e.sourceHandle === outcome);
  const log: RunLogEntry[] = [...(app.flow?.log ?? []), { at: ctx.now.toISOString(), nodeId: waiting, kind: "human_task", handle: outcome, note: `Caseworker: ${outcome}` }];
  if (!edge) return stopped(app, log, waiting, waitingNode?.kind ?? "human_task", `The output “${outcome}” of “${waitingNode ? stepName(waitingNode) : waiting}” is not connected to anything.`, ctx.now.toISOString());
  const vars: Record<string, string> = { ...(app.flow?.vars ?? {}) };
  if (waitingNode?.kind === "human_task") {
    vars[`${waitingNode.id}.decision`] = outcome;
    vars[`${waitingNode.id}.decision_note`] = app.decision?.note ?? app.officeMessage ?? "";
    vars[`${waitingNode.id}.decision_amount`] = app.decision ? `${app.decision.monthlyAmount} €` : "";
  }
  const decided: RunLogEntry = log[log.length - 1]!;
  if (waitingNode?.kind === "human_task") decided.outputs = { decision: outcome, decision_note: vars[`${waitingNode.id}.decision_note`]!, decision_amount: vars[`${waitingNode.id}.decision_amount`]! };
  return execute(def, edge.target, { ...app, flow: { ...app.flow!, waiting: undefined, waitUntil: undefined } }, ctx, log, vars);
}

/** True when a timer step holds the case and its time has come. */
export const timerDue = (app: Application, now: Date): boolean => Boolean(app.flow?.waiting && app.flow.waitUntil && new Date(app.flow.waitUntil).getTime() <= now.getTime());

/** Lets the process carry on after its timer ran out. */
export async function resumeTimer(def: ProcessDef, app: Application, ctx: EngineCtx): Promise<Application> {
  const waiting = app.flow?.waiting;
  const node = def.nodes.find((n) => n.id === waiting);
  if (!waiting || node?.kind !== "wait" || !timerDue(app, ctx.now)) return app;
  const log: RunLogEntry[] = [...(app.flow?.log ?? []), { at: ctx.now.toISOString(), nodeId: waiting, kind: "wait", handle: "out", note: "The time is up; the process carries on" }];
  const target = def.edges.find((e) => e.source === waiting && e.sourceHandle === "out")?.target;
  if (!target) return stopped(app, log, waiting, "wait", `The output of “${stepName(node)}” is not connected to anything.`, ctx.now.toISOString());
  return execute(def, target, { ...app, flow: { ...app.flow!, waiting: undefined, waitUntil: undefined } }, ctx, log, { ...(app.flow?.vars ?? {}) });
}

/** Tries again at the step where the process stopped with an error, with everything the earlier steps produced. */
export async function retryRun(def: ProcessDef, app: Application, ctx: EngineCtx): Promise<Application> {
  const node = def.nodes.find((n) => n.id === app.flow?.error?.nodeId);
  if (!app.flow?.failed || !node) return app;
  const log: RunLogEntry[] = [...app.flow.log, { at: ctx.now.toISOString(), nodeId: node.id, kind: node.kind, note: "Trying again" }];
  const { failed: _failed, error: _error, ...rest } = app.flow;
  void _failed;
  void _error;
  return execute(def, node.id, { ...app, flow: { ...rest, waiting: undefined, waitUntil: undefined, finished: false } }, ctx, log, { ...(app.flow.vars ?? {}) });
}
