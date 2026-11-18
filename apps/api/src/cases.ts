import { randomBytes, randomUUID } from "node:crypto";
import {
  estimate,
  explainEstimate,
  draftExplanation,
  processRuleIds,
  runChecks,
  type AuditRecord,
  BUILTIN_TEMPLATES,
  DEFAULT_CATEGORY,
  type DocumentTemplate,
  type ExtractionMethod,
  type Application,
  type CaseView,
  type DocumentKind,
  type DocumentRef,
  type Extraction,
  type HistoryEntry,
  type Lang,
  type StayInfo,
  type StudentInfo,
} from "@digieurope/shared";
import { extractDocument, specOf } from "./documents.js";
import { draftMail, questionText } from "./engine.js";
import { readConfigured } from "./extraction.js";
import type { Store } from "./store.js";

export const PARENT_KINDS: DocumentKind[] = ["parent_form", "parent_tax"];

/** Built-in templates plus the ones accepted from proposals. */
export const allTemplates = (store: Store): DocumentTemplate[] => [...BUILTIN_TEMPLATES, ...store.templates()];
export const allSpecs = (store: Store) => allTemplates(store).map(specOf);

/** Runs the approved rules and the inputs the office's live process requires. */
export function checksFor(store: Store, app: Application, now: Date = new Date(), ruleIds?: string[] | null) {
  const live = store.process(DEFAULT_CATEGORY)?.live;
  const ids = ruleIds === undefined ? (live ? processRuleIds(live) : null) : ruleIds;
  const rules = ids === null ? store.liveRules() : store.liveRules().filter((r) => ids.includes(r.id));
  return runChecks(app, store.ruleStates(), now, rules, { inputs: live?.inputs, templates: allTemplates(store) });
}

/** Open points about documents themselves: unreadable ones and fields read with low confidence. In the student's language. */
export function documentQuestions(store: Store, app: Application, minConfidence = 0.8): string[] {
  const de = app.language === "de";
  const specs = allSpecs(store);
  const out: string[] = [];
  for (const d of app.documents) {
    const spec = specs.find((x) => x.kind === d.kind);
    const title = spec?.title ?? d.filename;
    if (!d.extraction.readable) {
      out.push(de ? `„${title}“ ließ sich nicht lesen. Bitte laden Sie eine bessere Kopie hoch.` : `“${title}” could not be read. Please upload a clearer copy.`);
    } else if (d.extraction.needsReview) {
      const unsure = Object.entries(d.extraction.confidence ?? {})
        .filter(([, c]) => c < minConfidence)
        .map(([k]) => spec?.fields.find(([key]) => key === k)?.[1] ?? k.replace(/_/g, " "));
      out.push(de ? `„${title}“: Bitte prüfen Sie diese Angaben${unsure.length ? ` (${unsure.join(", ")})` : ""} und laden Sie bei Bedarf eine lesbarere Kopie hoch.` : `“${title}”: please check these details${unsure.length ? ` (${unsure.join(", ")})` : ""} and upload a clearer copy if needed.`);
    }
  }
  return out;
}

/** A prefilled question for the student: the open rule findings plus unclear documents. The caseworker edits and sends it. */
export function questionDraft(store: Store, app: Application, now: Date = new Date()) {
  const report = checksFor(store, app, now);
  const extra = documentQuestions(store, app);
  const mail = draftMail(app, report, "friendly", extra);
  return { subject: mail.subject, message: questionText(app, report, extra), items: report.findings.filter((f) => f.severity === "blocker").length + extra.length };
}

/** The rule ids the live process applies; null means all live rules. */
export const appliedRuleIds = (store: Store): string[] | null => {
  const live = store.process(DEFAULT_CATEGORY)?.live;
  return live ? processRuleIds(live) : null;
};

/** Reads a file with the method configured for its document type, knowing all accepted templates. */
export const readFor = (store: Store, content: Buffer, mimeType: string, override?: ExtractionMethod) =>
  readConfigured(content, mimeType, store.config(), override, fetch, allSpecs(store));

const log = (app: Application, kind: HistoryEntry["kind"], now: Date, text?: string): Application => ({
  ...app,
  updatedAt: now.toISOString(),
  history: [...app.history, { at: now.toISOString(), kind, text }],
});

export function newApplication(
  store: Store,
  input: { student: StudentInfo; stay: StayInfo; language: Lang; source?: "web" | "portal" },
  now: Date = new Date(),
): Application {
  const app: Application = {
    id: randomUUID(),
    reference: store.nextReference("MS", now.getUTCFullYear()),
    status: "draft",
    language: input.language,
    source: input.source ?? "web",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    student: input.student,
    stay: input.stay,
    parents: { status: "not_requested", email: "", married: null, siblingsInEducation: 0 },
    documents: [],
    history: [{ at: now.toISOString(), kind: "created" }],
    firstFindings: [],
  };
  return store.put(app);
}

export function view(store: Store, app: Application, webUrl: string, now: Date = new Date()): CaseView {
  const token = store.parentTokenFor(app.id);
  return {
    ...app,
    report: checksFor(store, app, now),
    templateNames: Object.fromEntries(store.templates().map((t) => [t.id, t.name])),
    estimate: estimate(app, now),
    parentLink: token ? `${webUrl}/parent/${token}` : undefined,
  };
}

/** Reads a file into fields, files it under the detected type and replaces an older upload of the same type. */
export function addDocument(
  store: Store,
  app: Application,
  file: { filename: string; mimeType: string; content: Buffer },
  by: DocumentRef["uploadedBy"],
  now: Date = new Date(),
  read?: { kind: DocumentKind; extraction: Extraction },
): Application {
  const { kind, extraction } = read ?? extractDocument(file.content, file.mimeType, allSpecs(store));
  const old = extraction.readable ? app.documents.filter((d) => d.kind === kind) : [];
  for (const o of old) store.deleteDocument(o.id);
  const meta: DocumentRef = {
    id: randomUUID(),
    kind,
    filename: file.filename.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120),
    mimeType: file.mimeType,
    size: file.content.length,
    uploadedAt: now.toISOString(),
    uploadedBy: by,
    extraction,
  };
  store.saveDocument(app.id, meta, file.content);
  let next: Application = { ...app, documents: [...app.documents.filter((d) => !old.includes(d)), meta], updatedAt: now.toISOString() };
  if (next.documents.some((d) => d.kind === "parent_form" && d.extraction.readable) && next.documents.some((d) => d.kind === "parent_tax" && d.extraction.readable)) {
    if (next.parents.status !== "received") next = log({ ...next, parents: { ...next.parents, status: "received" } }, "parent_uploaded", now);
  }
  const form = next.documents.find((d) => d.kind === "parent_form" && d.extraction.readable);
  if (form) {
    next = {
      ...next,
      parents: {
        ...next.parents,
        married: form.extraction.fields.parents_married ? form.extraction.fields.parents_married === "Ja" : next.parents.married,
        siblingsInEducation: Number(form.extraction.fields.siblings_in_education ?? 0) || 0,
      },
    };
  }
  return store.put(next);
}

export function removeDocument(store: Store, app: Application, docId: string): Application {
  store.deleteDocument(docId);
  return store.put({ ...app, documents: app.documents.filter((d) => d.id !== docId) });
}

/** The explicit "check my application" step. Remembers what was wrong the first time, for the office insights. */
export function checkNow(store: Store, app: Application, now: Date = new Date()): Application {
  const report = checksFor(store, app, now);
  let next = app;
  if (app.firstFindings.length === 0 && !app.history.some((h) => h.kind === "checked")) {
    next = { ...next, firstFindings: report.findings.filter((f) => f.severity === "blocker").map((f) => f.ruleId) };
  }
  return store.put(log(next, "checked", now, report.ready ? "ready" : `${report.blockers} to fix`));
}

export function invite(store: Store, app: Application, email: string, now: Date = new Date()): Application {
  store.setParentToken(randomBytes(12).toString("hex"), app.id);
  return store.put(log({ ...app, parents: { ...app.parents, status: app.parents.status === "received" ? "received" : "requested", email } }, "parent_invited", now));
}

export function submit(store: Store, app: Application, now: Date = new Date()): Application {
  const next = log({ ...app, status: "submitted", submittedAt: app.submittedAt ?? now.toISOString(), officeMessage: undefined }, "submitted", now);
  return store.put(next);
}

export type OfficeAction = "request_info" | "approve" | "reject";

export function officeAct(
  store: Store,
  app: Application,
  action: OfficeAction,
  body: { message?: string; amount?: number; by: string },
  now: Date = new Date(),
): Application {
  if (action === "request_info") {
    return store.put(log({ ...app, status: "info_requested", officeMessage: body.message }, "info_requested", now, body.message));
  }
  const approved = action === "approve";
  const outcome = approved ? "approved" : "rejected";
  const amount = approved ? body.amount ?? 0 : 0;
  // The student always gets a written explanation: the caseworker's own words, or a draft from the calculation.
  const note = body.message?.trim() || draftFor(app, outcome, amount, app.language, now);
  const decided = log(
    { ...app, status: outcome, decision: { outcome, monthlyAmount: amount, note, decidedAt: now.toISOString(), decidedBy: body.by } },
    outcome,
    now,
    body.message,
  );
  return withAudit(store, decided, now);
}

const SOURCES = [
  { label: "BAföG §§ 5, 11–13, 21–25 (gesetze-im-internet.de)", url: "https://www.gesetze-im-internet.de/baf_g/" },
  { label: "BAföG-AuslandszuschlagsV", url: "https://www.gesetze-im-internet.de/bafg_auslzuschlv/" },
];

/** Freezes what a decision rested on: rule versions and results, inputs, documents, calculation, process steps. */
export function buildAudit(store: Store, app: Application, now: Date = new Date()): AuditRecord | undefined {
  const d = app.decision;
  if (!d) return undefined;
  const report = checksFor(store, app, now);
  const failed = new Set(report.findings.map((f) => f.ruleId));
  const passed = new Set(report.passed.map((p) => p.ruleId));
  const applied = appliedRuleIds(store);
  const rules = Object.values(store.rules())
    .filter((r) => r.live && !r.paused && (applied === null || applied.includes(r.live.rule.id)))
    .map((r) => ({
      id: r.live!.rule.id,
      version: r.live!.rule.version,
      title: r.live!.rule.title,
      result: failed.has(r.live!.rule.id) ? ("fail" as const) : passed.has(r.live!.rule.id) ? ("pass" as const) : ("n/a" as const),
      severity: r.live!.rule.severity,
      approvedBy: r.live!.approvedBy,
      source: r.live!.rule.source.label,
    }));
  const def = store.process(DEFAULT_CATEGORY)?.live;
  return {
    recordedAt: now.toISOString(),
    decidedBy: d.decidedBy,
    outcome: d.outcome,
    monthlyAmount: d.monthlyAmount,
    process: app.flow ? { id: app.flow.processId, name: def?.id === app.flow.processId ? def.name : app.flow.processId, version: app.flow.version } : null,
    processSteps: (app.flow?.log ?? []).map((l) => ({ at: l.at, step: l.kind, handle: l.handle, note: l.note })),
    rules,
    inputs: (report.requirements ?? []).map((r) => ({ ref: r.ref, label: r.label, required: r.required, applies: r.applies, state: r.state })),
    documents: app.documents.map((doc) => {
      const conf = Object.values(doc.extraction.confidence ?? {});
      return {
        kind: doc.kind,
        filename: doc.filename,
        uploadedAt: doc.uploadedAt,
        uploadedBy: doc.uploadedBy,
        engine: doc.extraction.engine ?? "builtin",
        lowestConfidence: conf.length ? Math.min(...conf) : null,
        flaggedForReview: !!doc.extraction.needsReview,
        note: doc.extraction.note,
      };
    }),
    calculation: explainEstimate(app, now),
    sources: SOURCES,
  };
}

/** Re-freezes the record after the process has moved on, so the steps after the decision are in it too. */
export const withAudit = (store: Store, app: Application, now: Date = new Date()): Application =>
  app.decision ? store.put({ ...app, decision: { ...app.decision, audit: buildAudit(store, app, now) } }) : app;

export const draftFor = (app: Application, outcome: "approved" | "rejected", amount: number, lang: Lang = app.language, now: Date = new Date()) =>
  draftExplanation(explainEstimate(app, now), outcome, amount, lang);

export function open(store: Store, app: Application, now: Date = new Date()): Application {
  if (app.status !== "submitted") return app;
  return store.put(log({ ...app, status: "in_review" }, "opened", now));
}
