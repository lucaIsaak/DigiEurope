import { createHash, randomUUID } from "node:crypto";
import { estimate, type AgentRun, type AgentStage, type AgentState, type Application, type CheckReport, type Mail } from "@digieurope/shared";
import { allSpecs, checksFor, officeAct } from "./cases.js";
import { DEFAULT_MIN_CONFIDENCE, flagReview, parseReading, readingPrompt } from "./extraction.js";
import { chatJson, documentPart, llmAvailable } from "./llm.js";
import { questionText } from "./engine.js";
import type { Store } from "./store.js";

/**
 * The always-on agents. A scheduler calls `tick()` every couple of minutes; each tick gives every open case to the
 * pipeline below. The pipeline is deterministic wherever the rules are (checks, amount) and calls a cheap language
 * model only where reading or judgement is needed: documents the template reader cannot read, names that differ,
 * and the briefing for an employee. No model output ever changes an amount or a decision.
 *
 *   intake → verification → rules → allocation → supervisor (+ correspondence)
 *
 * The result of a case is one of three stages. The agents never approve or reject: an employee does, in one click
 * when the stage is `ready_for_approval`.
 */

export interface AgentRunnerCtx {
  store: Store;
  now: () => Date;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

const OPEN: Application["status"][] = ["submitted", "in_review", "info_requested"];
const MAX_RUNS = 40;

/** What the agents look at. If none of it changed since the last run, there is nothing to do. */
export function fingerprint(app: Application): string {
  const basis = {
    student: app.student,
    stay: app.stay,
    parents: { s: app.parents.status, m: app.parents.married, n: app.parents.siblingsInEducation },
    info: app.info ?? {},
    docs: app.documents.map((d) => [d.id, d.kind, d.extraction.readable, d.extraction.needsReview ?? false, JSON.stringify(d.extraction.fields)]),
    failed: app.flow?.failed ?? false,
  };
  return createHash("sha1").update(JSON.stringify(basis)).digest("hex").slice(0, 16);
}

const tokens = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Same person by spelling alone: same words in any order, or one name is the other plus middle names. */
export function sameName(a: string, b: string): boolean {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (x.size === 0 || y.size === 0) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every((t) => big.has(t));
}

export interface CaseOutcome {
  app: Application;
  stage: AgentStage;
}

/** Runs the pipeline on one case. Returns null when the case changed under it (a person acted): the next tick retries. */
export async function processCase(ctx: AgentRunnerCtx, app: Application): Promise<CaseOutcome | null> {
  const { store } = ctx;
  const startFp = fingerprint(app);
  const now = ctx.now();
  const at = now.toISOString();
  const runs: AgentRun[] = [];
  const note = (agent: AgentRun["agent"], summary: string, llm = false) => runs.push({ at, agent, summary, llm });
  let work = app;
  const specs = allSpecs(store);

  // 1. Intake: documents the template reader could not read go to the model, if one is configured.
  const unreadable = work.documents.filter((d) => !d.extraction.readable);
  if (unreadable.length && llmAvailable()) {
    const docs = [...work.documents];
    const recovered: string[] = [];
    for (const d of unreadable) {
      const stored = store.readDocument(d.id);
      if (!stored) continue;
      const answer = await chatJson(readingPrompt(specs), [documentPart(stored.content, d.mimeType, d.filename), { type: "text", text: "Extract the fields as JSON." }], ctx.fetchImpl, 1500);
      if (!answer) continue;
      const read = parseReading(answer, "openrouter", specs);
      if (!read.extraction.readable) continue;
      docs[docs.indexOf(d)] = { ...d, kind: read.kind !== "unknown" ? read.kind : d.kind, extraction: flagReview(read.extraction, DEFAULT_MIN_CONFIDENCE) };
      recovered.push(d.filename);
    }
    work = { ...work, documents: docs };
    note("intake", recovered.length ? `Read with the language model: ${recovered.join(", ")}` : `${unreadable.length} document(s) stay unreadable after the model tried`, true);
  } else if (unreadable.length) {
    note("intake", `${unreadable.length} document(s) unreadable; no language model configured`);
  } else {
    note("intake", `${work.documents.length} document(s) read`);
  }

  // 2. Verification: does the name on each document belong to the applicant? Spelling first, the model only for real differences.
  const applicant = `${work.student.firstName} ${work.student.lastName}`;
  const differing = work.documents.filter((d) => d.extraction.readable && d.extraction.fields.name && !sameName(d.extraction.fields.name, applicant));
  const reasons: string[] = [];
  let verifiedByModel = false;
  if (differing.length && llmAvailable()) {
    const pairs = differing.map((d, i) => ({ i, document: d.extraction.fields.name, applicant }));
    const answer = (await chatJson(
      'You compare person names from administrative documents. For each pair say whether they plausibly name the same person (spelling variants, transliteration, a nickname, a missing middle name). Different people or doubt: false. Reply with JSON only: {"results":[{"i":number,"same":boolean,"confidence":number 0..1}]}',
      JSON.stringify(pairs),
      ctx.fetchImpl,
    )) as { results?: { i?: number; same?: boolean; confidence?: number }[] } | null;
    verifiedByModel = Boolean(answer);
    differing.forEach((d, i) => {
      const r = answer?.results?.find((x) => x.i === i);
      if (!(r?.same === true && Number(r.confidence) >= 0.8)) reasons.push(`The name on ${d.filename} ("${d.extraction.fields.name}") may not match the applicant "${applicant}".`);
    });
  } else {
    for (const d of differing) reasons.push(`The name on ${d.filename} ("${d.extraction.fields.name}") may not match the applicant "${applicant}".`);
  }
  note("verification", differing.length ? `${differing.length} name(s) differ from the applicant; ${reasons.length} could not be cleared` : "Names on all documents match the applicant", verifiedByModel);
  for (const d of work.documents.filter((x) => x.extraction.needsReview)) reasons.push(`Fields of ${d.filename} were read with low confidence and need a person's check.`);
  if (work.flow?.failed) reasons.push(`The process stopped with an error: ${work.flow.error?.message ?? "unknown"}.`);

  // 3. Rules: deterministic, no model.
  const report: CheckReport = checksFor(store, work, now);
  const blockers = report.findings.filter((f) => f.severity === "blocker");
  note("rules", blockers.length ? `${blockers.length} blocker(s): ${blockers.map((b) => b.ruleId).join(", ")}` : `All checks passed${report.warnings ? `, ${report.warnings} warning(s)` : ""}`);

  // 4. Allocation: the amount follows the country, the parents' income and the stay. A proposal, never a decision.
  const est = estimate(work, now);
  const proposal = { monthly: est.monthly, low: est.low, high: est.high, months: est.months, oneOff: est.oneOff, provisional: est.provisional };
  note("allocation", `Proposed ${est.monthly} EUR a month for ${est.months} month(s) (${est.low}–${est.high})${est.provisional ? ", provisional: parents' income unknown" : ""}`);

  // 5. Supervisor: who has to act next.
  let stage: AgentStage;
  let escalation: AgentState["escalation"];
  let askedFor = work.agent?.askedFor;
  if (reasons.length) {
    stage = "needs_employee";
    const facts = { reference: work.reference, country: work.stay.country, blockers: blockers.map((b) => b.title.en), reasons, proposal };
    const answer = llmAvailable()
      ? ((await chatJson('You brief a caseworker in at most 50 words: what is wrong with this application and what to check first. Use only the facts given. Reply with JSON only: {"summary": string}', JSON.stringify(facts), ctx.fetchImpl, 300)) as { summary?: string } | null)
      : null;
    const summary = typeof answer?.summary === "string" && answer.summary.trim() ? answer.summary.trim() : reasons.join(" ");
    escalation = { reasons, summary, llm: Boolean(answer?.summary) };
    note("supervisor", `Needs an employee: ${reasons.length} point(s)`, escalation.llm);
  } else if (blockers.length) {
    stage = "waiting_student";
    const key = blockers.map((b) => b.ruleId).sort().join("|");
    if (key !== askedFor) {
      // 6. Correspondence: ask the student once for exactly what is missing.
      const body = questionText(work, report);
      const mail: Mail = {
        id: randomUUID(),
        to: "student",
        subject: work.language === "de" ? `Ihr Antrag ${work.reference}: Das fehlt noch (${blockers.length})` : `Your application ${work.reference}: what is still missing (${blockers.length})`,
        body: `${work.language === "de" ? "Hallo" : "Hi"} ${work.student.firstName},\n\n${body}\n\n${work.language === "de" ? "Freundliche Grüße" : "Kind regards"}\nStudierendenwerk Musterstadt`,
        at,
        aiDraft: false,
        nodeId: "agent:correspondence",
      };
      work = officeAct(store, { ...work, outbox: [...(work.outbox ?? []), mail] }, "request_info", { message: body, by: "Agent" }, now);
      askedFor = key;
      note("correspondence", `Asked the student for ${blockers.length} item(s)`);
    }
    note("supervisor", "Waiting for the student");
  } else {
    stage = "ready_for_approval";
    if (work.status === "info_requested") work = { ...work, status: "submitted", officeMessage: undefined };
    askedFor = undefined;
    note("supervisor", `Complete. Ready for one-click approval of ${proposal.monthly} EUR a month`);
  }

  const agent: AgentState = { fingerprint: startFp, stage, lastRunAt: at, runs: [...(work.agent?.runs ?? []), ...runs].slice(-MAX_RUNS), proposal, escalation, askedFor };
  work = {
    ...work,
    agent,
    history: [...work.history, { at, kind: "note", text: `Agents: ${stage.replace(/_/g, " ")}` }],
    updatedAt: at,
  };

  // A person may have acted while the model was thinking. Then this result is stale: drop it, the next tick starts again.
  const fresh = store.get(app.id);
  if (!fresh || fresh.decision || fingerprint(fresh) !== startFp) return null;
  return { app: store.put(work), stage };
}

export interface TickResult {
  ranAt: string;
  considered: number;
  processed: number;
  unchanged: number;
  stale: number;
  errors: number;
  stages: Record<AgentStage, number>;
  busy?: boolean;
}

/** The agents' scheduler body. One tick at a time: a slow tick makes the next one skip rather than overlap. */
export function createAgentRunner(ctx: AgentRunnerCtx) {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async tick(): Promise<TickResult> {
      const empty: TickResult = { ranAt: ctx.now().toISOString(), considered: 0, processed: 0, unchanged: 0, stale: 0, errors: 0, stages: { waiting_student: 0, ready_for_approval: 0, needs_employee: 0 } };
      if (busy) return { ...empty, busy: true };
      busy = true;
      try {
        const result = empty;
        for (const a of ctx.store.list().filter((x) => OPEN.includes(x.status) && !x.decision)) {
          result.considered += 1;
          if (a.agent?.fingerprint === fingerprint(a)) {
            result.unchanged += 1;
            result.stages[a.agent.stage] += 1;
            continue;
          }
          try {
            const out = await processCase(ctx, a);
            if (out) {
              result.processed += 1;
              result.stages[out.stage] += 1;
            } else result.stale += 1;
          } catch {
            result.errors += 1;
          }
        }
        return result;
      } finally {
        busy = false;
      }
    },
  };
}

/** The employee's view: cases the agents hand over, grouped by what is needed. */
export function agentQueue(store: Store) {
  const row = (a: Application) => ({
    id: a.id,
    reference: a.reference,
    student: `${a.student.firstName} ${a.student.lastName}`,
    country: a.stay.country,
    stage: a.agent!.stage,
    lastRunAt: a.agent!.lastRunAt,
    proposal: a.agent!.proposal ?? null,
    escalation: a.agent!.escalation ?? null,
    lastSteps: a.agent!.runs.slice(-6),
  });
  const cases = store.list().filter((a) => a.agent && OPEN.includes(a.status) && !a.decision);
  return {
    llm: llmAvailable(),
    counts: {
      needs_employee: cases.filter((a) => a.agent!.stage === "needs_employee").length,
      ready_for_approval: cases.filter((a) => a.agent!.stage === "ready_for_approval").length,
      waiting_student: cases.filter((a) => a.agent!.stage === "waiting_student").length,
    },
    cases: cases.map(row).sort((x, y) => (x.stage === "needs_employee" ? 0 : x.stage === "ready_for_approval" ? 1 : 2) - (y.stage === "needs_employee" ? 0 : y.stage === "ready_for_approval" ? 1 : 2) || y.lastRunAt.localeCompare(x.lastRunAt)),
  };
}
