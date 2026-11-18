import { randomUUID } from "node:crypto";
import {
  NODE_CATALOG,
  buildFacts,
  estimate,
  evaluate,
  ruleSelection,
  type Application,
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

export interface EngineCtx {
  now: Date;
  /** Runs the approved rules and the required inputs of the office. */
  check: (app: Application, ruleIds?: string[] | null) => CheckReport;
  /** Who handles the case, by the office's table of family-name letters. */
  assign?: (app: Application) => { id: string; name: string; via: "range" | "substitute" | "fallback"; letter: string; covering?: string } | null;
  /** Reads a stored document again with the configured (or overridden) method. */
  reread?: (doc: DocumentRef, override?: ExtractionMethod) => Promise<{ kind: DocumentKind; extraction: Extraction } | null>;
}

export type Outcome = "approved" | "rejected" | "info" | "confirmed";
const MAX_STEPS = 60;

/** A text of a step in the language of the applicant: "subject" or "subject_en", with the German one as the fallback. */
const textOf = (node: FlowNode, key: string, app: Application): string => {
  const en = node.config[`${key}_en`];
  return app.language === "en" && typeof en === "string" && en.trim() !== "" ? en : String(node.config[key] ?? "");
};

const fill = (text: string, app: Application) =>
  text
    .replace(/\{name\}/g, `${app.student.firstName} ${app.student.lastName}`)
    .replace(/\{reference\}/g, app.reference)
    .replace(/\{amount\}/g, app.decision ? `${app.decision.monthlyAmount} €` : `${estimate(app).monthly} €`);

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

function conditionHolds(node: FlowNode, app: Application, report: CheckReport, now: Date): boolean {
  const facts = buildFacts(app, now);
  const values: Record<string, unknown> = {
    blockers: report.blockers, warnings: report.warnings, estimateMonthly: estimate(app, now).monthly, tuitionFees: app.stay.tuitionFees,
    weeks: facts.stay.weeks, stayType: app.stay.type, country: app.stay.country, isEU: String(facts.stay.isEU), source: app.source,
  };
  const field = String(node.config.field);
  const op = String(node.config.op);
  const value = String(node.config.value);
  const check: Check =
    op === "ne" ? { not: { eq: [{ ref: "v" }, value] } } : op === "eq" ? { eq: [{ ref: "v" }, value] } : op === "lte" ? { lte: [{ ref: "v" }, value] } : { gte: [{ ref: "v" }, value] };
  return evaluate(check, { v: values[field] });
}

async function execute(def: ProcessDef, start: string, input: Application, ctx: EngineCtx, begin: RunLogEntry[]): Promise<Application> {
  let app = input;
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const log: RunLogEntry[] = [...begin];
  let report: CheckReport | null = null;
  let mailDraft: { subject: string; body: string } | null = null;
  let waiting: string | undefined;
  let finished = false;
  let current: string | undefined = start;
  const at = () => ctx.now.toISOString();
  const next = (id: string, handle: string) => def.edges.find((e) => e.source === id && e.sourceHandle === handle)?.target;
  const send = (mail: Omit<Mail, "id" | "at">) => (app = { ...app, outbox: [...(app.outbox ?? []), { ...mail, id: randomUUID(), at: at() }] });

  for (let step = 0; current && step < MAX_STEPS; step++) {
    const node = byId.get(current);
    if (!node) break;
    const entry = (note: string, handle?: string) => log.push({ at: at(), nodeId: node.id, kind: node.kind, handle, note });
    let handle = "out";
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
      case "run_rules": {
        report = ctx.check(app, ruleSelection(node));
        handle = report.ready ? "complete" : "incomplete";
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
        handle = doubtful.length || unreadable ? "review" : "clear";
        entry(`${docs.filter(inScope).length} document(s) read with ${[...engines].join(", ") || "no reader"}${doubtful.length ? `; low confidence: ${doubtful.join(", ")}` : ""}${unreadable ? `; ${unreadable} unreadable` : ""}`, handle);
        break;
      }
      case "review_fields":
        waiting = node.id;
        entry(`Waiting for a person to check the fields${textOf(node, "instruction", app) ? `: ${textOf(node, "instruction", app)}` : ""}`);
        current = undefined;
        continue;
      case "condition": {
        report ??= ctx.check(app);
        const yes = conditionHolds(node, app, report, ctx.now);
        handle = yes ? "yes" : "no";
        entry(`${node.config.field} ${node.config.op} ${node.config.value}: ${handle}`, handle);
        break;
      }
      case "assign_caseworker": {
        const who = ctx.assign?.(app);
        if (!who) {
          entry("No caseworker table is set up");
          break;
        }
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
        entry(`Assigned to ${node.config.team}`);
        break;
      case "wait":
        entry(`Reminder planned in ${node.config.days} day(s) (simulated, not waited)`);
        break;
      case "ai_draft_mail":
        report ??= ctx.check(app);
        mailDraft = draftMail(app, report, String(node.config.tone));
        entry("Mail drafted by AI (simulated)");
        break;
      case "request_documents": {
        if (String(node.config.sending ?? "auto") === "caseworker" && app.officeMessage?.trim()) {
          const de = app.language === "de";
          send({ to: "student", subject: de ? `Rückfrage zu Ihrem Antrag ${app.reference}` : `Question about your application ${app.reference}`, body: frameMail(app, app.officeMessage.trim()), aiDraft: false, nodeId: node.id });
          entry("Question sent, written by the caseworker");
          break;
        }
        const body = mailDraft?.body ?? fill(textOf(node, "fallback", app), app);
        const subject = mailDraft?.subject ?? `Ihr Antrag ${app.reference}`;
        send({ to: "student", subject, body, aiDraft: Boolean(mailDraft), nodeId: node.id });
        app = { ...app, status: "info_requested", officeMessage: body.split("\n\n").slice(1, -1).join("\n\n") || body, history: [...app.history, { at: at(), kind: "info_requested", text: "Automatisch durch den Ablauf" }] };
        entry(`Documents requested, message sent${mailDraft ? " (AI draft)" : ""}`);
        break;
      }
      case "send_notification": {
        send({ to: node.config.to as Mail["to"], subject: fill(textOf(node, "subject", app), app), body: fill(textOf(node, "body", app), app), aiDraft: false, nodeId: node.id });
        entry(`Message to ${node.config.to}`);
        break;
      }
      case "connector": {
        const system = String(node.config.system);
        const action = String(node.config.action);
        const response = connectorResponse(system, action, app);
        app = { ...app, integrations: [...(app.integrations ?? []), { at: at(), nodeId: node.id, system, action, request: { reference: app.reference, amount: app.decision?.monthlyAmount }, response }] };
        entry(`${system}.${action} → ${response.externalId}`);
        break;
      }
      case "human_task":
        waiting = node.id;
        entry(`Waiting for the caseworker${textOf(node, "instruction", app) ? `: ${textOf(node, "instruction", app)}` : ""}`);
        current = undefined;
        continue;
      case "end":
        entry("Finished");
        finished = true;
        current = undefined;
        continue;
    }
    current = next(node.id, handle);
    if (!current && NODE_CATALOG[node.kind].outputs.length > 0) finished = true; // loose end: stop quietly
  }
  const flow = { processId: def.id, version: def.version, startedAt: app.flow?.startedAt ?? at(), log, waiting, finished };
  return { ...app, flow, updatedAt: at() };
}

/** Starts the live process for a submitted application. */
export async function startRun(def: ProcessDef, app: Application, ctx: EngineCtx): Promise<Application> {
  const trigger = def.nodes.find((n) => n.kind === "trigger");
  if (!trigger) return app;
  const previous = app.flow?.log ?? [];
  const marker: RunLogEntry[] = previous.length ? [...previous, { at: ctx.now.toISOString(), nodeId: trigger.id, kind: "trigger", note: "— new run —" }] : [];
  return execute(def, trigger.id, app, ctx, marker);
}

/** Continues after a caseworker acted on a waiting step. */
export async function resumeRun(def: ProcessDef, app: Application, outcome: Outcome, ctx: EngineCtx): Promise<Application> {
  const waiting = app.flow?.waiting;
  if (!waiting) return app;
  const waitingNode = def.nodes.find((n) => n.id === waiting);
  // Only outcomes the waiting step offers can continue it (a caseworker deciding while fields still need review does not).
  if (waitingNode && !NODE_CATALOG[waitingNode.kind].outputs.some((o) => o.id === outcome)) return app;
  const edge = def.edges.find((e) => e.source === waiting && e.sourceHandle === outcome);
  const log: RunLogEntry[] = [...(app.flow?.log ?? []), { at: ctx.now.toISOString(), nodeId: waiting, kind: "human_task", handle: outcome, note: `Caseworker: ${outcome}` }];
  if (!edge) return { ...app, flow: { ...app.flow!, log, waiting: undefined, finished: true } };
  return execute(def, edge.target, { ...app, flow: { ...app.flow!, waiting: undefined } }, ctx, log);
}
