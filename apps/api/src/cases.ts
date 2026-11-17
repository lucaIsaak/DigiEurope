import { randomBytes, randomUUID } from "node:crypto";
import {
  estimate,
  runChecks,
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
import { readConfigured } from "./extraction.js";
import type { Store } from "./store.js";

export const PARENT_KINDS: DocumentKind[] = ["parent_form", "parent_tax"];

/** Built-in templates plus the ones accepted from proposals. */
export const allTemplates = (store: Store): DocumentTemplate[] => [...BUILTIN_TEMPLATES, ...store.templates()];
export const allSpecs = (store: Store) => allTemplates(store).map(specOf);

/** Runs the approved rules and the inputs the office's live process requires. */
export function checksFor(store: Store, app: Application, now: Date = new Date()) {
  const inputs = store.process(DEFAULT_CATEGORY)?.live?.inputs;
  return runChecks(app, store.ruleStates(), now, undefined, { inputs, templates: allTemplates(store) });
}

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
  return store.put(
    log(
      {
        ...app,
        status: approved ? "approved" : "rejected",
        decision: { outcome: approved ? "approved" : "rejected", monthlyAmount: approved ? body.amount ?? 0 : 0, note: body.message ?? "", decidedAt: now.toISOString(), decidedBy: body.by },
      },
      approved ? "approved" : "rejected",
      now,
      body.message,
    ),
  );
}

export function open(store: Store, app: Application, now: Date = new Date()): Application {
  if (app.status !== "submitted") return app;
  return store.put(log({ ...app, status: "in_review" }, "opened", now));
}
