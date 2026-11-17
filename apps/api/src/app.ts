import { randomBytes } from "node:crypto";
import Fastify, { type FastifyReply } from "fastify";
import {
  RULES,
  baselineFacts,
  describeCheck,
  estimate,
  runRuleTests,
  type Application,
  type CaseStatus,
  type DocumentKind,
  type ExtractionMethod,
  type Lang,
  DEFAULT_CATEGORY,
  PROCESS_CATALOG,
  catalogVariant,
  catalogVariants,
  harmony,
  isCatalogVariant,
  referenceProcess,
  type Bilingual,
  type Condition,
  factCatalog,
  toCheck,
  type FieldType,
  type InputCondition,
  type ProcessDef,
  type ProcessInput,
  type TemplateField,
  type TemplateProposal,
  suggestTemplateFromLines,
  type StaffMember,
  type StayInfo,
  type StudentInfo,
  validateProcess,
} from "@digieurope/shared";
import { resumeRun, startRun, type EngineCtx } from "./engine.js";
import { PEER_OFFICES, REFERENCE_SETTINGS, type OfficeProcess } from "./offices.js";
import { DEFAULT_MIN_CONFIDENCE, aiAvailable, methodsInfo } from "./extraction.js";
import { Store as ScratchStore } from "./store.js";
import { askLive, liveAvailable, retrieve } from "./assistant.js";
import { PARENT_KINDS, addDocument, allSpecs, allTemplates, checksFor, readFor, checkNow, invite, newApplication, officeAct, open, removeDocument, submit, view, withAudit, draftFor, type OfficeAction } from "./cases.js";
import { extractDocument } from "./documents.js";
import { readPdfLines } from "./pdf.js";
import { computeInsights } from "./metrics.js";
import { SAMPLE_SETS, fixDocuments, formblatt8, getPerson, proposalSample, sampleDocuments, sampleLetter, type Defect } from "./samples.js";
import { deliverFromPortal, seedDemoData } from "./seed.js";
import type { Store } from "./store.js";

declare module "fastify" {
  interface FastifyRequest {
    staff: StaffMember | null;
  }
}

export interface AppOptions {
  store: Store;
  logger?: boolean;
  webUrl?: string;
  now?: () => Date;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const EDITABLE: CaseStatus[] = ["draft", "info_requested"];

export function buildApp(opts: AppOptions) {
  const { store } = opts;
  const now = opts.now ?? (() => new Date());
  const webUrl = opts.webUrl ?? "http://localhost:3000";
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 12 * 1024 * 1024 });
  app.decorateRequest("staff", null);
  const needsBuild = (method: string, url: string) =>
    url.startsWith("/office/processes") || (method !== "GET" && /^\/office\/rules\/[^/]+\/(approve|revoke|draft|discard)/.test(url));
  /** Setting up how documents are read: process designers and the extractor owner. */
  const needsExtractorAccess = (method: string, url: string) => method !== "GET" && (url.startsWith("/office/inputs") || url.startsWith("/office/config"));
  /** How a template is read is decided by the extractor owner (or an administrator). */
  const needsOwner = (method: string, url: string) => method !== "GET" && (url === "/office/extraction" || /^\/office\/templates\/[^/]+\/confirm$/.test(url));
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0]!;
    const token = req.headers["x-staff-token"];
    req.staff = store.staffBySession(typeof token === "string" ? token : undefined) ?? null;
    const protectedRoute = url.startsWith("/office") || url === "/staff/me" || url === "/staff/logout";
    const oversightArea = url.startsWith("/oversight");
    if (!protectedRoute && !oversightArea) return;
    if (!req.staff) return reply.code(401).send({ error: "Please sign in as staff." });
    if (oversightArea && !req.staff.isOversight) return reply.code(403).send({ error: "Only the oversight body can compare offices." });
    if (req.staff.isOversight && url.startsWith("/office")) return reply.code(403).send({ error: "Oversight accounts do not work in an office." });
    if (url.startsWith("/office/staff") && !req.staff.isAdmin) return reply.code(403).send({ error: "Only administrators can do this." });
    if (needsBuild(req.method, url) && !req.staff.canBuild && !req.staff.isAdmin) return reply.code(403).send({ error: "You do not have access to the process builder." });
    if (needsOwner(req.method, url) && !req.staff.canApproveTemplates && !req.staff.isAdmin) return reply.code(403).send({ error: "Only the extractor owner can change how documents are read." });
    if (needsExtractorAccess(req.method, url) && !req.staff.canBuild && !req.staff.canApproveTemplates && !req.staff.isAdmin) return reply.code(403).send({ error: "You do not have access to document reading settings." });
  });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "Not found" });
  const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });
  const v = (a: Application) => view(store, a, webUrl, now());
  /** Hands a submitted application to the live process of the office. */
  const engineCtx = (from: Store = store): EngineCtx => ({
    now: now(),
    check: (a) => checksFor(store, a, now()),
    reread: async (doc, override) => {
      const f = from.readDocument(doc.id);
      return f ? readFor(store, f.content, doc.mimeType, override) : null;
    },
  });
  const liveDef = () => store.process(DEFAULT_CATEGORY)?.live ?? null;
  const runLive = async (a: Application) => {
    const def = liveDef();
    return def ? store.put(await startRun(def, a, engineCtx())) : a;
  };

  function readFile(body: { filename?: string; mimeType?: string; dataBase64?: string } | undefined) {
    const { filename, mimeType, dataBase64 } = body ?? {};
    if (typeof dataBase64 !== "string" || !mimeType || !["application/pdf", "image/png", "image/jpeg"].includes(mimeType)) return { error: "Only PDF, PNG or JPEG files are accepted." };
    const content = Buffer.from(dataBase64, "base64");
    if (content.length === 0 || content.length > MAX_UPLOAD_BYTES) return { error: "File must be between 1 byte and 5 MB." };
    return { file: { filename: filename ?? "document.pdf", mimeType, content } };
  }

  app.get("/health", async () => ({ status: "ok", service: "bafoeg-prototype-api", time: now().toISOString() }));
  app.get("/meta", async () => ({ office: store.config().name, liveAssistant: liveAvailable(), languages: store.config().languages }));

  // ---- Student ------------------------------------------------------------
  app.post<{ Body: { student?: StudentInfo; stay?: StayInfo; language?: Lang } }>("/applications", async (req, reply) => {
    const { student, stay, language } = req.body ?? {};
    if (!student?.firstName?.trim() || !student.lastName?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(student.birthDate ?? "")) return bad(reply, "Name and birth date are required.");
    if (!stay || !/^\d{4}-\d{2}-\d{2}$/.test(stay.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(stay.endDate) || stay.endDate <= stay.startDate) return bad(reply, "Please enter a valid period.");
    if (stay.type !== "study" && stay.type !== "internship") return bad(reply, "Unknown type of stay.");
    const created = newApplication(store, { student, stay: { ...stay, tuitionFees: Math.max(0, Number(stay.tuitionFees) || 0) }, language: language === "en" ? "en" : "de" }, now());
    return reply.code(201).send(v(created));
  });

  app.get<{ Params: { id: string } }>("/applications/:id", async (req, reply) => {
    const a = store.get(req.params.id);
    return a ? v(a) : notFound(reply);
  });

  app.patch<{ Params: { id: string }; Body: { student?: Partial<StudentInfo>; stay?: Partial<StayInfo> } }>("/applications/:id", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    if (!EDITABLE.includes(a.status)) return bad(reply, "Application can no longer be edited.", 409);
    return v(store.put({ ...a, student: { ...a.student, ...req.body?.student }, stay: { ...a.stay, ...req.body?.stay }, updatedAt: now().toISOString() }));
  });

  app.post<{ Params: { id: string }; Body: { filename?: string; mimeType?: string; dataBase64?: string } }>("/applications/:id/documents", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    if (!EDITABLE.includes(a.status)) return bad(reply, "Application can no longer be edited.", 409);
    const r = readFile(req.body);
    if ("error" in r) return bad(reply, r.error!);
    const read = await readFor(store, r.file!.content, r.file!.mimeType);
    return reply.code(201).send(v(addDocument(store, a, r.file!, "student", now(), read)));
  });

  app.delete<{ Params: { id: string; docId: string } }>("/applications/:id/documents/:docId", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a || !a.documents.some((d) => d.id === req.params.docId)) return notFound(reply);
    if (!EDITABLE.includes(a.status)) return bad(reply, "Application can no longer be edited.", 409);
    return v(removeDocument(store, a, req.params.docId));
  });

  app.post<{ Params: { id: string } }>("/applications/:id/check", async (req, reply) => {
    const a = store.get(req.params.id);
    return a ? v(checkNow(store, a, now())) : notFound(reply);
  });

  app.post<{ Params: { id: string }; Body: { email?: string } }>("/applications/:id/parents", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    const email = req.body?.email?.trim() ?? "";
    if (!/^\S+@\S+\.\S+$/.test(email)) return bad(reply, "Please enter a valid e-mail address.");
    return v(invite(store, a, email, now()));
  });

  app.post<{ Params: { id: string } }>("/applications/:id/submit", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    if (!EDITABLE.includes(a.status)) return bad(reply, "Application was already submitted.", 409);
    if (!checksFor(store, a, now()).ready) return bad(reply, "There are still items to fix.", 409);
    return v(await runLive(submit(store, a, now())));
  });

  app.get<{ Querystring: { reference?: string; birthDate?: string } }>("/status/lookup", async (req, reply) => {
    const a = store.findByReference(req.query.reference ?? "");
    if (!a || a.student.birthDate !== req.query.birthDate) return notFound(reply);
    return { id: a.id };
  });

  app.get<{ Params: { docId: string } }>("/documents/:docId", async (req, reply) => {
    const doc = store.readDocument(req.params.docId);
    if (!doc) return notFound(reply);
    return reply.header("Content-Type", doc.meta.mimeType).header("Content-Disposition", `inline; filename="${doc.meta.filename.replace(/"/g, "")}"`).header("X-Content-Type-Options", "nosniff").send(doc.content);
  });

  // ---- Parents (own link, no account) --------------------------------------
  const parentView = (a: Application) => ({
    studentName: `${a.student.firstName} ${a.student.lastName}`,
    status: a.parents.status,
    incomeYear: Number(a.stay.startDate.slice(0, 4)) - 2,
    documents: a.documents.filter((d) => PARENT_KINDS.includes(d.kind)).map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, readable: d.extraction.readable, signed: d.extraction.signatures.parent, taxYear: d.extraction.fields.tax_year })),
  });

  app.get<{ Params: { token: string } }>("/parent/:token", async (req, reply) => {
    const a = store.applicationForParentToken(req.params.token);
    return a ? parentView(a) : notFound(reply);
  });

  app.post<{ Params: { token: string }; Body: { filename?: string; mimeType?: string; dataBase64?: string } }>("/parent/:token/documents", async (req, reply) => {
    const a = store.applicationForParentToken(req.params.token);
    if (!a) return notFound(reply);
    if (!EDITABLE.includes(a.status) && a.status !== "submitted") return bad(reply, "The application is already being processed.", 409);
    const r = readFile(req.body);
    if ("error" in r) return bad(reply, r.error!);
    const detected = extractDocument(r.file!.content, r.file!.mimeType, allSpecs(store)).kind;
    if (detected !== "unknown" && !PARENT_KINDS.includes(detected)) return bad(reply, "This looks like a document for the student, not for the parents.");
    const read = await readFor(store, r.file!.content, r.file!.mimeType);
    return reply.code(201).send(parentView(addDocument(store, a, r.file!, "parent", now(), read)));
  });

  // ---- Assistant and decision-letter reader ---------------------------------
  app.post<{ Body: { question?: string; lang?: Lang; live?: boolean } }>("/assistant", async (req, reply) => {
    const q = req.body?.question?.trim();
    if (!q) return bad(reply, "Please type a question.");
    const lang: Lang = req.body?.lang === "en" ? "en" : "de";
    return req.body?.live && liveAvailable() ? askLive(q, lang) : retrieve(q, lang);
  });

  app.post<{ Body: { filename?: string; mimeType?: string; dataBase64?: string } }>("/letter/read", async (req, reply) => {
    const r = readFile(req.body);
    if ("error" in r) return bad(reply, r.error!);
    const { kind, extraction } = extractDocument(r.file!.content, r.file!.mimeType, allSpecs(store));
    if (kind !== "decision_letter" || !extraction.readable) return bad(reply, "We could not read this as a decision letter. Please upload the PDF of your last letter.", 422);
    const f = extraction.fields;
    const n = (k: string) => Number(f[k] ?? 0) || 0;
    return {
      name: f.name ?? "", period_from: f.period_from ?? "", period_to: f.period_to ?? "", country: f.country ?? "", need_monthly: n("need_monthly"),
      parent_income_year: n("parent_income_year"), parent_net_monthly: n("parent_net_monthly"), parents_married: f.parents_married !== "Nein",
      siblings_in_education: n("siblings_in_education"), parent_contribution: n("parent_contribution"), grant_monthly: n("grant_monthly"),
      tuition_supplement: n("tuition_supplement"), tuition_months: n("tuition_months"), travel_allowance: n("travel_allowance"),
    };
  });

  // ---- Office -----------------------------------------------------------------
  const summary = (a: Application) => {
    const r = checksFor(store, a, now());
    return {
      id: a.id, reference: a.reference, name: `${a.student.lastName}, ${a.student.firstName}`, country: a.stay.country, stayType: a.stay.type, status: a.status,
      source: a.source, submittedAt: a.submittedAt ?? null, updatedAt: a.updatedAt, blockers: r.blockers, warnings: r.warnings, estimateMonthly: estimate(a, now()).monthly,
      team: a.assignedTeam ?? null, waitingAt: liveDef()?.nodes.find((n) => n.id === a.flow?.waiting)?.kind ?? null,
    };
  };

  app.get<{ Querystring: { status?: string } }>("/office/cases", async (req) =>
    store.list().filter((a) => a.status !== "draft" && (!req.query.status || a.status === req.query.status)).sort((x, y) => (y.submittedAt ?? "").localeCompare(x.submittedAt ?? "")).map(summary),
  );

  app.get<{ Params: { id: string } }>("/office/cases/:id", async (req, reply) => {
    const a = store.get(req.params.id);
    return a ? v(a) : notFound(reply);
  });

  app.post<{ Params: { id: string } }>("/office/cases/:id/open", async (req, reply) => {
    const a = store.get(req.params.id);
    return a ? v(open(store, a, now())) : notFound(reply);
  });

  app.post<{ Params: { id: string }; Body: { action?: OfficeAction; message?: string; amount?: number } }>("/office/cases/:id/actions", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    const { action, message, amount } = req.body ?? {};
    if (a.status === "approved" || a.status === "rejected") return bad(reply, "This case is already decided.", 409);
    if (a.status === "draft") return bad(reply, "This case has not been submitted.", 409);
    const waitingKind = liveDef()?.nodes.find((n) => n.id === a.flow?.waiting)?.kind;
    if (waitingKind === "review_fields" && (action === "approve" || action === "reject")) return bad(reply, "Check the fields that were read with low confidence first.", 409);
    if (action === "request_info") {
      if (!message?.trim()) return bad(reply, "Please write what is missing.");
    } else if (action === "approve") {
      if (!checksFor(store, a, now()).ready) return bad(reply, "There are open blocking items. Request information first.", 409);
      if (typeof amount !== "number" || amount < 0 || amount > 5000) return bad(reply, "Please enter the monthly amount.");
    } else if (action === "reject") {
      if (!message?.trim()) return bad(reply, "Please give a reason.");
    } else return bad(reply, "Unknown action.");
    const acted = officeAct(store, a, action, { message, amount, by: req.staff?.name ?? "Sachbearbeitung" }, now());
    const outcome = action === "approve" ? "approved" : action === "reject" ? "rejected" : "info";
    const def = liveDef();
    return v(def ? withAudit(store, store.put(await resumeRun(def, acted, outcome, engineCtx())), now()) : acted);
  });

  // ---- Explainability: a draft explanation before deciding, the frozen technical record after ----
  app.get<{ Params: { id: string }; Querystring: { outcome?: string; amount?: string; lang?: string } }>("/office/cases/:id/explanation", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    const outcome = req.query.outcome === "rejected" ? "rejected" : "approved";
    const lang = req.query.lang === "en" ? "en" : req.query.lang === "de" ? "de" : a.language;
    return { text: draftFor(a, outcome, Number(req.query.amount ?? 0) || 0, lang, now()) };
  });

  app.get<{ Params: { id: string } }>("/office/cases/:id/audit", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    if (!a.decision?.audit) return bad(reply, "This case has no decision yet.", 404);
    const record = { reference: a.reference, application: a.id, decision: { ...a.decision, audit: undefined }, audit: a.decision.audit, history: a.history };
    return reply
      .header("content-disposition", `attachment; filename="audit-${a.reference}.json"`)
      .type("application/json")
      .send(JSON.stringify(record, null, 2));
  });

  app.post("/office/portal/deliver", async (_req, reply) => reply.code(201).send(summary(await runLive(deliverFromPortal(store, now())))));

  app.get("/office/insights", async () => computeInsights(store.list(), now()));

  // ---- Rules: versions, editing, two-person approval -----------------------------------
  const BASE = () => baselineFacts() as unknown as Record<string, unknown>;
  const ruleView = (id: string) => {
    const r = store.rules()[id]!;
    const base = r.draft?.rule ?? r.live?.rule ?? RULES.find((x) => x.id === id)!;
    return {
      id,
      title: base.title,
      scope: base.scope,
      status: r.draft && r.live ? "changed" : r.draft ? "draft" : r.paused ? "paused" : "live",
      paused: r.paused,
      live: r.live ? { ...r.live, tests: runRuleTests(r.live.rule, BASE()) } : null,
      draft: r.draft ? { ...r.draft, tests: runRuleTests(r.draft.rule, BASE()) } : null,
      history: r.history,
    };
  };

  app.get("/office/rules", async () => Object.keys(store.rules()).map(ruleView));

  app.put<{ Params: { id: string }; Body: { title?: Bilingual; plain?: Bilingual; fix?: Bilingual; severity?: "blocker" | "warning"; when?: Condition[]; pass?: Condition[]; tests?: { name: string; expectPass: boolean }[] } }>(
    "/office/rules/:id/draft",
    async (req, reply) => {
      const r = store.rules()[req.params.id];
      if (!r) return notFound(reply);
      const base = r.draft?.rule ?? r.live?.rule ?? RULES.find((x) => x.id === req.params.id)!;
      const body = req.body ?? {};
      const known = new Set(factCatalog(allTemplates(store)).map((f) => f.path));
      const lines = [...(body.when ?? []), ...(body.pass ?? [])];
      const OPS = ["present", "absent", "eq", "ne", "gte", "lte"];
      if (!body.pass?.length) return bad(reply, "A rule needs at least one condition that must hold.");
      for (const c of lines) {
        if (!known.has(c.path) || !OPS.includes(c.op) || (c.valueRef && !known.has(c.valueRef))) return bad(reply, `Unknown condition: ${c.path}`);
      }
      const text = (x: Bilingual | undefined, fallback: Bilingual): Bilingual => ({ de: String(x?.de ?? fallback.de).slice(0, 600), en: String(x?.en ?? fallback.en).slice(0, 600) });
      const tests = base.tests.map((tc) => ({ ...tc, expectPass: body.tests?.find((x) => x.name === tc.name)?.expectPass ?? tc.expectPass }));
      const rule = {
        ...base,
        version: (r.live?.rule.version ?? base.version - 1) + 1,
        title: text(body.title, base.title),
        plain: text(body.plain, base.plain),
        fix: text(body.fix, base.fix),
        severity: body.severity === "warning" ? "warning" : body.severity === "blocker" ? "blocker" : base.severity,
        when: toCheck(body.when ?? []),
        pass: toCheck(body.pass)!,
        tests,
        draftedByAi: false,
      } as typeof base;
      store.setRule(req.params.id, { ...r, draft: { rule, author: req.staff!.name, createdAt: now().toISOString() } });
      return ruleView(req.params.id);
    },
  );

  app.post<{ Params: { id: string } }>("/office/rules/:id/approve", async (req, reply) => {
    const r = store.rules()[req.params.id];
    if (!r) return notFound(reply);
    if (!r.draft) {
      if (!r.paused) return bad(reply, "There is nothing to approve.", 409);
      store.setRule(req.params.id, { ...r, paused: false });
      return ruleView(req.params.id);
    }
    // Two-person rule: whoever wrote a change cannot approve it.
    if (r.draft.author === req.staff!.name) return bad(reply, "You wrote this change. Another person has to approve it.", 409);
    if (runRuleTests(r.draft.rule, BASE()).some((x) => !x.ok)) return bad(reply, "Not all sample cases pass. The rule cannot be approved.", 409);
    const approved = { ...r.draft, approvedBy: req.staff!.name, approvedAt: now().toISOString() };
    store.setRule(req.params.id, { live: approved, paused: false, draft: undefined, history: r.live ? [...r.history, r.live] : r.history });
    return ruleView(req.params.id);
  });

  app.post<{ Params: { id: string } }>("/office/rules/:id/discard", async (req, reply) => {
    const r = store.rules()[req.params.id];
    if (!r?.draft) return notFound(reply);
    if (!r.live) return bad(reply, "This rule has no approved version yet. Change it instead of discarding.", 409);
    store.setRule(req.params.id, { ...r, draft: undefined });
    return ruleView(req.params.id);
  });

  app.post<{ Params: { id: string } }>("/office/rules/:id/revoke", async (req, reply) => {
    const r = store.rules()[req.params.id];
    if (!r) return notFound(reply);
    store.setRule(req.params.id, { ...r, paused: true });
    return ruleView(req.params.id);
  });

  // ---- What needs the signed-in person ---------------------------------------------
  app.get("/office/todo", async (req) => {
    const me = req.staff!;
    const builder = me.canBuild || me.isAdmin;
    const owner = me.canApproveTemplates || me.isAdmin;
    const rules = Object.values(store.rules());
    const used = new Set(Object.values(store.processes()).flatMap((p) => [...(p.live?.inputs ?? []), ...(p.draft?.inputs ?? [])]).filter((i) => i.type === "document").map((i) => i.ref));
    return {
      rulesToApprove: builder ? rules.filter((r) => r.draft && r.draft.author !== me.name).length : 0,
      myRuleDrafts: rules.filter((r) => r.draft?.author === me.name).length,
      proposalsToDecide: owner ? store.proposals().filter((p) => p.status === "submitted").length : 0,
      myProposals: store.proposals().filter((p) => p.proposedBy === me.name && (p.status === "draft" || p.status === "rejected")).length,
      templatesToCheck: owner ? allTemplates(store).filter((t) => !store.config().templateChecks[t.id] && (t.source === "accepted" || used.has(t.id))).length : 0,
      processDrafts: builder ? Object.values(store.processes()).filter((p) => p.draft).length : 0,
    };
  });

  app.get("/office/config", async () => ({ config: store.config(), documentTypes: allSpecs(store).map((s) => ({ kind: s.kind, title: s.title, fields: s.fields.map(([key, label]) => ({ key, label })), signatures: s.sigs.map(([key, label]) => ({ key, label })) })) }));

  app.put<{ Body: { slaDays?: number; languages?: Lang[] } }>("/office/config", async (req) => {
    const c = store.config();
    store.setConfig({ ...c, slaDays: Math.min(60, Math.max(1, Number(req.body?.slaDays) || c.slaDays)), languages: req.body?.languages?.length ? req.body.languages : c.languages });
    return store.config();
  });

  app.post<{ Body: { filename?: string; mimeType?: string; dataBase64?: string } }>("/office/inputs/extract", async (req, reply) => {
    const r = readFile(req.body);
    if ("error" in r) return bad(reply, r.error!);
    const { kind, extraction } = extractDocument(r.file!.content, r.file!.mimeType, allSpecs(store));
    return { kind, extraction };
  });

  app.post<{ Body: { kind?: DocumentKind; fields?: string[] } }>("/office/inputs/confirm", async (req, reply) => {
    const { kind, fields } = req.body ?? {};
    if (!kind || !allSpecs(store).some((x) => x.kind === kind) || !Array.isArray(fields)) return bad(reply, "Missing document type or fields.");
    const c = store.config();
    store.setConfig({ ...c, expectedInputs: { ...c.expectedInputs, [kind]: { fields, confirmedAt: now().toISOString() } } });
    return store.config();
  });


  // ---- Document reading: methods, settings, human review ---------------------------
  app.get("/office/extraction", async () => ({
    methods: methodsInfo(),
    config: { defaultMethod: store.config().defaultMethod, byType: store.config().extraction },
    defaultMinConfidence: DEFAULT_MIN_CONFIDENCE,
    aiKey: aiAvailable(),
  }));

  app.put<{ Body: { kind?: DocumentKind | "default"; method?: ExtractionMethod; minConfidence?: number } }>("/office/extraction", async (req, reply) => {
    const { kind, method, minConfidence } = req.body ?? {};
    if (!method || !methodsInfo().some((m) => m.id === method)) return bad(reply, "Unknown method.");
    const c = store.config();
    if (kind === "default") store.setConfig({ ...c, defaultMethod: method });
    else if (kind && allSpecs(store).some((x) => x.kind === kind)) {
      const min = Math.min(1, Math.max(0.3, Number(minConfidence) || DEFAULT_MIN_CONFIDENCE));
      store.setConfig({ ...c, extraction: { ...c.extraction, [kind]: { method, minConfidence: min } } });
      logTemplate(kind, req.staff!.name, `Reading set to ${method}, review below ${Math.round(min * 100)} %`);
    } else return bad(reply, "Unknown document type.");
    return { config: { defaultMethod: store.config().defaultMethod, byType: store.config().extraction } };
  });

  /** A person checks the fields that were read with low confidence, corrects them and confirms. */
  app.post<{ Params: { id: string }; Body: { docId?: string; fields?: Record<string, string> } }>("/office/cases/:id/review", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    const doc = a.documents.find((d) => d.id === req.body?.docId);
    if (!doc) return notFound(reply);
    const edits = req.body?.fields ?? {};
    const fields = { ...doc.extraction.fields };
    const confidence = { ...(doc.extraction.confidence ?? {}) };
    for (const [k, val] of Object.entries(edits)) {
      if (!(k in fields)) continue;
      fields[k] = String(val).slice(0, 200);
      confidence[k] = 1; // confirmed by a person
    }
    const still = Object.values(confidence).some((x) => x < (store.config().extraction[doc.kind]?.minConfidence ?? DEFAULT_MIN_CONFIDENCE));
    const updated = { ...a, documents: a.documents.map((d) => (d.id === doc.id ? { ...d, extraction: { ...d.extraction, fields, confidence, needsReview: still, note: "Checked by " + (req.staff?.name ?? "staff") } } : d)) };
    store.put(updated);
    const open = updated.documents.some((d) => d.extraction.needsReview);
    const def = liveDef();
    const next = open || !def ? updated : await resumeRun(def, updated, "confirmed", engineCtx());
    return v(store.put(next));
  });


  // ---- Required information (custom questions of the live process) --------------------
  app.put<{ Params: { id: string }; Body: { key?: string; value?: string } }>("/applications/:id/info", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    if (!EDITABLE.includes(a.status)) return bad(reply, "Application can no longer be edited.", 409);
    const live = store.process(DEFAULT_CATEGORY)?.live;
    const q = live?.inputs.find((i) => i.type === "info" && i.question && i.ref === req.body?.key);
    if (!q) return bad(reply, "Unknown question.");
    const value = String(req.body?.value ?? "").slice(0, 300);
    if (q.question!.type === "yesno" && value !== "" && value !== "yes" && value !== "no") return bad(reply, "Please answer yes or no.");
    return v(store.put({ ...a, info: { ...(a.info ?? {}), [q.ref]: value }, updatedAt: now().toISOString() }));
  });

  // ---- Templates and proposals --------------------------------------------------------
  const canApprove = (s: { isAdmin: boolean; canApproveTemplates?: boolean } | null) => Boolean(s && (s.isAdmin || s.canApproveTemplates));
  const canPropose = (s: { isAdmin: boolean; canBuild: boolean } | null) => Boolean(s && (s.isAdmin || s.canBuild));
  const slug = (x: string) => x.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  app.get("/office/templates", async (req, reply) => {
    if (!canApprove(req.staff) && !canPropose(req.staff)) return bad(reply, "You do not have access to templates.", 403);
    const cfg = store.config();
    return {
      templates: allTemplates(store).map((t) => ({
        ...t,
        extraction: cfg.extraction[t.id] ?? { method: cfg.defaultMethod, minConfidence: DEFAULT_MIN_CONFIDENCE },
        check: cfg.templateChecks[t.id] ?? null,
        usedIn: Object.entries(store.processes()).filter(([, p]) => [...(p.live?.inputs ?? []), ...(p.draft?.inputs ?? [])].some((i) => i.type === "document" && i.ref === t.id)).map(([catalogId, p]) => ({ catalogId, name: (p.live ?? p.draft)?.name ?? catalogId })),
        log: cfg.templateLog.filter((l) => l.templateId === t.id).slice(-12).reverse(),
      })),
      proposals: [...store.proposals()].sort((a, b) => b.proposedAt.localeCompare(a.proposedAt)),
      canApprove: canApprove(req.staff),
      canPropose: canPropose(req.staff),
    };
  });

  const cleanFields = (xs: unknown): TemplateField[] | null => {
    if (!Array.isArray(xs) || xs.length === 0 || xs.length > 40) return null;
    const seen = new Set<string>();
    const out: TemplateField[] = [];
    for (const x of xs as TemplateField[]) {
      const key = String(x.key ?? "").trim();
      const label = String(x.label ?? "").trim().slice(0, 120);
      if (!/^[a-z0-9_]{1,40}$/.test(key) || !label || seen.has(key)) return null;
      seen.add(key);
      out.push({ key, label, type: FIELD_TYPES.includes(x.type) ? x.type : "text", required: x.required !== false });
    }
    return out;
  };

  const proposalFromBody = (body: Record<string, unknown>, base: Partial<TemplateProposal>): TemplateProposal | string => {
    const name = String(body.name ?? "").trim().slice(0, 120);
    const title = String(body.title ?? "").trim().slice(0, 200);
    const fields = cleanFields(body.fields);
    if (!name) return "Please give the template a name.";
    if (!title) return "Please enter the title as printed on the document. The reader recognises the form by it.";
    if (!fields) return "Please list the fields (unique keys, a label each).";
    const clash = allTemplates(store).some((t) => t.title === title) || store.proposals().some((p) => p.id !== base.id && p.title === title && (p.status === "submitted" || p.status === "accepted"));
    if (clash) return "A template or a pending proposal with this title already exists.";
    const providedBy = ["student", "parents", "office", "third_party"].includes(String(body.providedBy)) ? (body.providedBy as TemplateProposal["providedBy"]) : "student";
    const category = ["official_form", "study", "work", "money", "insurance", "office"].includes(String(body.category)) ? (body.category as TemplateProposal["category"]) : "official_form";
    const signatures = Array.isArray(body.signatures) ? (body.signatures as { key: string; label: string }[]).slice(0, 8).filter((x) => /^[a-z0-9_]{1,40}$/.test(String(x.key)) && String(x.label ?? "").trim()).map((x) => ({ key: String(x.key), label: String(x.label).trim().slice(0, 120) })) : [];
    return {
      id: base.id ?? randomBytes(8).toString("hex"),
      status: base.status ?? "draft",
      proposedBy: base.proposedBy ?? "",
      proposedAt: base.proposedAt ?? now().toISOString(),
      formblatt: body.formblatt ? String(body.formblatt).trim().slice(0, 40) : undefined,
      name, title, purpose: String(body.purpose ?? "").trim().slice(0, 400), providedBy, category, fields, signatures,
      sampleFilename: body.sampleFilename ? String(body.sampleFilename).slice(0, 120) : undefined,
    };
  };

  /** Suggests fields from a sample document. A heuristic stand-in for an AI suggestion: it reads "label: value" lines. */
  app.post<{ Body: { filename?: string; mimeType?: string; dataBase64?: string } }>("/office/templates/proposals/suggest", async (req, reply) => {
    if (!canPropose(req.staff)) return bad(reply, "Only process designers can propose templates.", 403);
    const r = readFile(req.body);
    if ("error" in r) return bad(reply, r.error!);
    if (r.file!.mimeType !== "application/pdf") return bad(reply, "Please upload a PDF.", 422);
    const s = suggestTemplateFromLines(readPdfLines(r.file!.content));
    if (!s.title || s.fields.length === 0) return bad(reply, "We could not find fields in this document. You can enter them by hand.", 422);
    return { ...s, sampleFilename: r.file!.filename };
  });

  app.post<{ Body: Record<string, unknown> & { submit?: boolean } }>("/office/templates/proposals", async (req, reply) => {
    if (!canPropose(req.staff)) return bad(reply, "Only process designers can propose templates.", 403);
    const p = proposalFromBody(req.body ?? {}, { proposedBy: req.staff!.name, status: req.body?.submit ? "submitted" : "draft" });
    if (typeof p === "string") return bad(reply, p);
    store.putProposal(p);
    return reply.code(201).send(p);
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> & { submit?: boolean } }>("/office/templates/proposals/:id", async (req, reply) => {
    const old = store.proposals().find((x) => x.id === req.params.id);
    if (!old) return notFound(reply);
    if (old.proposedBy !== req.staff!.name || !(old.status === "draft" || old.status === "rejected")) return bad(reply, "Only the author can change a draft or a rejected proposal.", 409);
    const p = proposalFromBody(req.body ?? {}, { ...old, status: req.body?.submit ? "submitted" : "draft", decidedBy: undefined, decidedAt: undefined, decisionNote: undefined });
    if (typeof p === "string") return bad(reply, p);
    store.putProposal(p);
    return p;
  });

  app.post<{ Params: { id: string }; Body: { method?: ExtractionMethod; minConfidence?: number } }>("/office/templates/proposals/:id/accept", async (req, reply) => {
    if (!canApprove(req.staff)) return bad(reply, "Only the extractor owner can accept proposals.", 403);
    const p = store.proposals().find((x) => x.id === req.params.id);
    if (!p) return notFound(reply);
    if (p.status !== "submitted") return bad(reply, "Only submitted proposals can be accepted.", 409);
    const method = req.body?.method;
    if (!method || !methodsInfo().some((m) => m.id === method)) return bad(reply, "Please choose how this template is extracted.");
    let id = `tpl-${slug(p.name) || "form"}`;
    for (let n = 2; allTemplates(store).some((t) => t.id === id); n++) id = `tpl-${slug(p.name)}-${n}`;
    store.addTemplate({ id, category: p.category ?? "official_form", formblatt: p.formblatt, name: { de: p.name, en: p.name }, title: p.title, purpose: { de: p.purpose, en: p.purpose }, providedBy: p.providedBy, fields: p.fields, signatures: p.signatures, source: "accepted" });
    const c = store.config();
    store.setConfig({ ...c, extraction: { ...c.extraction, [id]: { method, minConfidence: Math.min(1, Math.max(0.3, Number(req.body?.minConfidence) || DEFAULT_MIN_CONFIDENCE)) } } });
    logTemplate(id, req.staff!.name, `Accepted from the proposal by ${p.proposedBy}; read with ${method}`);
    const done: TemplateProposal = { ...p, status: "accepted", decidedBy: req.staff!.name, decidedAt: now().toISOString(), templateId: id };
    store.putProposal(done);
    return done;
  });

  app.post<{ Params: { id: string }; Body: { comment?: string } }>("/office/templates/proposals/:id/reject", async (req, reply) => {
    if (!canApprove(req.staff)) return bad(reply, "Only the extractor owner can reject proposals.", 403);
    const p = store.proposals().find((x) => x.id === req.params.id);
    if (!p) return notFound(reply);
    if (p.status !== "submitted") return bad(reply, "Only submitted proposals can be rejected.", 409);
    if (!req.body?.comment?.trim()) return bad(reply, "Please say what should change.");
    const done: TemplateProposal = { ...p, status: "rejected", decidedBy: req.staff!.name, decidedAt: now().toISOString(), decisionNote: req.body.comment.trim().slice(0, 400) };
    store.putProposal(done);
    return done;
  });


  const logTemplate = (templateId: string, by: string, text: string) => {
    const c = store.config();
    store.setConfig({ ...c, templateLog: [...c.templateLog, { templateId, at: now().toISOString(), by, text }].slice(-300) });
  };

  /** Reads a sample with the template's own reading method and shows what came out. Nothing is stored. */
  app.post<{ Params: { id: string }; Body: { filename?: string; mimeType?: string; dataBase64?: string } }>("/office/templates/:id/test", async (req, reply) => {
    const t = allTemplates(store).find((x) => x.id === req.params.id);
    if (!t) return notFound(reply);
    const r = readFile(req.body);
    if ("error" in r) return bad(reply, r.error!);
    const read = await readFor(store, r.file!.content, r.file!.mimeType);
    return { ...read, matches: read.kind === t.id, expected: t.fields.map((f) => f.key) };
  });

  app.post<{ Params: { id: string } }>("/office/templates/:id/confirm", async (req, reply) => {
    const t = allTemplates(store).find((x) => x.id === req.params.id);
    if (!t) return notFound(reply);
    const c = store.config();
    store.setConfig({ ...c, templateChecks: { ...c.templateChecks, [t.id]: { confirmedAt: now().toISOString(), confirmedBy: req.staff!.name } } });
    logTemplate(t.id, req.staff!.name, "Tested with a sample and confirmed");
    return { ok: true };
  });

  // ---- Sample documents (for the demo) ------------------------------------
  const sampleFiles = (setId: string) => {
    const set = SAMPLE_SETS.find((s) => s.id === setId);
    if (!set) return null;
    const person = getPerson(set.person, now());
    return { set, docs: sampleDocuments(person, set.defects), fixes: Object.values(fixDocuments(person)) };
  };

  app.get("/samples", async () => ({
    sets: SAMPLE_SETS.map((s) => {
      const f = sampleFiles(s.id)!;
      const item = (d: { kind: string; filename: string }) => ({ name: d.filename, kind: d.kind, audience: PARENT_KINDS.includes(d.kind as DocumentKind) ? "parents" : "student" });
      const extras = s.id === "mira" ? [{ name: formblatt8(getPerson("mira", now())).filename, kind: "fb08", audience: "student" }] : [];
      return { id: s.id, title: s.title, note: s.note, docs: f.docs.map(item), fixes: f.fixes.map(item), extras };
    }),
    letter: sampleLetter(getPerson("noah", now())).filename,
    proposal: proposalSample().filename,
  }));

  app.get<{ Params: { set: string; folder: string; name: string } }>("/samples/files/:set/:folder/:name", async (req, reply) => {
    let file: { filename: string; content: Buffer } | undefined;
    if (req.params.set === "letter") file = sampleLetter(getPerson("noah", now()));
    else if (req.params.set === "proposal") file = proposalSample();
    else if (req.params.folder === "extras") file = formblatt8(getPerson("mira", now()));
    else {
      const f = sampleFiles(req.params.set);
      file = (req.params.folder === "fixes" ? f?.fixes : f?.docs)?.find((d) => d.filename === req.params.name);
    }
    if (!file) return notFound(reply);
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `inline; filename="${file.filename}"`).send(file.content);
  });


  // ---- Staff and access -------------------------------------------------------
  app.get("/staff/accounts", async () => store.staff().map(({ id, name, title }) => ({ id, name, title })));
  app.post<{ Body: { staffId?: string } }>("/staff/login", async (req, reply) => {
    const member = store.staff().find((m) => m.id === req.body?.staffId);
    if (!member) return bad(reply, "Unknown account.", 401);
    const token = randomBytes(18).toString("hex");
    store.login(member.id, token);
    return { token, staff: member };
  });
  app.get("/staff/me", async (req) => req.staff);
  app.post("/staff/logout", async (req) => {
    const t = req.headers["x-staff-token"];
    if (typeof t === "string") store.logout(t);
    return { ok: true };
  });
  app.get("/office/staff", async () => store.staff());
  app.put<{ Params: { id: string }; Body: { canBuild?: boolean; canApproveTemplates?: boolean } }>("/office/staff/:id", async (req, reply) => {
    const m = store.staff().find((x) => x.id === req.params.id);
    if (!m) return notFound(reply);
    if (m.isAdmin) return bad(reply, "Administrators always have access.", 409);
    store.setStaff(m.id, {
      ...(req.body?.canBuild !== undefined ? { canBuild: Boolean(req.body.canBuild) } : {}),
      ...(req.body?.canApproveTemplates !== undefined ? { canApproveTemplates: Boolean(req.body.canApproveTemplates) } : {}),
    });
    return store.staff();
  });

  // ---- Process builder ------------------------------------------------------------
  /** Every process belongs to one entry of the central process catalogue. */
  const FIELD_TYPES: FieldType[] = ["text", "number", "date", "yesno"];
  const cleanCondition = (w: unknown): InputCondition | undefined => {
    const c = w as { kind?: string; value?: string; key?: string; equals?: string } | undefined;
    if (c?.kind === "stay_type" && (c.value === "study" || c.value === "internship")) return { kind: "stay_type", value: c.value };
    if (c?.kind === "tuition") return { kind: "tuition" };
    if (c?.kind === "info" && c.key && typeof c.equals === "string") return { kind: "info", key: String(c.key).slice(0, 60), equals: c.equals.slice(0, 60) };
    return undefined;
  };
  const cleanInputs = (xs: unknown): ProcessInput[] =>
    Array.isArray(xs)
      ? (xs as ProcessInput[]).slice(0, 60).map((i) => {
          const when = cleanCondition(i.when);
          const q = i.question;
          return {
            id: String(i.id).slice(0, 80),
            type: i.type === "info" ? "info" : "document",
            ref: String(i.ref).slice(0, 80),
            required: Boolean(i.required),
            ...(when ? { when } : {}),
            ...(q ? { question: { label: { de: String(q.label?.de ?? "").slice(0, 200), en: String(q.label?.en ?? "").slice(0, 200) }, type: FIELD_TYPES.includes(q.type) ? q.type : "text", ...(q.help ? { help: { de: String(q.help.de ?? "").slice(0, 300), en: String(q.help.en ?? "").slice(0, 300) } } : {}) } } : {}),
          };
        })
      : [];
  const cleanDef = (def: ProcessDef | undefined, by: string, version: number): ProcessDef | null => {
    if (!def || !Array.isArray(def.nodes) || !Array.isArray(def.edges) || def.nodes.length > 80 || def.edges.length > 200) return null;
    if (!isCatalogVariant(def.catalogId)) return null;
    return {
      id: String(def.id ?? def.catalogId).slice(0, 80),
      catalogId: def.catalogId,
      name: String(def.name ?? "Process").slice(0, 120),
      version,
      updatedAt: now().toISOString(),
      updatedBy: by,
      inputs: cleanInputs(def.inputs),
      nodes: def.nodes.map((n) => ({ id: String(n.id), kind: n.kind, position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 }, config: n.config ?? {} })),
      edges: def.edges.map((e) => ({ id: String(e.id), source: String(e.source), sourceHandle: String(e.sourceHandle), target: String(e.target) })),
    };
  };
  /** Process validation plus a check that every required form is a template the office knows. */
  const inputIssues = (def: ProcessDef) => {
    const known = new Set(allTemplates(store).map((t) => t.id));
    const extra = def.inputs.filter((i) => i.type === "document" && !known.has(i.ref)).map((i) => ({ message: { de: `Die Vorlage „${i.ref}“ ist unbekannt.`, en: `The template “${i.ref}” is unknown.` } }));
    const checks = store.config().templateChecks;
    const unchecked = def.inputs.filter((i) => i.type === "document" && known.has(i.ref) && !checks[i.ref]).map((i) => ({ message: { de: `Die Vorlage „${i.ref}“ wurde noch nicht mit einem Beispiel geprüft und bestätigt.`, en: `The template “${i.ref}” has not been tested with a sample and confirmed yet.` } }));
    extra.push(...unchecked);
    return [...validateProcess(def), ...extra];
  };
  const nextVersion = (category: string) => (store.process(category)?.live?.version ?? 0) + 1;

  app.get("/office/processes/list", async () =>
    Object.entries(store.processes()).map(([catalogId, p]) => ({ catalogId, name: (p.draft ?? p.live)?.name ?? catalogId, liveVersion: p.live?.version ?? null, hasDraft: Boolean(p.draft) })),
  );

  app.get<{ Querystring: { category?: string } }>("/office/processes", async (req, reply) => {
    const category = req.query.category ?? DEFAULT_CATEGORY;
    const p = store.process(category);
    if (!p) return notFound(reply);
    return { catalogId: category, live: p.live, draft: p.draft ?? null, history: p.history.map(({ version, updatedAt, updatedBy, name }) => ({ version, updatedAt, updatedBy, name })) };
  });

  /** Starts a new process in a catalogue category that has none yet. */
  app.post<{ Body: { catalogId?: string; name?: string } }>("/office/processes/create", async (req, reply) => {
    const { catalogId, name } = req.body ?? {};
    if (!catalogId || !isCatalogVariant(catalogId)) return bad(reply, "Please choose a category from the process catalogue.");
    if (store.process(catalogId)) return bad(reply, "This office already has a process in this category.", 409);
    const title = catalogVariant(catalogId)!.path.at(-1)!.de;
    const draft: ProcessDef = { id: catalogId, catalogId, name: (name ?? "").trim().slice(0, 120) || title, version: 1, updatedAt: now().toISOString(), updatedBy: req.staff!.name, inputs: [], nodes: [{ id: "start", kind: "trigger", position: { x: 0, y: 0 }, config: { source: "any" } }], edges: [] };
    store.setProcess(catalogId, { live: null, draft, history: [] });
    return reply.code(201).send(draft);
  });

  app.put<{ Body: { def?: ProcessDef } }>("/office/processes/draft", async (req, reply) => {
    const cat = req.body?.def?.catalogId ?? "";
    const p = store.process(cat);
    if (!p) return notFound(reply);
    const def = cleanDef(req.body?.def, req.staff!.name, nextVersion(cat));
    if (!def) return bad(reply, "This process cannot be saved.");
    store.setProcess(cat, { ...p, draft: def });
    return def;
  });

  app.post<{ Body: { def?: ProcessDef } }>("/office/processes/validate", async (req, reply) => {
    const def = cleanDef(req.body?.def, req.staff!.name, 0);
    return def ? { issues: inputIssues(def) } : bad(reply, "Invalid process.");
  });

  app.post<{ Body: { def?: ProcessDef } }>("/office/processes/publish", async (req, reply) => {
    const cat = req.body?.def?.catalogId ?? "";
    const p = store.process(cat);
    if (!p) return notFound(reply);
    const def = cleanDef(req.body?.def, req.staff!.name, nextVersion(cat));
    if (!def) return bad(reply, "Invalid process.");
    const issues = inputIssues(def);
    if (issues.length) return reply.code(422).send({ error: "The process has open issues.", issues });
    store.setProcess(cat, { live: def, draft: undefined, history: p.live ? [...p.history, p.live] : p.history });
    return def;
  });

  app.post<{ Body: { category?: string; version?: number } }>("/office/processes/restore", async (req, reply) => {
    const cat = req.body?.category ?? DEFAULT_CATEGORY;
    const p = store.process(cat);
    const old = p?.history.find((h) => h.version === req.body?.version);
    if (!p || !old) return notFound(reply);
    store.setProcess(cat, { ...p, draft: { ...old, version: nextVersion(cat), updatedAt: now().toISOString(), updatedBy: req.staff!.name } });
    return store.process(cat)!.draft;
  });

  /** Runs a process on a sample case in a scratch store. Nothing real is touched. */
  app.post<{ Body: { def?: ProcessDef; sample?: string; decision?: "approved" | "rejected" | "info" | "confirmed" } }>("/office/processes/test", async (req, reply) => {
    const def = cleanDef(req.body?.def, req.staff!.name, 0);
    if (!def) return bad(reply, "Invalid process.");
    const issues = inputIssues(def);
    if (issues.length) return reply.code(422).send({ error: "The process has open issues.", issues });
    const samples: Record<string, { person: string; defects: Defect[]; source: "web" | "portal" }> = {
      unclear: { person: "paul", defects: ["unclear_income"], source: "portal" },
      incomplete: { person: "mira", defects: ["parent_unsigned", "host_missing"], source: "portal" },
      complete: { person: "lea", defects: [], source: "web" },
      internship: { person: "jonas", defects: ["contract_unsigned"], source: "portal" },
    };
    const sample = samples[req.body?.sample ?? "complete"] ?? samples.complete!;
    const scratch = new ScratchStore();
    const person = getPerson(sample.person, now());
    let a = newApplication(scratch, { student: person.student, stay: person.stay, language: "de", source: sample.source }, now());
    for (const d of sampleDocuments(person, sample.defects)) a = addDocument(scratch, a, { filename: d.filename, mimeType: "application/pdf", content: d.content }, "student", now());
    a = { ...a, status: "submitted", submittedAt: now().toISOString() };
    const ctx = engineCtx(scratch);
    a = await startRun(def, a, ctx);
    const decision = req.body?.decision;
    if (decision && a.flow?.waiting) {
      if (decision === "approved") a = { ...a, status: "approved", decision: { outcome: "approved", monthlyAmount: estimate(a, now()).monthly, note: "", decidedAt: now().toISOString(), decidedBy: "Test" } };
      if (decision === "rejected") a = { ...a, status: "rejected" };
      if (decision === "info") a = { ...a, status: "info_requested" };
      if (decision === "confirmed") a = { ...a, documents: a.documents.map((d) => ({ ...d, extraction: { ...d.extraction, needsReview: false } })) };
      a = await resumeRun(def, a, decision, ctx);
    }
    return { log: a.flow?.log ?? [], status: a.status, waiting: a.flow?.waiting ?? null, finished: a.flow?.finished ?? false, mails: a.outbox ?? [], integrations: a.integrations ?? [], team: a.assignedTeam ?? null };
  });

  // ---- Oversight: compare the same process across offices ------------------------------
  const ownOffice = (category: string): OfficeProcess | null => {
    const p = store.process(category)?.live;
    if (!p) return null;
    const list = store.list().filter((a) => a.status !== "draft");
    const insights = computeInsights(store.list(), now());
    const flows = list.filter((a) => a.flow);
    const rounds = list.length ? list.reduce((sum, a) => sum + a.history.filter((h) => h.kind === "info_requested").length, 0) / list.length : null;
    const states = store.ruleStates();
    const cfg = store.config();
    return {
      def: p,
      settings: { approvedRules: Object.entries(states).filter(([, st]) => st.status === "approved").map(([id]) => id), extractionDefault: cfg.defaultMethod, extractionByType: cfg.extraction, slaDays: cfg.slaDays, languages: cfg.languages },
      metrics: {
        medianDaysToDecision: insights.medianDaysToDecision,
        firstTimeComplete: insights.total ? insights.firstTimeComplete : null,
        reviewShare: flows.length ? Math.round((100 * flows.filter((a) => a.flow!.log.some((l) => l.kind === "review_fields")).length) / flows.length) : null,
        documentRounds: rounds === null ? null : Math.round(rounds * 10) / 10,
        casesPerMonth: Math.round((insights.perWeek.reduce((x, w) => x + w.count, 0) / 8) * 4.33),
      },
    };
  };

  app.get("/oversight/catalogue", async () => {
    const mine = Object.keys(store.processes());
    return {
      catalogue: PROCESS_CATALOG,
      coverage: catalogVariants().map((v) => ({
        id: v.id,
        offices: [...(mine.includes(v.id) && store.process(v.id)?.live ? [{ id: "musterstadt", name: store.config().name }] : []), ...PEER_OFFICES.filter((o) => o.processes[v.id]).map((o) => ({ id: o.id, name: o.name }))],
      })),
    };
  });

  app.get<{ Querystring: { category?: string } }>("/oversight/compare", async (req, reply) => {
    const category = req.query.category ?? DEFAULT_CATEGORY;
    if (!isCatalogVariant(category)) return notFound(reply);
    const reference = category === DEFAULT_CATEGORY ? { def: referenceProcess(), settings: REFERENCE_SETTINGS } : null;
    const offices = [
      ...(ownOffice(category) ? [{ id: "musterstadt", name: store.config().name, city: "Musterstadt", ...ownOffice(category)!, live: true }] : []),
      ...PEER_OFFICES.filter((o) => o.processes[category]).map((o) => ({ id: o.id, name: o.name, city: o.city, ...o.processes[category]!, live: false })),
    ];
    return {
      category,
      variant: catalogVariant(category),
      reference,
      offices: offices.map((o) => ({ ...o, harmony: reference ? harmony(o, reference) : null })),
    };
  });

  // ---- Demo reset (not linked from the UI) ----------------------------------
  app.post("/admin/reset", async () => {
    store.clear();
    seedDemoData(store, now());
    return { ok: true, cases: store.list().length };
  });

  return app;
}
