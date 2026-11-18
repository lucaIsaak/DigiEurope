import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { PROPOSAL_SAMPLE_TITLE, SAMPLE_SETS, fixDocuments, formblatt8, getPerson, proposalSample, sampleDocuments, sampleLetter } from "./samples.js";
import { extractDocument } from "./documents.js";
import { seedDemoData } from "./seed.js";
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
      edges: live.edges.filter((e: { source: string }) => !gone.includes(e.source)).map((e: { id: string; target: string }) => (e.id === "rules:incomplete" ? { ...e, target: "end-incomplete" } : e)),
    };
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
    expect(sent.flow.finished).toBe(true);
    const steps = sent.flow.log.map((l: { kind: string }) => l.kind);
    expect(steps).toContain("request_documents");
    expect(steps).toContain("wait");
    const mail = sent.outbox.find((m: { nodeId?: string }) => m.nodeId === "ask-q");
    expect(mail.body).toContain(draft.message);
    expect(mail.body).toContain("Kind regards");
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
      expect(mail.body).toContain(language === "en" ? "Hello" : "Guten Tag");
    }
  });
});
