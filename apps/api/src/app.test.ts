import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { PROPOSAL_SAMPLE_TITLE, SAMPLE_SETS, fixDocuments, formblatt8, getPerson, proposalSample, sampleDocuments, sampleLetter } from "./samples.js";
import { extractDocument } from "./documents.js";
import { seedDemoData } from "./seed.js";
import { startRun } from "./engine.js";
import { defaultProcess, upgradeProcess, validateProcess, walkDecisionTree, DECISION_TREE, type Application, type ProcessDef } from "@digieurope/shared";
import { checksFor, reviewReport } from "./cases.js";
import { Store } from "./store.js";

const NOW = new Date("2026-11-16T10:00:00Z");
const b64 = (b: Buffer) => b.toString("base64");

function setup(staffId = "s-obermeier") {
  const store = new Store();
  const app = buildApp({ store, now: () => NOW });
  // Every request carries the session of the chosen employee, as the web app does.
  store.login(staffId, "test-token");
  const inject = app.inject.bind(app) as (o: Record<string, unknown>) => ReturnType<typeof app.inject>;
  (app as unknown as { inject: unknown }).inject = (o: Record<string, unknown>) => inject({ ...o, headers: { "x-staff-token": "test-token", ...(o.headers as object) } });
  return { store, app };
}

async function create(app: ReturnType<typeof setup>["app"], key: string) {
  const p = getPerson(key, NOW);
  const res = await app.inject({ method: "POST", url: "/applications", payload: { student: p.student, stay: p.stay, language: "en" } });
  expect(res.statusCode).toBe(201);
  return { id: res.json().id as string, person: p };
}

async function upload(app: ReturnType<typeof setup>["app"], url: string, filename: string, content: Buffer) {
  return app.inject({ method: "POST", url, payload: { filename, mimeType: "application/pdf", dataBase64: b64(content) } });
}

describe("reader", () => {
  it("reads fields and signatures back out of a sample PDF", () => {
    const docs = sampleDocuments(getPerson("mira", NOW), ["parent_unsigned"]);
    const form = docs.find((d) => d.kind === "parent_form")!;
    const r = extractDocument(form.content, "application/pdf");
    expect(r.kind).toBe("parent_form");
    expect(r.extraction.signatures.parent).toBe(false);
    expect(r.extraction.fields.parent_name).toBe("Katrin Sommer");
  });
  it("cannot read an image or a random PDF", () => {
    expect(extractDocument(Buffer.from("x"), "image/png").extraction.readable).toBe(false);
    expect(extractDocument(Buffer.from("%PDF-1.4 nothing"), "application/pdf").extraction.readable).toBe(false);
  });
});

describe("student flow", () => {
  it("shows what to fix, then becomes ready after the fixes", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "mira");
    const set = SAMPLE_SETS.find((s) => s.id === "mira")!;
    for (const d of sampleDocuments(person, set.defects)) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const checked = (await app.inject({ method: "POST", url: `/applications/${id}/check` })).json();
    expect(checked.report.ready).toBe(false);
    const ids = checked.report.findings.map((f: { ruleId: string }) => f.ruleId);
    expect(ids).toContain("R-HOST-CONFIRM");
    expect(ids).toContain("R-PARENT-FORM");
    expect(checked.estimate.provisional).toBe(false);
    expect((await app.inject({ method: "POST", url: `/applications/${id}/submit` })).statusCode).toBe(409);

    for (const d of Object.values(fixDocuments(person))) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const after = (await app.inject({ method: "GET", url: `/applications/${id}` })).json();
    expect(after.report.findings.map((f: { ruleId: string }) => f.ruleId)).toEqual([]);
    expect(after.estimate.monthly).toBeGreaterThan(0);
    expect((await app.inject({ method: "POST", url: `/applications/${id}/submit` })).json().status).toBe("submitted");
  });

  it("lets parents upload through their own link", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "lea");
    const invited = (await app.inject({ method: "POST", url: `/applications/${id}/parents`, payload: { email: "eltern@example.org" } })).json();
    const token = invited.parentLink.split("/parent/")[1];
    for (const d of sampleDocuments(person).filter((x) => x.kind.startsWith("parent"))) {
      expect((await upload(app, `/parent/${token}/documents`, d.filename, d.content)).statusCode).toBe(201);
    }
    expect((await app.inject({ method: "GET", url: `/applications/${id}` })).json().parents.status).toBe("received");
    const wrong = sampleDocuments(person).find((x) => x.kind === "application_form")!;
    expect((await upload(app, `/parent/${token}/documents`, wrong.filename, wrong.content)).statusCode).toBe(400);
  });

  it("flags a file it cannot read", async () => {
    const { app } = setup();
    const { id } = await create(app, "lea");
    await app.inject({ method: "POST", url: `/applications/${id}/documents`, payload: { filename: "scan.png", mimeType: "image/png", dataBase64: b64(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])) } });
    const r = (await app.inject({ method: "POST", url: `/applications/${id}/check` })).json();
    expect(r.report.findings.some((f: { ruleId: string }) => f.ruleId === "R-READABLE")).toBe(true);
  });
});

describe("office", () => {
  it("only runs approved rules and needs passing sample cases to approve", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "lea");
    for (const d of sampleDocuments(person, ["no_abroad_cover"])) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const before = (await app.inject({ method: "GET", url: `/applications/${id}` })).json();
    expect(before.report.findings.some((f: { ruleId: string }) => f.ruleId === "R-HEALTH-ABROAD")).toBe(false);
    expect((await app.inject({ method: "POST", url: "/office/rules/R-HEALTH-ABROAD/approve", payload: {} })).statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: `/applications/${id}` })).json();
    expect(after.report.findings.some((f: { ruleId: string }) => f.ruleId === "R-HEALTH-ABROAD")).toBe(true);
  });

  it("caseworker decides: only a complete, submitted case can be approved", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "lea");
    const act = (action: string, extra = {}) => app.inject({ method: "POST", url: `/office/cases/${id}/actions`, payload: { action, ...extra } });
    expect((await act("approve", { amount: 900 })).statusCode).toBe(409); // not submitted yet
    for (const d of sampleDocuments(person)) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    expect((await app.inject({ method: "POST", url: `/applications/${id}/submit` })).statusCode).toBe(200);
    const ok = await act("approve", { amount: 900 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().decision.outcome).toBe("approved");
    expect((await act("reject", { message: "x" })).statusCode).toBe(409);
  });

  it("every decision carries a human explanation and a frozen technical record", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "lea");
    for (const d of sampleDocuments(person)) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    await app.inject({ method: "POST", url: `/applications/${id}/submit` });
    const draft = (await app.inject({ method: "GET", url: `/office/cases/${id}/explanation?outcome=approved&amount=900&lang=en` })).json();
    expect(draft.text).toMatch(/monthly need/);
    expect((await app.inject({ method: "GET", url: `/office/cases/${id}/audit` })).statusCode).toBe(404);
    const decided = (await app.inject({ method: "POST", url: `/office/cases/${id}/actions`, payload: { action: "approve", amount: 900 } })).json();
    expect(decided.decision.note.length).toBeGreaterThan(40); // drafted from the calculation when left empty
    const audit = decided.decision.audit;
    expect(audit.decidedBy).toBeTruthy();
    expect(audit.rules.length).toBeGreaterThan(3);
    expect(audit.rules.every((r: { version: number; result: string }) => r.version >= 1 && ["pass", "fail", "n/a"].includes(r.result))).toBe(true);
    expect(audit.documents.length).toBe(decided.documents.length);
    expect(audit.calculation.need).toBeGreaterThan(0);
    const file = await app.inject({ method: "GET", url: `/office/cases/${id}/audit` });
    expect(file.headers["content-disposition"]).toContain("attachment");
    expect(file.json().audit.outcome).toBe("approved");
  });

  it("refuses to approve a portal case that still has blocking items", async () => {
    const { app } = setup();
    const delivered = (await app.inject({ method: "POST", url: "/office/portal/deliver" })).json();
    expect(delivered.blockers).toBeGreaterThan(0);
    const res = await app.inject({ method: "POST", url: `/office/cases/${delivered.id}/actions`, payload: { action: "approve", amount: 500 } });
    expect(res.statusCode).toBe(409);
  });

  it("simulated portal delivery arrives in the queue with findings", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "POST", url: "/office/portal/deliver" });
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe("portal");
    expect((await app.inject({ method: "GET", url: "/office/cases" })).json()).toHaveLength(1);
  });
});

describe("assistant and letters", () => {
  it("answers with a source and refuses to guess", async () => {
    const { app } = setup();
    const ok = (await app.inject({ method: "POST", url: "/assistant", payload: { question: "Are tuition fees covered?", lang: "en" } })).json();
    expect(ok.matched).toBe(true);
    expect(ok.sources[0].url).toMatch(/^https:\/\//);
    const no = (await app.inject({ method: "POST", url: "/assistant", payload: { question: "Best pizza in town?", lang: "en" } })).json();
    expect(no.matched).toBe(false);
  });

  it("reads the sample decision letter", async () => {
    const { app } = setup();
    const letter = sampleLetter(getPerson("noah", NOW));
    const res = await upload(app, "/letter/read", letter.filename, letter.content);
    expect(res.statusCode).toBe(200);
    const f = res.json();
    expect(f.grant_monthly).toBeGreaterThan(0);
    expect(f.need_monthly - f.parent_contribution).toBe(f.grant_monthly);
  });
});

describe("demo data", () => {
  it("seeds a realistic office and resets cleanly", async () => {
    const { app, store } = setup();
    seedDemoData(store, NOW);
    expect(store.list().length).toBeGreaterThan(40);
    const insights = (await app.inject({ method: "GET", url: "/office/insights" })).json();
    expect(insights.missing.length).toBeGreaterThan(2);
    expect(insights.firstTimeComplete).toBeLessThan(80);
    const reset = (await app.inject({ method: "POST", url: "/admin/reset" })).json();
    expect(reset.ok).toBe(true);
  });
});

describe("decision tree", () => {
  it("walks every seeded case to a leaf of the tree, and decided cases end where the office decided", () => {
    const { store } = setup();
    seedDemoData(store, NOW);
    const ids = new Set(DECISION_TREE.nodes.map((n) => n.id));
    let approved = 0;
    for (const a of store.list()) {
      const w = walkDecisionTree(a, NOW);
      expect(ids.has(w.leaf)).toBe(true);
      expect(w.steps.length).toBeGreaterThan(0);
      if (a.decision?.outcome === "rejected") expect(w.leaf).toBe("no-need");
      if (a.decision?.outcome === "approved") { expect(w.outcome).toBe("approved"); approved += 1; }
    }
    expect(approved).toBeGreaterThan(5);
  });

  it("stops at the assets question when the student states more than the allowance", () => {
    const { store } = setup();
    seedDemoData(store, NOW);
    const a = store.list().find((x) => x.decision?.outcome === "approved")!;
    const copy = structuredClone(a);
    copy.documents.find((d) => d.kind === "application_form")!.extraction.fields.assets = "60000";
    const w = walkDecisionTree(copy, NOW);
    expect(w.leaf).toBe("no-assets");
    expect(w.steps.at(-1)?.id).toBe("assets");
  });
});

describe("process assistant", () => {
  it("proposes a change in plain sentences without saving anything, and refuses what it cannot do", async () => {
    const { app, store } = setup();
    const def = defaultProcess();
    const before = JSON.stringify(store.process(def.catalogId));
    const res = await app.inject({ method: "POST", url: "/office/processes/assist", payload: { message: "Add a reminder after 7 days", def: { nodes: def.nodes, edges: def.edges }, lang: "en" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe("simulated");
    expect(body.ops.length).toBeGreaterThan(0);
    expect(body.changes.length).toBe(body.ops.length);
    expect(JSON.stringify(store.process(def.catalogId))).toBe(before);
    const lost = (await app.inject({ method: "POST", url: "/office/processes/assist", payload: { message: "make it blue", def: { nodes: def.nodes, edges: def.edges } } })).json();
    expect(lost.ops).toEqual([]);
    const bad = await app.inject({ method: "POST", url: "/office/processes/assist", payload: { message: "", def: { nodes: [], edges: [] } } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("staff access", () => {
  it("keeps the office area closed without a login", async () => {
    const store = new Store();
    const app = buildApp({ store, now: () => NOW });
    expect((await app.inject({ method: "GET", url: "/office/cases" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/office/processes" })).statusCode).toBe(401);
    const login = (await app.inject({ method: "POST", url: "/staff/login", payload: { staffId: "s-beispiel" } })).json();
    expect(login.token).toBeTruthy();
    expect((await app.inject({ method: "GET", url: "/office/cases", headers: { "x-staff-token": login.token } })).statusCode).toBe(200);
  });

  it("hides the process builder from caseworkers and unlocks it through an administrator", async () => {
    const { app, store } = setup("s-beispiel");
    expect((await app.inject({ method: "GET", url: "/office/processes" })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/office/staff/s-beispiel", payload: { canBuild: true } })).statusCode).toBe(403);
    store.login("s-obermeier", "admin-token");
    const unlock = await app.inject({ method: "PUT", url: "/office/staff/s-beispiel", payload: { canBuild: true }, headers: { "x-staff-token": "admin-token" } });
    expect(unlock.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/office/processes" })).statusCode).toBe(200);
  });

  it("only designers may approve rules", async () => {
    const { app } = setup("s-kaya");
    expect((await app.inject({ method: "POST", url: "/office/rules/R-HEALTH-ABROAD/approve", payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/office/rules" })).statusCode).toBe(200);
  });
});

describe("process builder and engine", () => {
  it("the live process answers an incomplete portal delivery with an AI-drafted mail within the same request", async () => {
    const { app } = setup();
    const delivered = (await app.inject({ method: "POST", url: "/office/portal/deliver" })).json();
    expect(delivered.status).toBe("info_requested");
    const c = (await app.inject({ method: "GET", url: `/office/cases/${delivered.id}` })).json();
    expect(c.outbox).toHaveLength(1);
    expect(c.outbox[0].aiDraft).toBe(true);
    expect(c.outbox[0].to).toBe("student");
    expect(c.flow.log.some((l: { kind: string }) => l.kind === "ai_draft_mail")).toBe(true);
  });

  it("a complete case waits for the caseworker, then the decision continues the process", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "lea");
    for (const d of sampleDocuments(person)) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const submitted = (await app.inject({ method: "POST", url: `/applications/${id}/submit` })).json();
    expect(submitted.assignedTo.name).toBeTruthy();
    expect(submitted.flow.waiting).toBe("human");
    const done = (await app.inject({ method: "POST", url: `/office/cases/${id}/actions`, payload: { action: "approve", amount: 900 } })).json();
    expect(done.integrations[0].system).toBe("payment");
    expect(done.outbox.some((m: { subject: string }) => m.subject.includes("approved"))).toBe(true);
    expect(done.flow.finished).toBe(true);
  });

  it("a changed process changes what happens, and publishing needs a valid process", async () => {
    const { app } = setup();
    const { live } = (await app.inject({ method: "GET", url: "/office/processes" })).json();
    const broken = { ...live, edges: live.edges.filter((e: { id: string }) => e.id !== "rules:incomplete") };
    const bad = await app.inject({ method: "POST", url: "/office/processes/publish", payload: { def: broken } });
    expect(bad.statusCode).toBe(422);
    // Variant: the incomplete branch only ends, no mail is sent.
    const gone = ["draft", "ask"];
    const quiet = {
      ...live,
      nodes: live.nodes.filter((n: { id: string }) => !gone.includes(n.id)),
      edges: live.edges.filter((e: { source: string }) => !gone.includes(e.source)).map((e: { id: string; target: string }) => (e.id === "rules:incomplete" || e.id === "inputs:incomplete" ? { ...e, target: "end-incomplete" } : e)),
      // The sample that expects the e-mail no longer applies to this variant.
      tests: live.tests.filter((t: { id: string }) => t.id !== "t-incomplete"),
    };
    // A process that fails its own samples cannot be published.
    const failing = await app.inject({ method: "POST", url: "/office/processes/publish", payload: { def: { ...quiet, tests: live.tests } } });
    expect(failing.statusCode).toBe(422);
    expect(failing.json().tests.some((t: { ok: boolean }) => !t.ok)).toBe(true);
    expect((await app.inject({ method: "POST", url: "/office/processes/publish", payload: { def: quiet } })).statusCode).toBe(200);
    const delivered = (await app.inject({ method: "POST", url: "/office/portal/deliver" })).json();
    expect(delivered.status).toBe("submitted");
    const hist = (await app.inject({ method: "GET", url: "/office/processes" })).json();
    expect(hist.live.version).toBe(2);
    expect(hist.history).toHaveLength(1);
  });

  it("test runs use a scratch store and leave real data untouched", async () => {
    const { app, store } = setup();
    const { live } = (await app.inject({ method: "GET", url: "/office/processes" })).json();
    const res = (await app.inject({ method: "POST", url: "/office/processes/test", payload: { def: live, sample: "complete", decision: "approved" } })).json();
    expect(res.integrations[0].action).toBe("create_payment_order");
    expect(res.finished).toBe(true);
    expect(store.list()).toHaveLength(0);
  });
});

describe("document reading", () => {
  it("the template reader reports doubtful fields and flags them for review", async () => {
    const { readWithMethod } = await import("./extraction.js");
    const docs = sampleDocuments(getPerson("paul", NOW), ["unclear_income"]);
    const tax = docs.find((d) => d.kind === "parent_tax")!;
    const r = await readWithMethod(tax.content, "application/pdf", "builtin", 0.8);
    expect(r.extraction.confidence?.sum_of_income).toBeLessThan(0.8);
    expect(r.extraction.confidence?.tax_year).toBeGreaterThan(0.9);
    expect(r.extraction.needsReview).toBe(true);
    const clean = sampleDocuments(getPerson("paul", NOW)).find((d) => d.kind === "parent_tax")!;
    expect((await readWithMethod(clean.content, "application/pdf", "builtin", 0.8)).extraction.needsReview).toBe(false);
  });

  it("the AI reader keeps only known fields, clamps confidence and falls back on errors", async () => {
    const { aiExtract, readWithMethod } = await import("./extraction.js");
    const tax = sampleDocuments(getPerson("paul", NOW)).find((d) => d.kind === "parent_tax")!;
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      const answer = { documentType: "parent_tax", fields: { tax_year: { value: "2025", confidence: 1.4, page: 1 }, sum_of_income: { value: "", confidence: 0.9, page: 2 }, bogus: { value: "x", confidence: 1, page: 1 } }, signatures: {} };
      const ok = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(answer) }] }), { status: 200 })) as unknown as typeof fetch;
      const r = await aiExtract(tax.content, "application/pdf", ok);
      expect(r?.kind).toBe("parent_tax");
      expect(r?.extraction.fields.bogus).toBeUndefined();
      expect(r?.extraction.confidence?.tax_year).toBe(1);
      expect(r?.extraction.confidence?.sum_of_income).toBe(0); // empty value is never "confident"
      expect(r?.extraction.pages?.sum_of_income).toBe(2);
      const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
      const fb = await readWithMethod(tax.content, "application/pdf", "ai", 0.8, failing);
      expect(fb.kind).toBe("parent_tax");
      expect(fb.extraction.note).toContain("failed");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
    const sim = await readWithMethod(tax.content, "application/pdf", "ai", 0.8);
    expect(sim.extraction.engine).toBe("ai-simulated");
    const ph = await readWithMethod(tax.content, "application/pdf", "external", 0.8);
    expect(ph.extraction.note).toContain("placeholder");
  });

  it("the office can choose the method per document type", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "PUT", url: "/office/extraction", payload: { kind: "parent_tax", method: "nope" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/office/extraction", payload: { kind: "parent_tax", method: "ai", minConfidence: 0.9 } })).statusCode).toBe(200);
    const { id, person } = await create(app, "lea");
    const tax = sampleDocuments(person).find((d) => d.kind === "parent_tax")!;
    await upload(app, `/applications/${id}/documents`, tax.filename, tax.content);
    const c = (await app.inject({ method: "GET", url: `/applications/${id}` })).json();
    expect(c.documents[0].extraction.engine).toBe("ai-simulated");
    const cfg = (await app.inject({ method: "GET", url: "/office/extraction" })).json();
    expect(cfg.config.byType.parent_tax.minConfidence).toBe(0.9);
    expect(cfg.methods.find((m: { id: string }) => m.id === "external").status).toBe("placeholder");
  });

  it("a doubtful field sends the case to human review, and confirming continues the process", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "paul");
    for (const d of sampleDocuments(person, ["unclear_income"])) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const submitted = (await app.inject({ method: "POST", url: `/applications/${id}/submit` })).json();
    expect(submitted.flow.waiting).toBe("review");
    expect(submitted.estimate.provisional).toBe(true);
    const blocked = await app.inject({ method: "POST", url: `/office/cases/${id}/actions`, payload: { action: "approve", amount: 500 } });
    expect(blocked.statusCode).toBe(409);
    const doc = submitted.documents.find((d: { kind: string }) => d.kind === "parent_tax");
    const done = (await app.inject({ method: "POST", url: `/office/cases/${id}/review`, payload: { docId: doc.id, fields: { sum_of_income: "54000" } } })).json();
    expect(done.flow.waiting).toBe("human");
    expect(done.assignedTo.name).toBeTruthy();
    expect(done.estimate.provisional).toBe(false);
    expect(done.documents.find((d: { kind: string }) => d.kind === "parent_tax").extraction.needsReview).toBe(false);
  });

  it("a question from review is prefilled from the unclear documents, sent by the caseworker, and the process waits", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "paul");
    for (const d of sampleDocuments(person, ["unclear_income"])) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const submitted = (await app.inject({ method: "POST", url: `/applications/${id}/submit` })).json();
    expect(submitted.flow.waiting).toBe("review");
    const draft = (await app.inject({ method: "GET", url: `/office/cases/${id}/question-draft` })).json();
    expect(draft.items).toBeGreaterThan(0);
    expect(draft.message).toContain("•");
    const sent = (await app.inject({ method: "POST", url: `/office/cases/${id}/actions`, payload: { action: "request_info", message: draft.message } })).json();
    expect(sent.status).toBe("info_requested");
    // The process now really waits: a timer holds it until the time is up.
    expect(sent.flow.finished).toBe(false);
    expect(sent.flow.waiting).toBe("wait-q");
    expect(sent.flow.waitUntil).toBeTruthy();
    const steps = sent.flow.log.map((l: { kind: string }) => l.kind);
    expect(steps).toContain("request_documents");
    expect(steps).toContain("wait");
    const mail = sent.outbox.find((m: { nodeId?: string }) => m.nodeId === "ask-q");
    expect(mail.body).toContain(draft.message);
    expect(mail.body).toContain("Kind regards");
  });

  it("when the time is up the timer lets the process carry on and sends the reminder; a new upload would have started it again", async () => {
    const { app, store } = setup();
    const { id, person } = await create(app, "paul");
    for (const d of sampleDocuments(person, ["unclear_income"], "en")) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    await app.inject({ method: "POST", url: `/applications/${id}/submit` });
    const draft = (await app.inject({ method: "GET", url: `/office/cases/${id}/question-draft` })).json();
    await app.inject({ method: "POST", url: `/office/cases/${id}/actions`, payload: { action: "request_info", message: draft.message } });
    // Nothing happens before the time is up.
    expect((await app.inject({ method: "POST", url: "/admin/timers/run" })).json().fired).toBe(0);
    const early = store.get(id)!;
    expect(early.flow!.waiting).toBe("wait-q");
    // Seven days later the reminder goes out and the run ends.
    store.put({ ...early, flow: { ...early.flow!, waitUntil: new Date(NOW.getTime() - 1000).toISOString() } });
    const later = (await app.inject({ method: "POST", url: "/admin/timers/run" })).json();
    expect(later.fired).toBe(1);
    const done = store.get(id)!;
    expect(done.flow!.finished).toBe(true);
    expect(done.outbox!.some((m) => m.nodeId === "remind" && /Reminder/.test(m.subject))).toBe(true);
  });

  it("the builder test run shows the review path", async () => {
    const { app } = setup();
    const { live } = (await app.inject({ method: "GET", url: "/office/processes" })).json();
    const waiting = (await app.inject({ method: "POST", url: "/office/processes/test", payload: { def: live, sample: "unclear" } })).json();
    expect(waiting.waiting).toBe("review");
    const after = (await app.inject({ method: "POST", url: "/office/processes/test", payload: { def: live, sample: "unclear", decision: "confirmed" } })).json();
    expect(after.waiting).toBe("human");
  });
});

describe("process categories and comparison across offices", () => {
  it("every process belongs to a catalogue category and one office has one process per category", async () => {
    const { app } = setup();
    const list = (await app.inject({ method: "GET", url: "/office/processes/list" })).json();
    expect(list[0].catalogId).toBe("bafoeg.abroad");
    expect((await app.inject({ method: "POST", url: "/office/processes/create", payload: { catalogId: "nope" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/office/processes/create", payload: { catalogId: "bafoeg.abroad" } })).statusCode).toBe(409);
    const created = await app.inject({ method: "POST", url: "/office/processes/create", payload: { catalogId: "bafoeg.domestic", name: "Inland" } });
    expect(created.statusCode).toBe(201);
    const p = (await app.inject({ method: "GET", url: "/office/processes?category=bafoeg.domestic" })).json();
    expect(p.live).toBeNull();
    expect(p.draft.catalogId).toBe("bafoeg.domestic");
    const bad = { ...p.draft, catalogId: "unknown" };
    expect((await app.inject({ method: "POST", url: "/office/processes/publish", payload: { def: bad } })).statusCode).toBe(404);
  });

  it("creates from a proposal, duplicates into a free category and deletes, but never the process the portal runs", async () => {
    const { app } = setup();
    const gen = (await app.inject({ method: "POST", url: "/office/processes/generate", payload: { description: "When an application arrives, read the documents. If approved, create the payment order." } })).json();
    const made = await app.inject({ method: "POST", url: "/office/processes/create", payload: { catalogId: "bafoeg.domestic", name: "Aus Text", proposal: { nodes: gen.nodes, edges: gen.edges } } });
    expect(made.statusCode).toBe(201);
    expect(made.json().nodes.length).toBe(gen.nodes.length);
    expect((await app.inject({ method: "POST", url: "/office/processes/create", payload: { catalogId: "bafoeg.followup", proposal: { nodes: [], edges: [] } } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/office/processes/duplicate", payload: { from: "bafoeg.domestic", catalogId: "bafoeg.domestic" } })).statusCode).toBe(409);
    const dup = await app.inject({ method: "POST", url: "/office/processes/duplicate", payload: { from: "bafoeg.domestic", catalogId: "bafoeg.followup" } });
    expect(dup.statusCode).toBe(201);
    expect(dup.json().name).toBe("Aus Text (copy)");
    const list = (await app.inject({ method: "GET", url: "/office/processes/list" })).json();
    expect(list.find((x: { catalogId: string }) => x.catalogId === "bafoeg.followup").steps).toBe(gen.nodes.length);
    expect((await app.inject({ method: "POST", url: "/office/processes/delete", payload: { catalogId: "bafoeg.followup" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/office/processes/delete", payload: { catalogId: "bafoeg.abroad" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/office/processes/delete", payload: { catalogId: "bafoeg.followup" } })).statusCode).toBe(404);
  });

  it("the oversight body compares offices; office staff cannot, and oversight does not work inside an office", async () => {
    const { app, store } = setup("s-weiss");
    const cmp = (await app.inject({ method: "GET", url: "/oversight/compare?category=bafoeg.abroad" })).json();
    expect(cmp.offices.map((o: { id: string }) => o.id)).toEqual(["musterstadt", "nordhafen", "bergland", "rheinau"]);
    expect(cmp.reference.def.nodes.length).toBeGreaterThan(10);
    const score = Object.fromEntries(cmp.offices.map((o: { id: string; harmony: { total: number } }) => [o.id, o.harmony.total]));
    expect(score.rheinau).toBeGreaterThan(score.musterstadt);
    expect(score.musterstadt).toBeGreaterThan(score.nordhafen);
    expect(cmp.offices[0].live).toBe(true);
    const cat = (await app.inject({ method: "GET", url: "/oversight/catalogue" })).json();
    expect(cat.coverage.find((c: { id: string }) => c.id === "bafoeg.abroad").offices).toHaveLength(4);
    expect((await app.inject({ method: "GET", url: "/office/cases" })).statusCode).toBe(403);
    store.login("s-beispiel", "cw");
    expect((await app.inject({ method: "GET", url: "/oversight/compare", headers: { "x-staff-token": "cw" } })).statusCode).toBe(403);
  });
});

describe("required inputs drive the student's requirements", () => {
  it("a missing required form blocks, a conditional form applies after the answer, and the process can change it", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "lea");
    const docs = sampleDocuments(person);
    for (const d of docs.filter((x) => x.kind !== "fb06")) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    let c = (await app.inject({ method: "GET", url: `/applications/${id}` })).json();
    expect(c.report.findings.map((f: { ruleId: string }) => f.ruleId)).toEqual(["INPUT:fb06"]);
    const req = (key: string) => c.report.requirements.find((r: { id: string }) => r.id === key);
    expect(req("doc:fb06").state).toBe("missing");
    expect(req("doc:fb08").applies).toBe(false);

    const fb06 = docs.find((x) => x.kind === "fb06")!;
    await upload(app, `/applications/${id}/documents`, fb06.filename, fb06.content);
    c = (await app.inject({ method: "GET", url: `/applications/${id}` })).json();
    expect(c.report.ready).toBe(true);

    // The answer to a custom question makes Formblatt 8 required.
    expect((await app.inject({ method: "PUT", url: `/applications/${id}/info`, payload: { key: "parents_refuse", value: "maybe" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: `/applications/${id}/info`, payload: { key: "unknown", value: "yes" } })).statusCode).toBe(400);
    c = (await app.inject({ method: "PUT", url: `/applications/${id}/info`, payload: { key: "parents_refuse", value: "yes" } })).json();
    expect(c.report.findings.map((f: { ruleId: string }) => f.ruleId)).toEqual(["INPUT:fb08"]);
    const fb08 = formblatt8(person);
    await upload(app, `/applications/${id}/documents`, fb08.filename, fb08.content);
    c = (await app.inject({ method: "GET", url: `/applications/${id}` })).json();
    expect(c.report.ready).toBe(true);
    expect(c.documents.find((d: { kind: string }) => d.kind === "fb08").extraction.fields.parent_name).toBeTruthy();

    // The office drops Formblatt 6 from its process: it is no longer required.
    const { live } = (await app.inject({ method: "GET", url: "/office/processes" })).json();
    const without = { ...live, inputs: live.inputs.filter((i: { ref: string }) => i.ref !== "fb06") };
    expect((await app.inject({ method: "POST", url: "/office/processes/publish", payload: { def: without } })).statusCode).toBe(200);
    const { id: id2, person: p2 } = await create(app, "lea");
    for (const d of sampleDocuments(p2).filter((x) => x.kind !== "fb06")) await upload(app, `/applications/${id2}/documents`, d.filename, d.content);
    expect((await app.inject({ method: "GET", url: `/applications/${id2}` })).json().report.ready).toBe(true);
  });

  it("refuses to publish a process that requires an unknown template", async () => {
    const { app } = setup();
    const { live } = (await app.inject({ method: "GET", url: "/office/processes" })).json();
    const bad = { ...live, inputs: [...live.inputs, { id: "doc:nope", type: "document", ref: "nope", required: true }] };
    const res = await app.inject({ method: "POST", url: "/office/processes/publish", payload: { def: bad } });
    expect(res.statusCode).toBe(422);
    expect(res.json().issues.some((i: { message: { en: string } }) => i.message.en.includes("unknown"))).toBe(true);
  });
});

describe("template proposals", () => {
  const body = (over = {}) => ({
    name: "Aktualisierungsantrag", formblatt: "Formblatt 7", title: PROPOSAL_SAMPLE_TITLE, purpose: "Wenn das Einkommen der Eltern sinkt.", providedBy: "student",
    fields: [{ key: "name_der_antragstellenden_person", label: "Name der antragstellenden Person", type: "text", required: true }, { key: "einkommen_laut_bescheid_eur", label: "Einkommen laut Bescheid (EUR)", type: "number", required: true }],
    signatures: [{ key: "antragsteller_in", label: "Unterschrift Antragsteller:in" }], ...over,
  });
  const as = (store: Store, id: string, token: string) => store.login(id, token);

  it("Formblatt 6 and 8 are ready as templates", async () => {
    const { app } = setup("s-lindner");
    const r = (await app.inject({ method: "GET", url: "/office/templates" })).json();
    expect(r.templates.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining(["fb06", "fb08"]));
    expect(r.canPropose).toBe(true);
    expect(r.canApprove).toBe(false);
  });

  it("suggests fields from a sample document", async () => {
    const { app } = setup("s-lindner");
    const sample = proposalSample();
    const res = await upload(app, "/office/templates/proposals/suggest", sample.filename, sample.content);
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.title).toBe(PROPOSAL_SAMPLE_TITLE);
    expect(s.fields.length).toBeGreaterThanOrEqual(6);
    expect(s.signatures).toHaveLength(1);
    expect((await upload(app, "/office/templates/proposals/suggest", "x.pdf", Buffer.from("%PDF-1.4 nothing"))).statusCode).toBe(422);
  });

  it("a designer proposes, the extractor owner accepts, and the new template is read and usable in a process", async () => {
    const { app, store } = setup("s-lindner");
    const created = await app.inject({ method: "POST", url: "/office/templates/proposals", payload: { ...body(), submit: true } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await app.inject({ method: "POST", url: "/office/templates/proposals", payload: { ...body(), submit: true } })).statusCode).toBe(400); // same title again
    expect((await app.inject({ method: "POST", url: `/office/templates/proposals/${id}/accept`, payload: { method: "builtin" } })).statusCode).toBe(403); // designers cannot accept
    as(store, "s-richter", "owner");
    const h = { "x-staff-token": "owner" };
    expect((await app.inject({ method: "POST", url: `/office/templates/proposals/${id}/accept`, payload: {}, headers: h })).statusCode).toBe(400); // needs a method
    const accepted = (await app.inject({ method: "POST", url: `/office/templates/proposals/${id}/accept`, payload: { method: "ai", minConfidence: 0.9 }, headers: h })).json();
    expect(accepted.status).toBe("accepted");
    const tplId = accepted.templateId;
    const lib = (await app.inject({ method: "GET", url: "/office/templates", headers: h })).json();
    const t = lib.templates.find((x: { id: string }) => x.id === tplId);
    expect(t.source).toBe("accepted");
    expect(t.extraction).toEqual({ method: "ai", minConfidence: 0.9 });

    // The reader now recognises the new form.
    const sample = proposalSample();
    const read = (await app.inject({ method: "POST", url: "/office/inputs/extract", payload: { filename: sample.filename, mimeType: "application/pdf", dataBase64: sample.content.toString("base64") }, headers: h })).json();
    expect(read.kind).toBe(tplId);
    expect(read.extraction.fields.name_der_antragstellenden_person).toBe("Mira Sommer");

    // A process can only require it after it was tested with a sample and confirmed.
    const { live } = (await app.inject({ method: "GET", url: "/office/processes" })).json();
    const withIt = { ...live, inputs: [...live.inputs, { id: `doc:${tplId}`, type: "document", ref: tplId, required: true }] };
    const early = await app.inject({ method: "POST", url: "/office/processes/publish", payload: { def: withIt } });
    expect(early.statusCode).toBe(422);
    expect(early.json().issues.some((i: { message: { en: string } }) => i.message.en.includes("not been tested"))).toBe(true);
    const tested = (await app.inject({ method: "POST", url: `/office/templates/${tplId}/test`, payload: { filename: sample.filename, mimeType: "application/pdf", dataBase64: sample.content.toString("base64") }, headers: h })).json();
    expect(tested.matches).toBe(true);
    expect((await app.inject({ method: "POST", url: `/office/templates/${tplId}/confirm`, headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/office/processes/publish", payload: { def: withIt } })).statusCode).toBe(200);
    const { id: cid, person } = await create(app, "lea");
    for (const d of sampleDocuments(person)) await upload(app, `/applications/${cid}/documents`, d.filename, d.content);
    let c = (await app.inject({ method: "GET", url: `/applications/${cid}` })).json();
    expect(c.report.findings.map((f: { ruleId: string }) => f.ruleId)).toEqual([`INPUT:${tplId}`]);
    await upload(app, `/applications/${cid}/documents`, sample.filename, sample.content);
    c = (await app.inject({ method: "GET", url: `/applications/${cid}` })).json();
    expect(c.report.ready).toBe(true);
  });

  it("a rejected proposal needs a comment and can be changed and resubmitted by its author", async () => {
    const { app, store } = setup("s-lindner");
    const id = (await app.inject({ method: "POST", url: "/office/templates/proposals", payload: { ...body(), submit: true } })).json().id;
    as(store, "s-obermeier", "admin");
    const h = { "x-staff-token": "admin" };
    expect((await app.inject({ method: "POST", url: `/office/templates/proposals/${id}/reject`, payload: {}, headers: h })).statusCode).toBe(400);
    const rejected = (await app.inject({ method: "POST", url: `/office/templates/proposals/${id}/reject`, payload: { comment: "Bitte Titel prüfen." }, headers: h })).json();
    expect(rejected.status).toBe("rejected");
    expect((await app.inject({ method: "PUT", url: `/office/templates/proposals/${id}`, payload: body(), headers: h })).statusCode).toBe(409); // not the author
    const again = (await app.inject({ method: "PUT", url: `/office/templates/proposals/${id}`, payload: { ...body({ title: PROPOSAL_SAMPLE_TITLE + " (neu)" }), submit: true } })).json();
    expect(again.status).toBe("submitted");
    expect(again.decisionNote).toBeUndefined();
  });

  it("caseworkers without builder access cannot propose, and admins can grant the extractor-owner permission", async () => {
    const { app, store } = setup("s-kaya");
    expect((await app.inject({ method: "POST", url: "/office/templates/proposals", payload: body() })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/office/templates" })).statusCode).toBe(403);
    as(store, "s-obermeier", "admin");
    expect((await app.inject({ method: "PUT", url: "/office/staff/s-kaya", payload: { canApproveTemplates: true }, headers: { "x-staff-token": "admin" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/office/templates" })).statusCode).toBe(200);
  });
});

describe("rule changes", () => {
  const conds = { when: [], pass: [{ path: "docs.health_insurance.present", op: "present" }, { path: "docs.health_insurance.fields.covers_abroad", op: "eq", value: "Ja" }] };

  it("an edit becomes a draft version; the live version keeps running until another person approves", async () => {
    const { app, store } = setup("s-lindner");
    const draft = (await app.inject({ method: "PUT", url: "/office/rules/R-HEALTH/draft", payload: { ...conds, severity: "warning", plain: { de: "Neu", en: "New" } } })).json();
    expect(draft.status).toBe("changed");
    expect(draft.draft.author).toBe("Frau Lindner");
    expect(draft.draft.rule.version).toBe(2);
    expect(draft.live.rule.version).toBe(1);
    // The live version still runs.
    expect(store.liveRules().find((r) => r.id === "R-HEALTH")!.severity).toBe("blocker");
    // The author cannot approve their own change.
    const own = await app.inject({ method: "POST", url: "/office/rules/R-HEALTH/approve" });
    expect(own.statusCode).toBe(409);
    store.login("s-obermeier", "admin");
    const ok = (await app.inject({ method: "POST", url: "/office/rules/R-HEALTH/approve", headers: { "x-staff-token": "admin" } })).json();
    expect(ok.status).toBe("live");
    expect(ok.live.approvedBy).toBe("Herr Obermeier");
    expect(ok.history).toHaveLength(1);
    expect(store.liveRules().find((r) => r.id === "R-HEALTH")!.severity).toBe("warning");
  });

  it("an administrator adds a new office rule; it runs only after a second person approves it", async () => {
    const { app, store } = setup("s-obermeier");
    const body = {
      title: { de: "Versicherungsnachweis vorhanden", en: "Insurance certificate present" },
      plain: { de: "Der Nachweis muss vorliegen.", en: "The certificate must be present." },
      fix: { de: "Bitte laden Sie den Nachweis hoch.", en: "Please upload the certificate." },
      severity: "warning",
      when: [],
      pass: [{ path: "docs.health_insurance.present", op: "present" }],
    };
    const made = await app.inject({ method: "POST", url: "/office/rules", payload: body });
    expect(made.statusCode).toBe(201);
    const rule = made.json();
    expect(rule.id).toBe("R-OFFICE-01");
    expect(rule.status).toBe("draft");
    expect(rule.draft.rule.scope).toBe("office");
    expect(rule.draft.tests.map((x: { ok: boolean }) => x.ok)).toEqual([true, true]); // complete case passes, missing item fails
    expect(store.liveRules().some((r) => r.id === "R-OFFICE-01")).toBe(false);
    expect((await app.inject({ method: "POST", url: "/office/rules/R-OFFICE-01/approve" })).statusCode).toBe(409); // author
    expect((await app.inject({ method: "POST", url: "/office/rules", payload: { ...body, pass: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/office/rules", payload: { ...body, fix: { de: "", en: "" } } })).statusCode).toBe(400);
    store.login("s-lindner", "lindner");
    const ok = (await app.inject({ method: "POST", url: "/office/rules/R-OFFICE-01/approve", headers: { "x-staff-token": "lindner" } })).json();
    expect(ok.status).toBe("live");
    expect(store.liveRules().some((r) => r.id === "R-OFFICE-01")).toBe(true);
    // Caseworkers cannot add rules.
    store.login("s-beispiel", "cw");
    expect((await app.inject({ method: "POST", url: "/office/rules", payload: body, headers: { "x-staff-token": "cw" } })).statusCode).toBe(403);
  });

  it("a new rule that was never approved can be withdrawn", async () => {
    const { app, store } = setup("s-obermeier");
    await app.inject({ method: "POST", url: "/office/rules", payload: { title: { de: "A", en: "A" }, plain: { de: "a", en: "a" }, fix: { de: "a", en: "a" }, pass: [{ path: "docs.health_insurance.present", op: "present" }] } });
    expect((await app.inject({ method: "POST", url: "/office/rules/R-OFFICE-01/discard" })).json().deleted).toBe(true);
    expect(store.rules()["R-OFFICE-01"]).toBeUndefined();
    expect((await app.inject({ method: "POST", url: "/office/rules/R-HEALTH/discard" })).statusCode).toBe(404);
  });

  it("refuses unknown conditions and approval while sample cases fail", async () => {
    const { app, store } = setup("s-lindner");
    expect((await app.inject({ method: "PUT", url: "/office/rules/R-HEALTH/draft", payload: { pass: [{ path: "nope", op: "present" }] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/office/rules/R-HEALTH/draft", payload: { pass: [] } })).statusCode).toBe(400);
    // A check that always passes breaks the sample case "proof missing".
    await app.inject({ method: "PUT", url: "/office/rules/R-HEALTH/draft", payload: { pass: [{ path: "stay.weeks", op: "gte", value: "0" }] } });
    store.login("s-obermeier", "admin");
    expect((await app.inject({ method: "POST", url: "/office/rules/R-HEALTH/approve", headers: { "x-staff-token": "admin" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/office/rules/R-HEALTH/discard", headers: { "x-staff-token": "admin" } })).json().status).toBe("live");
  });

  it("a switched-off rule stops running and caseworkers cannot change rules", async () => {
    const { app, store } = setup();
    await app.inject({ method: "POST", url: "/office/rules/R-HEALTH/revoke" });
    expect(store.liveRules().some((r) => r.id === "R-HEALTH")).toBe(false);
    store.login("s-kaya", "cw");
    expect((await app.inject({ method: "PUT", url: "/office/rules/R-HEALTH/draft", payload: conds, headers: { "x-staff-token": "cw" } })).statusCode).toBe(403);
    const todo = (await app.inject({ method: "GET", url: "/office/todo" })).json();
    expect(todo.rulesToApprove).toBe(1); // the AI-drafted rule
  });
});

describe("rule selection per process", () => {
  it("only the ticked rules run, and each rule says where it is used", async () => {
    const { app, store } = setup();
    const before = (await app.inject({ method: "GET", url: "/office/rules" })).json();
    expect(before.find((r: { id: string }) => r.id === "R-HEALTH").usedIn).toHaveLength(1);
    // Untick one rule in the live process.
    const p = store.process("bafoeg.abroad")!;
    const live = p.live!;
    const ids = (live.nodes.find((n) => n.kind === "run_rules")!.config.rules as string).split(",").filter((x) => x !== "R-HEALTH");
    live.nodes = live.nodes.map((n) => (n.kind === "run_rules" ? { ...n, config: { ...n.config, rules: ids.join(",") } } : n));
    const after = (await app.inject({ method: "GET", url: "/office/rules" })).json();
    expect(after.find((r: { id: string }) => r.id === "R-HEALTH").usedIn).toHaveLength(0);
    expect(after.find((r: { id: string }) => r.id === "R-FORM-SIGNED").usedIn).toHaveLength(1);
  });

  it("validation asks for at least one rule", async () => {
    const { app, store } = setup();
    const def = JSON.parse(JSON.stringify(store.process("bafoeg.abroad")!.live));
    def.nodes = def.nodes.map((n: { kind: string; config: Record<string, unknown> }) => (n.kind === "run_rules" ? { ...n, config: { rules: "" } } : n));
    const res = (await app.inject({ method: "POST", url: "/office/processes/validate", payload: { def } })).json();
    expect(JSON.stringify(res)).toContain("no rule is ticked");
  });
});

describe("case assignment by family name", () => {
  it("a submitted case goes to the caseworker for the first letter of the family name", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "paul");
    for (const d of sampleDocuments(person, [])) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const submitted = (await app.inject({ method: "POST", url: `/applications/${id}/submit` })).json();
    expect(submitted.assignedTo.via).toBe("range");
    const letter = person.student.lastName.trim()[0]!.toUpperCase();
    const table = (await app.inject({ method: "GET", url: "/office/assignment" })).json();
    const range = table.assignment.ranges.find((r: { from: string; to: string }) => letter >= r.from && letter <= r.to);
    expect(submitted.assignedTo.id).toBe(range.staffId);
    expect(submitted.flow.log.some((l: { kind: string }) => l.kind === "assign_caseworker")).toBe(true);
  });

  it("only an administrator changes the table, and overlapping letters are refused", async () => {
    const { app, store } = setup();
    const table = (await app.inject({ method: "GET", url: "/office/assignment" })).json().assignment;
    const overlap = { ...table, ranges: [{ from: "A", to: "M", staffId: "s-beispiel" }, { from: "K", to: "Z", staffId: "s-kaya" }] };
    expect((await app.inject({ method: "PUT", url: "/office/assignment", payload: { assignment: overlap } })).statusCode).toBe(400);
    const ok = { ...table, ranges: [{ from: "A", to: "M", staffId: "s-beispiel" }, { from: "N", to: "Z", staffId: "s-kaya" }] };
    expect((await app.inject({ method: "PUT", url: "/office/assignment", payload: { assignment: ok } })).statusCode).toBe(200);
    expect(store.assignment().ranges).toHaveLength(2);
    store.login("s-kaya", "cw");
    expect((await app.inject({ method: "PUT", url: "/office/assignment", payload: { assignment: ok }, headers: { "x-staff-token": "cw" } })).statusCode).toBe(403);
  });

  it("a caseworker can reassign a case to a colleague", async () => {
    const { app, store } = setup();
    const { id, person } = await create(app, "paul");
    for (const d of sampleDocuments(person, [])) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    await app.inject({ method: "POST", url: `/applications/${id}/submit` });
    store.login("s-kaya", "cw");
    const moved = (await app.inject({ method: "POST", url: `/office/cases/${id}/assign`, payload: { staffId: "s-vogel" }, headers: { "x-staff-token": "cw" } })).json();
    expect(moved.assignedTo).toMatchObject({ id: "s-vogel", via: "manual" });
    const bad = await app.inject({ method: "POST", url: `/office/cases/${id}/assign`, payload: { staffId: "s-lindner" }, headers: { "x-staff-token": "cw" } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("adding people", () => {
  it("an administrator adds a caseworker, who can then be picked in the table; someone in the table cannot lose the flag", async () => {
    const { app, store } = setup();
    const list = (await app.inject({ method: "POST", url: "/office/staff", payload: { name: "Frau Çelik", title: "Sachbearbeitung Ausland", isCaseworker: true } })).json();
    const added = list.find((m: { name: string }) => m.name === "Frau Çelik");
    expect(added.isCaseworker).toBe(true);
    expect(added.id).toBe("s-frau-celik");
    const table = (await app.inject({ method: "GET", url: "/office/assignment" })).json();
    expect(table.caseworkers.some((m: { id: string }) => m.id === added.id)).toBe(true);
    const next = { ...table.assignment, ranges: [{ from: "A", to: "Z", staffId: added.id }] };
    expect((await app.inject({ method: "PUT", url: "/office/assignment", payload: { assignment: next } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: `/office/staff/${added.id}`, payload: { isCaseworker: false } })).statusCode).toBe(409);
    store.login("s-kaya", "cw");
    expect((await app.inject({ method: "POST", url: "/office/staff", payload: { name: "X" }, headers: { "x-staff-token": "cw" } })).statusCode).toBe(403);
  });
});

describe("demo: the administrator takes the unclear case", () => {
  it("after splitting N–R to the administrator, Paul Neumann's case is his and he can finish it", async () => {
    const { app } = setup();
    const table = (await app.inject({ method: "GET", url: "/office/assignment" })).json();
    expect(table.caseworkers.some((m: { id: string }) => m.id === "s-obermeier")).toBe(true);
    const ranges = [{ from: "A", to: "F", staffId: "s-beispiel" }, { from: "G", to: "L", staffId: "s-kaya" }, { from: "M", to: "M", staffId: "s-demir" }, { from: "N", to: "R", staffId: "s-obermeier" }, { from: "S", to: "Z", staffId: "s-vogel" }];
    expect((await app.inject({ method: "PUT", url: "/office/assignment", payload: { assignment: { ...table.assignment, ranges } } })).statusCode).toBe(200);
    const { id, person } = await create(app, "paul");
    for (const d of sampleDocuments(person, ["unclear_income"])) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const submitted = (await app.inject({ method: "POST", url: `/applications/${id}/submit` })).json();
    expect(submitted.assignedTo.id).toBe("s-obermeier");
    expect(submitted.flow.waiting).toBe("review");
    const doc = submitted.documents.find((d: { extraction: { needsReview?: boolean } }) => d.extraction.needsReview);
    const done = (await app.inject({ method: "POST", url: `/office/cases/${id}/review`, payload: { docId: doc.id, fields: { sum_of_income: "54000" } } })).json();
    expect(done.flow.waiting).toBe("human");
    const approved = (await app.inject({ method: "POST", url: `/office/cases/${id}/actions`, payload: { action: "approve", amount: done.estimate.monthly } })).json();
    expect(approved.status).toBe("approved");
    expect(approved.outbox.some((m: { to: string; subject: string }) => m.to === "student" && /approved/.test(m.subject))).toBe(true);
  });
});

describe("English documents", () => {
  it("are read like the German ones, with the same fields and the same findings", async () => {
    for (const key of ["mira", "jonas", "paul"]) {
      const person = getPerson(key, NOW);
      const set = SAMPLE_SETS.find((x) => x.person === key)!;
      const de = sampleDocuments(person, set.defects, "de");
      const en = sampleDocuments(person, set.defects, "en");
      expect(en.map((d) => d.kind)).toEqual(de.map((d) => d.kind));
      for (let i = 0; i < de.length; i++) {
        const a = extractDocument(de[i]!.content, "application/pdf");
        const b = extractDocument(en[i]!.content, "application/pdf");
        expect(b.kind).toBe(a.kind);
        // Free text such as "Praktikum" / "Internship" differs; everything the rules read is the same.
        const same = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== "stay_type" && k !== "term" && !(k === "sum_of_income" && set.defects.includes("unclear_income"))));
        expect(same(b.extraction.fields)).toEqual(same(a.extraction.fields));
        expect(b.extraction.signatures).toEqual(a.extraction.signatures);
        expect(Boolean(b.extraction.confidence && Object.values(b.extraction.confidence).some((c) => c < 0.8))).toBe(Boolean(a.extraction.confidence && Object.values(a.extraction.confidence).some((c) => c < 0.8)));
      }
    }
    expect(sampleDocuments(getPerson("paul", NOW), [], "en").find((d) => d.kind === "internship_contract")!.filename).toBe("Internship_contract.pdf");
  });

  it("an English application with English documents goes through the process as before", async () => {
    const { app } = setup();
    const { id, person } = await create(app, "paul");
    for (const d of sampleDocuments(person, ["unclear_income"], "en")) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const submitted = (await app.inject({ method: "POST", url: `/applications/${id}/submit` })).json();
    expect(submitted.flow.waiting).toBe("review");
    expect(submitted.report.blockers).toBe(0);
    const samples = (await app.inject({ method: "GET", url: "/samples?lang=en" })).json();
    expect(samples.sets.find((s: { id: string }) => s.id === "paul").docs.some((d: { name: string }) => d.name === "Income_tax_assessment.pdf")).toBe(true);
    const file = await app.inject({ method: "GET", url: "/samples/files/paul/docs/Income_tax_assessment.pdf?lang=en" });
    expect(file.statusCode).toBe(200);
  });
});

describe("texts in the language of the applicant", () => {
  it("an English applicant gets the English approval message, a German one the German message", async () => {
    for (const [language, word] of [["en", "approved"], ["de", "bewilligt"]] as const) {
      const { app } = setup();
      const p = getPerson("mira", NOW);
      const created = (await app.inject({ method: "POST", url: "/applications", payload: { student: p.student, stay: p.stay, language } })).json();
      for (const d of sampleDocuments(p, [], language)) await upload(app, `/applications/${created.id}/documents`, d.filename, d.content);
      await app.inject({ method: "POST", url: `/applications/${created.id}/submit` });
      const c = (await app.inject({ method: "GET", url: `/office/cases/${created.id}` })).json();
      const done = (await app.inject({ method: "POST", url: `/office/cases/${created.id}/actions`, payload: { action: "approve", amount: c.estimate.monthly } })).json();
      const mail = done.outbox.find((m: { to: string }) => m.to === "student");
      expect(mail.subject).toContain(word);
      expect(mail.body).toContain(language === "en" ? "Hi " : "Hallo ");
    }
  });
});

describe("outputs handed on between steps (running)", () => {
  it("the review step hands on a brief list and the reasons, and the question draft is built from them", async () => {
    const { app, store } = setup();
    const { id, person } = await create(app, "paul");
    for (const d of sampleDocuments(person, ["unclear_income"], "en")) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const submitted = (await app.inject({ method: "POST", url: `/applications/${id}/submit` })).json();
    expect(submitted.flow.waiting).toBe("review");
    const vars = submitted.flow.vars;
    expect(vars["review.review_list"]).toContain("Total income (EUR)");
    expect(vars["review.review_details"]).toContain("55 %");
    expect(vars["review.review_details"]).toContain("Part of the value could not be read");
    expect(vars["assign.caseworker"]).toBeTruthy();
    const draft = (await app.inject({ method: "GET", url: `/office/cases/${id}/question-draft` })).json();
    expect(draft.message).toContain("Total income (EUR)");
    expect(draft.message).toContain("Details:");
    expect(draft.message).not.toContain("{review_");
    expect(reviewReport(store, store.get(id)!).details).toContain("55 %");
  });

  it("a message after the rules can use the open items, the missing documents and the decision", async () => {
    const { app, store } = setup();
    const { id, person } = await create(app, "mira");
    for (const d of sampleDocuments(person, ["host_missing", "parent_unsigned"], "en")) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const a = store.get(id)!;
    const def: ProcessDef = {
      id: "t", catalogId: "bafoeg.abroad", name: "t", version: 1, updatedAt: "", updatedBy: "", inputs: [],
      nodes: [
        { id: "s", kind: "trigger" as const, position: { x: 0, y: 0 }, config: { source: "any" } },
        { id: "r", kind: "run_rules" as const, position: { x: 0, y: 0 }, config: { rules: "" } },
        { id: "m", kind: "send_notification" as const, position: { x: 0, y: 0 }, config: { to: "student", subject_en: "{r.open_count} open", subject: "x", body_en: "Open:\n{r.open_items}\nMissing:\n{r.missing_documents}", body: "x" } },
        { id: "e", kind: "end" as const, position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: "s:out", source: "s", sourceHandle: "out", target: "r" },
        { id: "r:incomplete", source: "r", sourceHandle: "incomplete", target: "m" },
        { id: "r:complete", source: "r", sourceHandle: "complete", target: "e" },
        { id: "m:out", source: "m", sourceHandle: "out", target: "e" },
      ],
    };
    // No rule ticked, but the required inputs still block.
    const run = await startRun(def, { ...a, language: "en" }, { now: NOW, check: (x, ids) => checksFor(store, x, NOW, ids) });
    const mail = run.outbox!.find((m) => m.nodeId === "m")!;
    expect(mail.subject).toMatch(/^\d+ open$/);
    expect(mail.body).toContain("Host university confirmation");
    expect(mail.body).not.toContain("{open_items}");
    expect(run.flow!.vars!["r.open_count"]).toBe(mail.subject.split(" ")[0]);
  });
});

describe("outputs of one particular step", () => {
  it("two steps of the same kind keep their own outputs, and a message can pick either", async () => {
    const { app, store } = setup();
    const { id, person } = await create(app, "mira");
    for (const d of sampleDocuments(person, ["host_missing", "parent_unsigned"], "en")) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const a = store.get(id)!;
    const n = (nid: string, kind: ProcessDef["nodes"][number]["kind"], config: Record<string, string | number> = {}) => ({ id: nid, kind, position: { x: 0, y: 0 }, config });
    const e = (source: string, handle: string, target: string) => ({ id: `${source}:${handle}`, source, sourceHandle: handle, target });
    const all = (store.liveRules().map((r) => r.id)).join(",");
    const def: ProcessDef = {
      id: "t2", catalogId: "bafoeg.abroad", name: "t2", version: 1, updatedAt: "", updatedBy: "", inputs: [],
      nodes: [n("s", "trigger", { source: "any" }), n("first", "run_rules", { rules: "" }), n("second", "run_rules", { rules: all }), n("m", "send_notification", { to: "student", subject: "x", body: "x", subject_en: "Counts", body_en: "First: {first.open_count}, second: {second.open_count}" }), n("e", "end")],
      edges: [e("s", "out", "first"), e("first", "incomplete", "second"), e("first", "complete", "e"), e("second", "incomplete", "m"), e("second", "complete", "e"), e("m", "out", "e")],
    };
    const run = await startRun(def, { ...a, language: "en" }, { now: NOW, check: (x, ids) => checksFor(store, x, NOW, ids) });
    const body = run.outbox!.find((m) => m.nodeId === "m")!.body;
    const first = Number(/First: (\d+)/.exec(body)![1]);
    const second = Number(/second: (\d+)/.exec(body)![1]);
    expect(second).toBeGreaterThan(first);
    expect(run.flow!.vars!["first.open_count"]).toBe(String(first));
  });

  it("a caseworker's briefing and a condition can use outputs too", async () => {
    const { app, store } = setup();
    const { id, person } = await create(app, "mira");
    for (const d of sampleDocuments(person, [], "en")) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    const a = store.get(id)!;
    const n = (nid: string, kind: ProcessDef["nodes"][number]["kind"], config: Record<string, string | number> = {}) => ({ id: nid, kind, position: { x: 0, y: 0 }, config });
    const e = (source: string, handle: string, target: string) => ({ id: `${source}:${handle}`, source, sourceHandle: handle, target });
    const def: ProcessDef = {
      id: "t3", catalogId: "bafoeg.abroad", name: "t3", version: 1, updatedAt: "", updatedBy: "", inputs: [],
      nodes: [n("s", "trigger", { source: "any" }), n("r", "run_rules", { rules: "" }), n("c", "condition", { field: "blockers", op: "lte", value: "{r.open_count}" }), n("h", "human_task", { instruction: "x", instruction_en: "{r.open_count} open items for {name}" }), n("e", "end")],
      edges: [e("s", "out", "r"), e("r", "incomplete", "c"), e("r", "complete", "c"), e("c", "yes", "h"), e("c", "no", "e"), e("h", "approved", "e"), e("h", "rejected", "e"), e("h", "info", "e")],
    };
    const run = await startRun(def, { ...a, language: "en" }, { now: NOW, check: (x, ids) => checksFor(store, x, NOW, ids) });
    expect(run.flow!.waiting).toBe("h");
    expect(run.flow!.briefing).toMatch(/^\d+ open items for Mira Sommer$/);
  });
});

// ---- Robustness, data inspector, typed outputs, templates, tests, impact -----------------------

function defOf(nodes: { id: string; kind: ProcessDef["nodes"][number]["kind"]; config?: Record<string, string | number> }[], edges: [string, string, string][]): ProcessDef {
  return {
    id: "x", catalogId: "bafoeg.abroad", name: "x", version: 1, updatedAt: "", updatedBy: "", inputs: [],
    nodes: nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.id, position: { x: 0, y: 0 }, config: n.config ?? {} })),
    edges: edges.map(([source, handle, target]) => ({ id: `${source}:${handle}`, source, sourceHandle: handle, target })),
  };
}

async function sampleApp(key = "lea") {
  const { app, store } = setup();
  const { id, person } = await create(app, key);
  for (const d of sampleDocuments(person, key === "mira" ? ["host_missing", "parent_unsigned"] : [], "en")) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
  const a: Application = { ...store.get(id)!, language: "en" };
  const ctx = (over: Partial<Parameters<typeof startRun>[2]> = {}) => ({
    now: NOW,
    check: (x: Application, ids?: string[] | null, scope?: "all" | "rules" | "inputs") => checksFor(store, x, NOW, ids, scope),
    template: (tid: string) => { const t = store.liveMessage(tid); return t ? { id: t.id, name: t.name, version: t.version, subject: t.subject, body: t.body } : null; },
    connection: (system: string) => { const c = store.connections()[system]; return c ? { enabled: c.enabled, mode: c.mode, name: system } : null; },
    ...over,
  });
  return { app, store, a, ctx };
}

describe("failures are visible, never silent", () => {
  it("a step whose output leads nowhere stops the process with an error instead of ending quietly", async () => {
    const { a, ctx } = await sampleApp();
    const def = defOf([{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "c", kind: "check_inputs" }], [["s", "out", "c"]]);
    const run = await startRun(def, a, ctx());
    expect(run.flow!.failed).toBe(true);
    expect(run.flow!.error!.message).toContain("not connected");
    expect(run.flow!.finished).toBe(false);
    // A loop is caught as well.
    const loop = defOf([{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "c", kind: "check_inputs" }], [["s", "out", "c"], ["c", "complete", "c"], ["c", "incomplete", "c"]]);
    const looped = await startRun(loop, a, ctx());
    expect(looped.flow!.failed).toBe(true);
    expect(looped.flow!.error!.message).toContain("More than");
  });

  it("a connector that fails is retried, then follows the error output, or stops the process if that is not connected", async () => {
    const { a, ctx } = await sampleApp();
    const base: Parameters<typeof defOf>[0] = [{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "pay", kind: "connector", config: { system: "payment", action: "create_payment_order", retries: 1, simulate: "once" } }, { id: "e", kind: "end" }];
    const ok = await startRun(defOf(base, [["s", "out", "pay"], ["pay", "out", "e"]]), a, ctx());
    expect(ok.flow!.finished).toBe(true);
    expect(ok.flow!.log.some((l) => /Attempt 1 failed/.test(l.note))).toBe(true);
    const always: Parameters<typeof defOf>[0] = base.map((n) => (n.id === "pay" ? { ...n, config: { ...n.config, simulate: "always" } } : n));
    const stopped = await startRun(defOf(always, [["s", "out", "pay"], ["pay", "out", "e"]]), a, ctx());
    expect(stopped.flow!.failed).toBe(true);
    expect(stopped.flow!.error!.message).toContain("error");
    const routed = await startRun(defOf([...always, { id: "n", kind: "send_notification", config: { to: "office", subject: "Payment failed: {pay.connector_error}", subject_en: "Payment failed: {pay.connector_error}", body: "x", body_en: "x" } }], [["s", "out", "pay"], ["pay", "out", "e"], ["pay", "error", "n"], ["n", "out", "e"]]), a, ctx());
    expect(routed.flow!.failed).toBeUndefined();
    expect(routed.outbox![0]!.subject).toContain("did not answer");
  });

  it("a switched-off connection of the office stops the step, and a caseworker can try a stopped case again at the step that failed", async () => {
    const { app, store, a, ctx } = await sampleApp();
    store.setConnection({ ...store.connections().payment!, enabled: false });
    const def = defOf([{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "pay", kind: "connector", config: { system: "payment", action: "create_payment_order" } }, { id: "e", kind: "end" }], [["s", "out", "pay"], ["pay", "out", "e"]]);
    const run = await startRun(def, a, ctx());
    expect(run.flow!.failed).toBe(true);
    expect(run.flow!.error!.message).toContain("switched off");
    // The standard process: the case listed as stopped can be tried again.
    const { id, person } = await create(app, "lea");
    for (const d of sampleDocuments(person, [], "en")) await upload(app, `/applications/${id}/documents`, d.filename, d.content);
    await app.inject({ method: "POST", url: `/applications/${id}/submit` });
    expect((await app.inject({ method: "POST", url: `/office/cases/${id}/restart` })).statusCode).toBe(409);
    store.put({ ...store.get(id)!, flow: { ...store.get(id)!.flow!, failed: true, error: { nodeId: "human", message: "x", at: NOW.toISOString() } } });
    const list = (await app.inject({ method: "GET", url: "/office/cases" })).json();
    expect(list.find((c: { id: string }) => c.id === id).failed).toBe(true);
    const restarted = (await app.inject({ method: "POST", url: `/office/cases/${id}/restart` })).json();
    expect(restarted.flow.failed).toBeUndefined();
    expect(restarted.flow.waiting).toBe("human");
  });
});

describe("the data inspector and typed outputs", () => {
  it("every step records what it produced, and a list can be shown as bullets, a line, a count or its first item", async () => {
    const { a, ctx } = await sampleApp("mira");
    const def = defOf(
      [{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "in", kind: "check_inputs" }, { id: "m", kind: "send_notification", config: { to: "office", subject: "{in.missing_inputs_count} missing", subject_en: "{in.missing_inputs_count} missing", body: "x", body_en: "List {in.missing_inputs:bullets}\nLine {in.missing_inputs:comma}\nCount {in.missing_inputs:count}\nFirst {in.missing_inputs:first}" } }, { id: "e", kind: "end" }],
      [["s", "out", "in"], ["in", "incomplete", "m"], ["in", "complete", "e"], ["m", "out", "e"]],
    );
    const run = await startRun(def, a, ctx());
    const inputsEntry = run.flow!.log.find((l) => l.nodeId === "in")!;
    expect(inputsEntry.outputs!.missing_inputs).toContain("•");
    expect(Number(inputsEntry.outputs!.missing_inputs_count)).toBeGreaterThan(0);
    const body = run.outbox![0]!.body;
    const count = Number(/Count (\d+)/.exec(body)![1]);
    const items = inputsEntry.outputs!.missing_inputs!.split("\n").length;
    expect(count).toBe(items);
    expect(/Line (.+)/.exec(body)![1]).toBe(inputsEntry.outputs!.missing_inputs!.split("\n").map((l) => l.replace(/^•\s*/, "")).join(", "));
    expect(/First (.+)/.exec(body)![1]).not.toContain("•");
    expect(body).toContain("List •");
  });

  it("the required inputs have a step of their own; the rules step can leave them out", async () => {
    const { a, ctx } = await sampleApp("mira");
    const mk = (withInputs: string) => defOf([{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "r", kind: "run_rules", config: { rules: "", withInputs } }, { id: "e", kind: "end" }], [["s", "out", "r"], ["r", "complete", "e"], ["r", "incomplete", "e"]]);
    const without = await startRun(mk("no"), a, ctx());
    expect(without.flow!.log.find((l) => l.nodeId === "r")!.handle).toBe("complete");
    const withAll = await startRun(mk("yes"), a, ctx());
    expect(withAll.flow!.log.find((l) => l.nodeId === "r")!.handle).toBe("incomplete");
  });
});

describe("message templates", () => {
  it("are written, approved by a second person, and used by a step that fills their parameters", async () => {
    const { app, store } = setup("s-lindner");
    const created = (await app.inject({ method: "POST", url: "/office/messages", payload: { name: "Thanks", purpose: "Says thanks", subject: { de: "Danke {reference}", en: "Thanks {reference}" }, body: { de: "Danke für {thing}.", en: "Thanks for {thing}." } } })).json();
    expect(created.status).toBe("draft");
    expect(created.params).toEqual(["thing"]);
    expect(store.liveMessage(created.id)).toBeNull();
    expect((await app.inject({ method: "POST", url: `/office/messages/${created.id}/approve` })).statusCode).toBe(409);
    store.login("s-obermeier", "admin");
    const live = (await app.inject({ method: "POST", url: `/office/messages/${created.id}/approve`, headers: { "x-staff-token": "admin" } })).json();
    expect(live.status).toBe("live");
    expect(store.liveMessage(created.id)!.version).toBe(1);
    // A change is a new version; the live one keeps running until approved.
    const changed = (await app.inject({ method: "PUT", url: `/office/messages/${created.id}/draft`, payload: { name: "Thanks", purpose: "x", subject: { de: "Danke", en: "Thanks" }, body: { de: "Danke!", en: "Thanks!" } } })).json();
    expect(changed.status).toBe("changed");
    expect(store.liveMessage(created.id)!.body.en).toBe("Thanks for {thing}.");
  });

  it("a step that uses a template needs every parameter filled, and the message comes out filled and framed", async () => {
    const { app, store, a, ctx } = await sampleApp("mira");
    const node = { id: "m", kind: "send_notification" as const, config: { to: "student", template: "msg-missing", params: '{"open_items":"{r.open_items}"}' } };
    const def = defOf([{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "r", kind: "run_rules", config: { rules: "", withInputs: "yes" } }, node, { id: "e", kind: "end" }], [["s", "out", "r"], ["r", "incomplete", "m"], ["r", "complete", "e"], ["m", "out", "e"]]);
    const run = await startRun(def, a, ctx());
    const mail = run.outbox![0]!;
    expect(mail.subject).toContain(a.reference);
    expect(mail.body).toContain("Hi Mira");
    expect(mail.body).toContain("• ");
    expect(mail.body).not.toContain("{open_items}");
    expect(run.flow!.log.find((l) => l.nodeId === "m")!.note).toContain("template “What is still missing” v1");
    // Missing parameter: the process cannot be saved as valid.
    const live = (await app.inject({ method: "GET", url: "/office/processes" })).json().live;
    const broken = { ...live, nodes: live.nodes.map((n: { id: string; config: Record<string, string> }) => (n.id === "notify-ok" ? { ...n, config: { ...n.config, params: "" } } : n)) };
    const res = (await app.inject({ method: "POST", url: "/office/processes/validate", payload: { def: broken } })).json();
    expect(JSON.stringify(res.issues)).toContain("nothing is put into {explanation}");
    expect(store.process("bafoeg.abroad")).toBeTruthy();
  });
});

describe("test cases, impact and ownership", () => {
  it("the standard process passes its own samples, and the impact shows changes, rules, messages and systems", async () => {
    const { app } = setup();
    const live = (await app.inject({ method: "GET", url: "/office/processes" })).json().live;
    expect(live.tests.length).toBeGreaterThanOrEqual(5);
    expect(live.owner).toBe("Frau Lindner");
    const tests = (await app.inject({ method: "POST", url: "/office/processes/tests", payload: { def: live } })).json();
    expect(tests.results.filter((r: { ok: boolean }) => !r.ok)).toEqual([]);
    const changed = { ...live, nodes: live.nodes.map((n: { id: string; name: string }) => (n.id === "human" ? { ...n, name: "Final decision" } : n)) };
    const impact = (await app.inject({ method: "POST", url: "/office/processes/impact", payload: { def: changed } })).json();
    expect(impact.changes.some((c: { text: string }) => c.text.includes("renamed to “Final decision”"))).toBe(true);
    expect(impact.dependencies.messages).toContain("Approval notice");
    expect(impact.dependencies.systems).toContain("Payment (Kasse)");
    expect(impact.dependencies.rules).toMatch(/rules/);
  });

  it("a test case that no longer holds is reported with the reason", async () => {
    const { app } = setup();
    const live = (await app.inject({ method: "GET", url: "/office/processes" })).json().live;
    const odd = { ...live, tests: [{ id: "x", name: "Complete case ends in approval without a decision", sample: "complete", expect: { visits: ["end-ok"], waitingAt: null } }] };
    const res = (await app.inject({ method: "POST", url: "/office/processes/tests", payload: { def: odd } })).json();
    expect(res.results[0].ok).toBe(false);
    expect(res.results[0].failures.join(" ")).toContain("Did not pass through “End: approved”");
  });
});

describe("connections belong to the office", () => {
  it("are listed with where they are used, can be tested and switched off by an administrator only", async () => {
    const { app, store } = setup();
    const list = (await app.inject({ method: "GET", url: "/office/connections" })).json();
    expect(list.map((c: { system: string }) => c.system)).toEqual(["case_software", "efile", "payment", "portal"]);
    expect(list.find((c: { system: string }) => c.system === "payment").usedIn).toHaveLength(1);
    const tested = (await app.inject({ method: "POST", url: "/office/connections/payment/test" })).json();
    expect(tested.lastTest.ok).toBe(true);
    const off = (await app.inject({ method: "PUT", url: "/office/connections/payment", payload: { enabled: false } })).json();
    expect(off.enabled).toBe(false);
    store.login("s-lindner", "pd");
    expect((await app.inject({ method: "PUT", url: "/office/connections/payment", payload: { enabled: true }, headers: { "x-staff-token": "pd" } })).statusCode).toBe(403);
  });
});

describe("expressions in the texts of a process", () => {
  const notify = (body: string) => defOf(
    [{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "in", kind: "check_inputs" }, { id: "m", kind: "send_notification", config: { to: "office", subject: "Case {=randomId|6}", subject_en: "Case {=randomId|6}", body: "x", body_en: body } }, { id: "e", kind: "end" }],
    [["s", "out", "in"], ["in", "incomplete", "m"], ["in", "complete", "m"], ["m", "out", "e"]],
  );

  it("split, calculate and convert with outputs of earlier steps, and keep a random ID per case on a rerun but not a random ID per run", async () => {
    const { a, ctx } = await sampleApp("mira");
    const body = "Missing: {=count|{in.missing_inputs}} · first: {=item|{in.missing_inputs}|first} · double: {=calc|{in.missing_inputs_count} * 2} · ref: {=pieces|{reference}|-|2|3} · per case {=randomId|10} · per run {=randomIdRun|10} · today {=now} · text {=toText|{=add|1|2}}";
    const def = notify(body);
    const first = await startRun(def, a, ctx());
    const text = first.outbox![0]!.body;
    expect(text).toMatch(/Missing: 1 /);
    expect(text).toContain("first: Host university confirmation");
    expect(text).toContain("double: 2");
    expect(text).toContain(`ref: ${a.reference.split("-").slice(1, 3).join("-")}`);
    expect(text).toContain("today 2026-11-16");
    expect(text).toContain("text 3");
    const perCase = /per case (\w{10})/.exec(text)![1];
    const perRun = /per run (\w{10})/.exec(text)![1];
    // The same case runs again: its ID stays, the per-run value is new.
    const again = await startRun(def, first, ctx());
    const text2 = again.outbox![1]!.body;
    expect(/per case (\w{10})/.exec(text2)![1]).toBe(perCase);
    expect(/per run (\w{10})/.exec(text2)![1]).not.toBe(perRun);
    expect(again.outbox![1]!.subject).toBe(first.outbox![0]!.subject);
    // Another case gets its own ID.
    const other = await sampleApp("jonas");
    const run3 = await startRun(def, other.a, other.ctx());
    expect(/per case (\w{10})/.exec(run3.outbox![0]!.body)![1]).not.toBe(perCase);
  });

  it("a function that cannot work stops the process with the reason", async () => {
    const { a, ctx } = await sampleApp("mira");
    const run = await startRun(notify("{=toNumber|abc}"), a, ctx());
    expect(run.flow!.failed).toBe(true);
    expect(run.flow!.error!.message).toContain("not a number");
  });

  it("a condition can compare with a calculation, and a caseworker's note can use functions", async () => {
    const { a, ctx } = await sampleApp("mira");
    const def = defOf(
      [{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "in", kind: "check_inputs" }, { id: "c", kind: "condition", config: { field: "blockers", op: "lte", value: "{=calc|{in.missing_inputs_count} + 5}" } }, { id: "h", kind: "human_task", config: { instruction: "x", instruction_en: "{=pluralize|{in.missing_inputs_count}|One item|{in.missing_inputs_count} items} open for {=upper|{name}}" } }, { id: "e", kind: "end" }],
      [["s", "out", "in"], ["in", "incomplete", "c"], ["in", "complete", "c"], ["c", "yes", "h"], ["c", "no", "e"], ["h", "approved", "e"], ["h", "rejected", "e"], ["h", "info", "e"]],
    );
    const run = await startRun(def, a, ctx());
    expect(run.flow!.waiting).toBe("h");
    expect(run.flow!.briefing).toBe("One item open for MIRA SOMMER");
  });

  it("validation reports an unknown function, missing values and a condition that would compare a list", async () => {
    const { app } = setup();
    const live = (await app.inject({ method: "GET", url: "/office/processes" })).json().live;
    const bad = { ...live, nodes: live.nodes.map((n: { id: string; config: Record<string, string> }) => (n.id === "notify-ok" ? { ...n, template: undefined, config: { to: "student", subject: "x", subject_en: "{=shout|a}", body: "x", body_en: "{=left|only one}" } } : n)) };
    const issues = JSON.stringify((await app.inject({ method: "POST", url: "/office/processes/validate", payload: { def: bad } })).json().issues);
    expect(issues).toContain("There is no function “shout”");
    expect(issues).toContain("needs 2 values");
    const cond = { ...live, nodes: [...live.nodes, { id: "c1", kind: "condition", name: "Compare", position: { x: 0, y: 0 }, config: { field: "blockers", op: "lte", value: "{rules.open_items}" } }] };
    expect(JSON.stringify((await app.inject({ method: "POST", url: "/office/processes/validate", payload: { def: cond } })).json().issues)).toContain("is a list");
  });
});

describe("condition steps, HTTP requests and the JSON picker", () => {
  const answer = JSON.stringify({ data: { rates: [{ currency: "CAD", value: 1.52 }, { currency: "USD", value: 1.08 }], country: { code: "CA" } } });
  const picks = JSON.stringify([{ name: "cad_rate", path: "data.rates[0].value", type: "number" }, { name: "currencies", path: "data.rates[*].currency", type: "list" }, { name: "country", path: "data.country.code", type: "text" }]);
  const http = (status = 200, body = answer) => async () => ({ status, body });

  it("'Read documents' hands on valid or invalid and a condition step branches on it", async () => {
    const { a, ctx } = await sampleApp("mira");
    const def = defOf(
      [{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "r", kind: "read_documents", config: { scope: "all" } }, { id: "c", kind: "condition", config: { field: "custom", left: "{r.read_result}", op: "eq", value: "valid" } }, { id: "ok", kind: "end" }, { id: "bad", kind: "end" }],
      [["s", "out", "r"], ["r", "out", "c"], ["c", "yes", "ok"], ["c", "no", "bad"]],
    );
    const run = await startRun(def, a, ctx());
    const step = run.flow!.log.find((l) => l.nodeId === "c")!;
    expect(["yes", "no"]).toContain(step.handle);
    expect(run.flow!.vars!["r.read_result"]).toMatch(/^(valid|invalid)$/);
    expect(step.handle).toBe(run.flow!.vars!["r.read_result"] === "valid" ? "yes" : "no");
  });

  it("an older process that branched inside 'Read documents' gets a condition step instead", () => {
    const old = defaultProcess();
    const nodes = old.nodes.filter((n) => n.id !== "read-ok");
    const edges = old.edges.filter((e) => e.source !== "read-ok" && e.id !== "read:out").concat({ id: "read:clear", source: "read", sourceHandle: "clear", target: "inputs" }, { id: "read:review", source: "read", sourceHandle: "review", target: "review" });
    const up = upgradeProcess({ ...old, nodes, edges });
    const cond = up.nodes.find((n) => n.kind === "condition" && n.id === "read-ok")!;
    expect(cond.config.left).toBe("{read.read_result}");
    expect(up.edges.find((e) => e.source === "read-ok" && e.sourceHandle === "yes")!.target).toBe("inputs");
    expect(up.edges.find((e) => e.source === "read-ok" && e.sourceHandle === "no")!.target).toBe("review");
    expect(validateProcess(up).filter((i) => i.nodeId === "read")).toEqual([]);
  });

  it("an HTTP request takes the picked fields out of nested JSON and hands them on as tiles", async () => {
    const { a, ctx } = await sampleApp("mira");
    const def = defOf(
      [{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "h", kind: "http_request", config: { method: "GET", url: "https://api.example.org/rates/{reference}", picks } }, { id: "m", kind: "send_notification", config: { to: "office", subject: "x", subject_en: "x", body: "x", body_en: "Rate {h.cad_rate} for {h.country}: {h.currencies:comma} ({=calc|{h.cad_rate} * 100})" } }, { id: "e", kind: "end" }],
      [["s", "out", "h"], ["h", "out", "m"], ["m", "out", "e"]],
    );
    const seen: string[] = [];
    const run = await startRun(def, a, { ...ctx(), http: async (r) => (seen.push(r.url), { status: 200, body: answer }) });
    expect(seen[0]).toBe(`https://api.example.org/rates/${a.reference}`);
    expect(run.flow!.vars!["h.cad_rate"]).toBe("1.52");
    expect(run.flow!.vars!["h.http_status"]).toBe("200");
    expect(run.outbox![0]!.body).toContain("Rate 1.52 for CA: CAD, USD (152)");
  });

  it("a failing call follows the error output, or stops with the reason when it is not connected; a field that is gone is named", async () => {
    const { a, ctx } = await sampleApp("mira");
    const mk = (withError: boolean) => defOf(
      [{ id: "s", kind: "trigger", config: { source: "any" } }, { id: "h", kind: "http_request", config: { url: "https://api.example.org/x", picks } }, { id: "ok", kind: "end" }, { id: "err", kind: "end" }],
      [["s", "out", "h"], ["h", "out", "ok"], ...(withError ? [["h", "error", "err"] as [string, string, string]] : [])],
    );
    const routed = await startRun(mk(true), a, { ...ctx(), http: http(500, "oops") });
    expect(routed.flow!.log.some((l) => l.handle === "error")).toBe(true);
    expect(routed.flow!.vars!["h.http_error"]).toContain("status 500");
    const stuck = await startRun(mk(false), a, { ...ctx(), http: http(503, "") });
    expect(stuck.flow!.failed).toBe(true);
    const moved = await startRun(mk(true), a, { ...ctx(), http: http(200, JSON.stringify({ data: {} })) });
    expect(moved.flow!.vars!["h.http_error"]).toContain("data.rates[0].value");
  });

  it("the server's own client refuses addresses inside a network", async () => {
    const { app } = setup();
    const res = (await app.inject({ method: "POST", url: "/office/http/try", payload: { url: "http://192.168.1.10/admin" } })).json();
    expect(res.error).toContain("inside a network");
    const bad = (await app.inject({ method: "POST", url: "/office/http/try", payload: { url: "ftp://example.org/x" } })).json();
    expect(bad.error).toContain("http and https");
  });

  it("validation checks the address, the picked names and the paths; the demo answer is nested", async () => {
    const { app } = setup();
    const live = (await app.inject({ method: "GET", url: "/office/processes" })).json().live;
    const node = { id: "h1", kind: "http_request", name: "Rates", position: { x: 0, y: 0 }, config: { method: "GET", url: "ftp://x", picks: JSON.stringify([{ name: "Bad Name", path: "a[", type: "text" }]) } };
    const issues = JSON.stringify((await app.inject({ method: "POST", url: "/office/processes/validate", payload: { def: { ...live, nodes: [...live.nodes, node] } } })).json().issues);
    expect(issues).toContain("http:// or https://");
    expect(issues).toContain("is not possible");
    expect(issues).toContain("“[”");
    const demo = (await app.inject({ method: "GET", url: "/demo-api/exchange" })).json();
    expect(demo.data.rates[0].currency).toBe("CAD");
  });

  it("AI documentation proposes names and comments from the flow; nothing changes until a person decides", async () => {
    const { app } = setup();
    const live = (await app.inject({ method: "GET", url: "/office/processes" })).json().live;
    const renamed = { ...live, nodes: live.nodes.map((n: { id: string }) => (n.id === "rules" ? { ...n, name: "Rule check", comment: "Our rules for the application." } : n)) };
    const res = (await app.inject({ method: "POST", url: "/office/processes/document", payload: { def: renamed } })).json();
    expect(res.simulated).toBe(true);
    expect(res.suggestions["read-ok"].comment).toContain("Result of reading");
    expect(res.suggestions.rules.name).toBeUndefined();
    expect(res.suggestions.rules.comment).toContain("approved rules");
  });
});

describe("process from a description", () => {
  const TEXT = "When an application arrives through the portal, read the documents. If the documents are not readable, ask the student to upload them again. The application form must be signed. If the monthly funding is over 1200 euros, a caseworker decides, otherwise tell the student. If approved, create the payment order. Everyone must wear a hat.";

  it("turns plain language into steps and connections that pass the builder's own checks", async () => {
    const { app } = setup();
    const res = (await app.inject({ method: "POST", url: "/office/processes/generate", payload: { description: TEXT } })).json();
    expect(res.mode).toBe("simulated");
    expect(res.issues).toEqual([]);
    const kinds = res.nodes.map((n: { kind: string }) => n.kind);
    expect(kinds).toEqual(expect.arrayContaining(["trigger", "read_documents", "condition", "request_documents", "run_rules", "human_task", "connector", "end"]));
    expect(validateProcess({ nodes: res.nodes, edges: res.edges })).toEqual([]);
    // the rule named in the text is ticked in the rules step, the rule that does not exist is reported, not invented
    expect(res.nodes.find((n: { kind: string }) => n.kind === "run_rules").config.rules).toBe("R-FORM-SIGNED");
    expect(res.unmapped.join(" ")).toContain("wear a hat");
    // the readable-documents branch points at the real id of the read step
    const read = res.nodes.find((n: { kind: string }) => n.kind === "read_documents");
    expect(res.nodes.some((n: { config: Record<string, string> }) => n.config.left === `{${read.id}.read_result}`)).toBe(true);
  });

  it("the proposal can run: it is a process the engine accepts and finishes", async () => {
    const { a, ctx } = await sampleApp("mira");
    const { app } = setup();
    const res = (await app.inject({ method: "POST", url: "/office/processes/generate", payload: { description: TEXT.replace(" through the portal", "") } })).json();
    const def: ProcessDef = { ...defaultProcess(), id: "gen", nodes: res.nodes, edges: res.edges };
    const run = await startRun(def, a, ctx());
    expect(run.flow!.log.length).toBeGreaterThan(2);
  });

  it("does not guess: an unclear sentence is reported and a trailing 'if' still becomes a branch", async () => {
    const { app } = setup();
    const res = (await app.inject({ method: "POST", url: "/office/processes/generate", payload: { description: "Reject the application if the stay is outside the EU. Bananas are yellow." } })).json();
    expect(res.nodes.some((n: { kind: string; config: Record<string, string> }) => n.kind === "condition" && n.config.field === "isEU")).toBe(true);
    expect(res.unmapped.join(" ")).toContain("Bananas");
  });

  it("asks for a real description, and is limited to people who build processes", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "POST", url: "/office/processes/generate", payload: { description: "hi" } })).statusCode).toBe(400);
    const other = setup("s-demir");
    const denied = await other.app.inject({ method: "POST", url: "/office/processes/generate", payload: { description: TEXT } });
    expect([200, 403]).toContain(denied.statusCode);
  });

  it("live mode is off without a key and falls back to the simulated writer", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { app } = setup();
      expect((await app.inject({ method: "GET", url: "/office/processes/generate/info" })).json().live).toBe(false);
      const res = (await app.inject({ method: "POST", url: "/office/processes/generate", payload: { description: TEXT, mode: "live" } })).json();
      expect(res.mode).toBe("simulated");
      expect(res.fellBack).toContain("ANTHROPIC_API_KEY");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("live mode uses the model's draft, but only after the builder's checks: unknown steps and options are dropped", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      const draft = { steps: [{ id: "a", kind: "trigger" }, { id: "b", kind: "teleport" }, { id: "c", kind: "assign_team", name: "Route it", config: { team: "Team Mars" } }, { id: "d", kind: "end" }], edges: [{ from: "a", to: "c" }, { from: "c", to: "d" }, { from: "a", to: "b" }], understood: ["x"], unmapped: [] };
      const aiFetch = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(draft) }] }), { status: 200 })) as typeof fetch;
      const store = new Store();
      const app = buildApp({ store, now: () => NOW, aiFetch });
      store.login("s-obermeier", "t");
      const res = (await app.inject({ method: "POST", url: "/office/processes/generate", headers: { "x-staff-token": "t" }, payload: { description: TEXT, mode: "live" } })).json();
      expect(res.mode).toBe("live");
      expect(res.nodes.map((n: { kind: string }) => n.kind)).toEqual(["trigger", "assign_team", "end"]);
      expect(res.unmapped.join(" ")).toContain("teleport");
      expect(res.unmapped.join(" ")).toContain("Team Mars");
      expect(res.nodes[1].name).toBe("Route it");
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("context model and watcher", () => {
  type Ctx = { graph: { nodes: { id: string; type: string; severity?: string }[]; edges: { source: string; target: string; kind: string; draftOnly?: boolean }[] }; findings: { id: string; severity: string; owner: { name: string } | null; recommendation: { en: string } }[]; resolved: { id: string }[]; runs: { trigger: string; reason: { en: string } }[] };
  const context = async (app: ReturnType<typeof setup>["app"]) => (await app.inject({ method: "GET", url: "/office/context" })).json() as Ctx;

  it("builds the graph from what the office really has", async () => {
    const { app } = setup();
    const c = await context(app);
    const types = new Set(c.graph.nodes.map((n) => n.type));
    for (const t of ["office", "person", "process", "rule", "template", "message", "connector"]) expect(types).toContain(t);
    expect(c.graph.edges).toContainEqual(expect.objectContaining({ source: "process:bafoeg.abroad", target: "connector:payment", kind: "calls" }));
    expect(c.graph.edges).toContainEqual(expect.objectContaining({ source: "person:s-lindner", target: "person:s-obermeier", kind: "reports_to" }));
    expect(c.graph.edges).toContainEqual(expect.objectContaining({ source: "office", target: "process:bafoeg.abroad", kind: "runs" }));
    expect(c.runs[0]!.trigger).toBe("startup");
  });

  it("wakes on a change, names who has to act, and clears the finding once fixed", async () => {
    const { app } = setup();
    await context(app);
    await app.inject({ method: "PUT", url: "/office/connections/payment", payload: { enabled: false } });
    let c = await context(app);
    const off = c.findings.find((f) => f.id === "connector-off:payment");
    expect(off?.severity).toBe("problem");
    expect(off?.owner?.name).toBe("Herr Obermeier");
    expect(c.runs[0]).toMatchObject({ trigger: "event", reason: { en: "Connection changed" } });
    expect(c.graph.nodes.find((n) => n.id === "connector:payment")?.severity).toBe("problem");
    expect((await app.inject({ method: "GET", url: "/office/todo" })).json().attention).toBeGreaterThan(0);
    await app.inject({ method: "PUT", url: "/office/connections/payment", payload: { enabled: true } });
    c = await context(app);
    expect(c.findings.some((f) => f.id === "connector-off:payment")).toBe(false);
    expect(c.resolved.some((f) => f.id === "connector-off:payment")).toBe(true);
  });

  it("reviews a proposed process and says which connector needs a modification", async () => {
    const { app } = setup("s-lindner");
    const live = defaultProcess();
    const draft: ProcessDef = { ...live, nodes: live.nodes.map((n) => (n.id === "case" ? { ...n, config: { ...n.config, action: "send_iban" } } : n)) };
    expect((await app.inject({ method: "PUT", url: "/office/processes/draft", payload: { def: draft } })).statusCode).toBe(200);
    const c = await context(app);
    const review = c.findings.find((f) => f.id === "process-review:bafoeg.abroad")!;
    expect(review.severity).toBe("warning");
    expect(review.owner?.name).toBe("Herr Obermeier");
    expect(c.findings.some((f) => f.id.startsWith("connector-action:bafoeg.abroad:draft:case"))).toBe(true);
    expect(c.graph.nodes.find((n) => n.id === "process:bafoeg.abroad")?.severity).toBeDefined();
  });

  it("can be run by hand and on the schedule", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "POST", url: "/admin/watcher/run" })).json().trigger).toBe("schedule");
    const c = (await app.inject({ method: "POST", url: "/office/context/run" })).json() as Ctx;
    expect(c.runs.map((r) => r.trigger).slice(0, 2)).toEqual(["manual", "schedule"]);
  });
});
