import { randomUUID } from "node:crypto";
import {
  NODE_CATALOG,
  buildFacts,
  estimate,
  evaluate,
  runChecks,
  type Application,
  type Check,
  type CheckReport,
  type FlowNode,
  type Mail,
  type ProcessDef,
  type RuleState,
  type RunLogEntry,
} from "@digieurope/shared";

export interface EngineCtx {
  rules: Record<string, RuleState>;
  now: Date;
}

type Outcome = "approved" | "rejected" | "info";
const MAX_STEPS = 60;

const fill = (text: string, app: Application) =>
  text
    .replace(/\{name\}/g, `${app.student.firstName} ${app.student.lastName}`)
    .replace(/\{reference\}/g, app.reference)
    .replace(/\{amount\}/g, app.decision ? `${app.decision.monthlyAmount} €` : `${estimate(app).monthly} €`);

/** The "AI" mail draft, simulated: a clear message built from the open items, in the student's language. */
export function draftMail(app: Application, report: CheckReport, tone: string): { subject: string; body: string } {
  const de = app.language === "de";
  const items = report.findings.filter((f) => f.severity === "blocker").map((f) => `• ${f.fix[app.language]}`).join("\n");
  const first = app.student.firstName;
  const formal = tone === "formal";
  const greeting = de ? (formal ? `Sehr geehrte:r ${first} ${app.student.lastName},` : `Hallo ${first},`) : formal ? `Dear ${first} ${app.student.lastName},` : `Hi ${first},`;
  const intro = de
    ? `vielen Dank für Ihren Antrag ${app.reference}. Bevor wir ihn bearbeiten können, brauchen wir noch Folgendes:`
    : `thank you for your application ${app.reference}. Before we can process it we still need the following:`;
  const outro = de
    ? "Laden Sie die Unterlagen einfach in Ihrem Antrag hoch. Sobald alles vollständig ist, geht Ihr Antrag direkt in die Prüfung."
    : "Simply upload the documents in your application. As soon as everything is complete, your application goes straight to review.";
  return {
    subject: de ? `Ihr Antrag ${app.reference}: Das fehlt noch (${report.blockers})` : `Your application ${app.reference}: what is still missing (${report.blockers})`,
    body: `${greeting}\n\n${intro}\n\n${items}\n\n${outro}\n\n${de ? "Freundliche Grüße" : "Kind regards"}\nStudierendenwerk Musterstadt`,
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

function execute(def: ProcessDef, start: string, input: Application, ctx: EngineCtx, begin: RunLogEntry[]): Application {
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
        report = runChecks(app, ctx.rules, ctx.now);
        handle = report.ready ? "complete" : "incomplete";
        entry(report.ready ? "All approved rules pass" : `${report.blockers} blocking item(s): ${report.findings.filter((f) => f.severity === "blocker").map((f) => f.ruleId).join(", ")}`, handle);
        break;
      }
      case "read_documents":
        entry(`${app.documents.filter((d) => d.extraction.readable).length} document(s) read into fields (simulated AI)`);
        break;
      case "condition": {
        report ??= runChecks(app, ctx.rules, ctx.now);
        const yes = conditionHolds(node, app, report, ctx.now);
        handle = yes ? "yes" : "no";
        entry(`${node.config.field} ${node.config.op} ${node.config.value}: ${handle}`, handle);
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
        report ??= runChecks(app, ctx.rules, ctx.now);
        mailDraft = draftMail(app, report, String(node.config.tone));
        entry("Mail drafted by AI (simulated)");
        break;
      case "request_documents": {
        const body = mailDraft?.body ?? fill(String(node.config.fallback), app);
        const subject = mailDraft?.subject ?? `Ihr Antrag ${app.reference}`;
        send({ to: "student", subject, body, aiDraft: Boolean(mailDraft), nodeId: node.id });
        app = { ...app, status: "info_requested", officeMessage: body.split("\n\n").slice(1, -1).join("\n\n") || body, history: [...app.history, { at: at(), kind: "info_requested", text: "Automatisch durch den Ablauf" }] };
        entry(`Documents requested, message sent${mailDraft ? " (AI draft)" : ""}`);
        break;
      }
      case "send_notification": {
        send({ to: node.config.to as Mail["to"], subject: fill(String(node.config.subject), app), body: fill(String(node.config.body), app), aiDraft: false, nodeId: node.id });
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
        entry(`Waiting for the caseworker${node.config.instruction ? `: ${node.config.instruction}` : ""}`);
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
export function startRun(def: ProcessDef, app: Application, ctx: EngineCtx): Application {
  const trigger = def.nodes.find((n) => n.kind === "trigger");
  if (!trigger) return app;
  const previous = app.flow?.log ?? [];
  const marker: RunLogEntry[] = previous.length ? [...previous, { at: ctx.now.toISOString(), nodeId: trigger.id, kind: "trigger", note: "— new run —" }] : [];
  return execute(def, trigger.id, app, ctx, marker);
}

/** Continues after a caseworker acted on a waiting step. */
export function resumeRun(def: ProcessDef, app: Application, outcome: Outcome, ctx: EngineCtx): Application {
  const waiting = app.flow?.waiting;
  if (!waiting) return app;
  const edge = def.edges.find((e) => e.source === waiting && e.sourceHandle === outcome);
  const log: RunLogEntry[] = [...(app.flow?.log ?? []), { at: ctx.now.toISOString(), nodeId: waiting, kind: "human_task", handle: outcome, note: `Caseworker: ${outcome}` }];
  if (!edge) return { ...app, flow: { ...app.flow!, log, waiting: undefined, finished: true } };
  return execute(def, edge.target, { ...app, flow: { ...app.flow!, waiting: undefined } }, ctx, log);
}
