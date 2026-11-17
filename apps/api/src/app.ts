import { randomBytes } from "node:crypto";
import Fastify, { type FastifyReply } from "fastify";
import {
  DOCUMENT_KINDS,
  RULES,
  baselineFacts,
  describeCheck,
  estimate,
  runChecks,
  runRuleTests,
  type Application,
  type CaseStatus,
  type DocumentKind,
  type Lang,
  type ProcessDef,
  type StaffMember,
  type StayInfo,
  type StudentInfo,
  validateProcess,
} from "@digieurope/shared";
import { resumeRun, startRun } from "./engine.js";
import { Store as ScratchStore } from "./store.js";
import { askLive, liveAvailable, retrieve } from "./assistant.js";
import { PARENT_KINDS, addDocument, checkNow, invite, newApplication, officeAct, open, removeDocument, submit, view, type OfficeAction } from "./cases.js";
import { DOC_SPECS, extractDocument } from "./documents.js";
import { computeInsights } from "./metrics.js";
import { SAMPLE_SETS, fixDocuments, getPerson, sampleDocuments, sampleLetter, type Defect } from "./samples.js";
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
    url.startsWith("/office/processes") || (method !== "GET" && (url.startsWith("/office/inputs") || url.startsWith("/office/config") || /^\/office\/rules\/[^/]+\/(approve|revoke)/.test(url)));
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0]!;
    const token = req.headers["x-staff-token"];
    req.staff = store.staffBySession(typeof token === "string" ? token : undefined) ?? null;
    const protectedRoute = url.startsWith("/office") || url === "/staff/me" || url === "/staff/logout";
    if (!protectedRoute) return;
    if (!req.staff) return reply.code(401).send({ error: "Please sign in as staff." });
    if (url.startsWith("/office/staff") && !req.staff.isAdmin) return reply.code(403).send({ error: "Only administrators can do this." });
    if (needsBuild(req.method, url) && !req.staff.canBuild && !req.staff.isAdmin) return reply.code(403).send({ error: "You do not have access to the process builder." });
  });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "Not found" });
  const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });
  const v = (a: Application) => view(store, a, webUrl, now());
  /** Hands a submitted application to the live process of the office. */
  const runLive = (a: Application) => store.put(startRun(store.processes().live, a, { rules: store.ruleStates(), now: now() }));

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
    return reply.code(201).send(v(addDocument(store, a, r.file!, "student", now())));
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
    if (!runChecks(a, store.ruleStates(), now()).ready) return bad(reply, "There are still items to fix.", 409);
    return v(runLive(submit(store, a, now())));
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
    const detected = extractDocument(r.file!.content, r.file!.mimeType).kind;
    if (detected !== "unknown" && !PARENT_KINDS.includes(detected)) return bad(reply, "This looks like a document for the student, not for the parents.");
    return reply.code(201).send(parentView(addDocument(store, a, r.file!, "parent", now())));
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
    const { kind, extraction } = extractDocument(r.file!.content, r.file!.mimeType);
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
    const r = runChecks(a, store.ruleStates(), now());
    return {
      id: a.id, reference: a.reference, name: `${a.student.lastName}, ${a.student.firstName}`, country: a.stay.country, stayType: a.stay.type, status: a.status,
      source: a.source, submittedAt: a.submittedAt ?? null, updatedAt: a.updatedAt, blockers: r.blockers, warnings: r.warnings, estimateMonthly: estimate(a, now()).monthly,
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
    if (action === "request_info") {
      if (!message?.trim()) return bad(reply, "Please write what is missing.");
    } else if (action === "approve") {
      if (!runChecks(a, store.ruleStates(), now()).ready) return bad(reply, "There are open blocking items. Request information first.", 409);
      if (typeof amount !== "number" || amount < 0 || amount > 5000) return bad(reply, "Please enter the monthly amount.");
    } else if (action === "reject") {
      if (!message?.trim()) return bad(reply, "Please give a reason.");
    } else return bad(reply, "Unknown action.");
    const acted = officeAct(store, a, action, { message, amount, by: req.staff?.name ?? "Sachbearbeitung" }, now());
    const outcome = action === "approve" ? "approved" : action === "reject" ? "rejected" : "info";
    return v(store.put(resumeRun(store.processes().live, acted, outcome, { rules: store.ruleStates(), now: now() })));
  });

  app.post("/office/portal/deliver", async (_req, reply) => reply.code(201).send(summary(runLive(deliverFromPortal(store, now())))));

  app.get("/office/insights", async () => computeInsights(store.list(), now()));

  app.get("/office/rules", async () => {
    const states = store.ruleStates();
    return RULES.map((rule) => ({
      rule,
      state: states[rule.id] ?? { status: "draft" },
      compiled: { when: rule.when ? describeCheck(rule.when) : null, pass: describeCheck(rule.pass) },
      tests: runRuleTests(rule, baselineFacts() as unknown as Record<string, unknown>),
    }));
  });

  app.post<{ Params: { id: string }; Body: { by?: string } }>("/office/rules/:id/approve", async (req, reply) => {
    const rule = RULES.find((r) => r.id === req.params.id);
    if (!rule) return notFound(reply);
    if (runRuleTests(rule, baselineFacts() as unknown as Record<string, unknown>).some((t) => !t.ok)) return bad(reply, "Not all sample cases pass. The rule cannot be approved.", 409);
    store.setRuleState(rule.id, { status: "approved", approvedBy: req.body?.by?.trim() || "Fachbereich Ausland (Demo)", approvedAt: now().toISOString() });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/office/rules/:id/revoke", async (req, reply) => {
    if (!RULES.some((r) => r.id === req.params.id)) return notFound(reply);
    store.setRuleState(req.params.id, { status: "draft" });
    return { ok: true };
  });

  app.get("/office/config", async () => ({ config: store.config(), documentTypes: DOC_SPECS.map((s) => ({ kind: s.kind, title: s.title, fields: s.fields.map(([key, label]) => ({ key, label })), signatures: s.sigs.map(([key, label]) => ({ key, label })) })) }));

  app.put<{ Body: { slaDays?: number; languages?: Lang[] } }>("/office/config", async (req) => {
    const c = store.config();
    store.setConfig({ ...c, slaDays: Math.min(60, Math.max(1, Number(req.body?.slaDays) || c.slaDays)), languages: req.body?.languages?.length ? req.body.languages : c.languages });
    return store.config();
  });

  app.post<{ Body: { filename?: string; mimeType?: string; dataBase64?: string } }>("/office/inputs/extract", async (req, reply) => {
    const r = readFile(req.body);
    if ("error" in r) return bad(reply, r.error!);
    const { kind, extraction } = extractDocument(r.file!.content, r.file!.mimeType);
    return { kind, extraction };
  });

  app.post<{ Body: { kind?: DocumentKind; fields?: string[] } }>("/office/inputs/confirm", async (req, reply) => {
    const { kind, fields } = req.body ?? {};
    if (!kind || !DOCUMENT_KINDS.includes(kind) || !Array.isArray(fields)) return bad(reply, "Missing document type or fields.");
    const c = store.config();
    store.setConfig({ ...c, expectedInputs: { ...c.expectedInputs, [kind]: { fields, confirmedAt: now().toISOString() } } });
    return store.config();
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
      const item = (d: { kind: string; filename: string }) => ({ name: d.filename, audience: PARENT_KINDS.includes(d.kind as DocumentKind) ? "parents" : "student" });
      return { id: s.id, title: s.title, note: s.note, docs: f.docs.map(item), fixes: f.fixes.map(item) };
    }),
    letter: sampleLetter(getPerson("noah", now())).filename,
  }));

  app.get<{ Params: { set: string; folder: string; name: string } }>("/samples/files/:set/:folder/:name", async (req, reply) => {
    let file: { filename: string; content: Buffer } | undefined;
    if (req.params.set === "letter") file = sampleLetter(getPerson("noah", now()));
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
  app.put<{ Params: { id: string }; Body: { canBuild?: boolean } }>("/office/staff/:id", async (req, reply) => {
    const m = store.staff().find((x) => x.id === req.params.id);
    if (!m) return notFound(reply);
    if (m.isAdmin) return bad(reply, "Administrators always have access.", 409);
    store.setStaff(m.id, { canBuild: Boolean(req.body?.canBuild) });
    return store.staff();
  });

  // ---- Process builder ------------------------------------------------------------
  const cleanDef = (def: ProcessDef | undefined, by: string, version: number): ProcessDef | null => {
    if (!def || !Array.isArray(def.nodes) || !Array.isArray(def.edges) || def.nodes.length > 80 || def.edges.length > 200) return null;
    return {
      id: store.processes().live.id,
      name: String(def.name ?? "Process").slice(0, 120),
      version,
      updatedAt: now().toISOString(),
      updatedBy: by,
      nodes: def.nodes.map((n) => ({ id: String(n.id), kind: n.kind, position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 }, config: n.config ?? {} })),
      edges: def.edges.map((e) => ({ id: String(e.id), source: String(e.source), sourceHandle: String(e.sourceHandle), target: String(e.target) })),
    };
  };

  app.get("/office/processes", async () => {
    const p = store.processes();
    return { live: p.live, draft: p.draft ?? null, history: p.history.map(({ version, updatedAt, updatedBy, name }) => ({ version, updatedAt, updatedBy, name })) };
  });

  app.put<{ Body: { def?: ProcessDef } }>("/office/processes/draft", async (req, reply) => {
    const def = cleanDef(req.body?.def, req.staff!.name, store.processes().live.version + 1);
    if (!def) return bad(reply, "This process cannot be saved.");
    store.setProcesses({ ...store.processes(), draft: def });
    return def;
  });

  app.post<{ Body: { def?: ProcessDef } }>("/office/processes/validate", async (req, reply) => {
    const def = cleanDef(req.body?.def, req.staff!.name, 0);
    return def ? { issues: validateProcess(def) } : bad(reply, "Invalid process.");
  });

  app.post<{ Body: { def?: ProcessDef } }>("/office/processes/publish", async (req, reply) => {
    const p = store.processes();
    const def = cleanDef(req.body?.def, req.staff!.name, p.live.version + 1);
    if (!def) return bad(reply, "Invalid process.");
    const issues = validateProcess(def);
    if (issues.length) return reply.code(422).send({ error: "The process has open issues.", issues });
    store.setProcesses({ live: def, draft: undefined, history: [...p.history, p.live] });
    return def;
  });

  app.post<{ Body: { version?: number } }>("/office/processes/restore", async (req, reply) => {
    const p = store.processes();
    const old = p.history.find((h) => h.version === req.body?.version);
    if (!old) return notFound(reply);
    store.setProcesses({ ...p, draft: { ...old, version: p.live.version + 1, updatedAt: now().toISOString(), updatedBy: req.staff!.name } });
    return store.processes().draft;
  });

  /** Runs a process on a sample case in a scratch store. Nothing real is touched. */
  app.post<{ Body: { def?: ProcessDef; sample?: string; decision?: "approved" | "rejected" | "info" } }>("/office/processes/test", async (req, reply) => {
    const def = cleanDef(req.body?.def, req.staff!.name, 0);
    if (!def) return bad(reply, "Invalid process.");
    const issues = validateProcess(def);
    if (issues.length) return reply.code(422).send({ error: "The process has open issues.", issues });
    const samples: Record<string, { person: string; defects: Defect[]; source: "web" | "portal" }> = {
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
    const ctx = { rules: store.ruleStates(), now: now() };
    a = startRun(def, a, ctx);
    const decision = req.body?.decision;
    if (decision && a.flow?.waiting) {
      if (decision === "approved") a = { ...a, status: "approved", decision: { outcome: "approved", monthlyAmount: estimate(a, now()).monthly, note: "", decidedAt: now().toISOString(), decidedBy: "Test" } };
      if (decision === "rejected") a = { ...a, status: "rejected" };
      if (decision === "info") a = { ...a, status: "info_requested" };
      a = resumeRun(def, a, decision, ctx);
    }
    return { log: a.flow?.log ?? [], status: a.status, waiting: a.flow?.waiting ?? null, finished: a.flow?.finished ?? false, mails: a.outbox ?? [], integrations: a.integrations ?? [], team: a.assignedTeam ?? null };
  });

  // ---- Demo reset (not linked from the UI) ----------------------------------
  app.post("/admin/reset", async () => {
    store.clear();
    seedDemoData(store, now());
    return { ok: true, cases: store.list().length };
  });

  return app;
}
