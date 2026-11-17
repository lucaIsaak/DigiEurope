import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { SAMPLE_SETS, fixDocuments, getPerson, sampleDocuments, sampleLetter } from "./samples.js";
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
    expect(submitted.assignedTeam).toBe("Team Ausland");
    expect(submitted.flow.waiting).toBe("human");
    const done = (await app.inject({ method: "POST", url: `/office/cases/${id}/actions`, payload: { action: "approve", amount: 900 } })).json();
    expect(done.integrations[0].system).toBe("payment");
    expect(done.outbox.some((m: { subject: string }) => m.subject.includes("bewilligt"))).toBe(true);
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
    expect(done.assignedTeam).toBe("Team Ausland");
    expect(done.estimate.provisional).toBe(false);
    expect(done.documents.find((d: { kind: string }) => d.kind === "parent_tax").extraction.needsReview).toBe(false);
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
