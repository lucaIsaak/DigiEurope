import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { sameName } from "./agents.js";
import { getPerson, sampleDocuments, type Defect } from "./samples.js";
import { Store } from "./store.js";

const NOW = new Date("2026-11-16T10:00:00Z");

function setup(agentFetch?: typeof fetch) {
  const store = new Store();
  const app = buildApp({ store, now: () => NOW, agentFetch });
  store.login("s-obermeier", "t");
  const call = (o: Record<string, unknown>) => app.inject({ ...o, headers: { "x-staff-token": "t" } } as never);
  return { store, app, call };
}

async function submitted(s: ReturnType<typeof setup>, key: string, defects: Defect[]) {
  const p = getPerson(key, NOW);
  const id = (await s.app.inject({ method: "POST", url: "/applications", payload: { student: p.student, stay: p.stay, language: "en" } })).json().id as string;
  for (const d of sampleDocuments(p, defects, "en")) {
    await s.app.inject({ method: "POST", url: `/applications/${id}/documents`, payload: { filename: d.filename, mimeType: "application/pdf", dataBase64: d.content.toString("base64") } });
  }
  // Cases with open points arrive through the official portal, so they are submitted directly here.
  s.store.put({ ...s.store.get(id)!, status: "submitted", submittedAt: NOW.toISOString() });
  return id;
}

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe("names", () => {
  it("accepts reordering, diacritics and middle names; rejects others", () => {
    expect(sameName("Müller, Anna", "Anna Muller")).toBe(true);
    expect(sameName("Anna Maria Muller", "Anna Muller")).toBe(true);
    expect(sameName("Anna Muller", "Anja Muller")).toBe(false);
  });
});

describe("agents", () => {
  it("proposes an amount for a complete case and hands it over for one click, and approves nothing", async () => {
    const s = setup();
    const id = await submitted(s, "lea", []);
    const tick = (await s.call({ method: "POST", url: "/admin/agents/run" })).json();
    expect(tick.processed).toBe(1);
    const a = s.store.get(id)!;
    expect(a.agent?.stage).toBe("ready_for_approval");
    expect(a.agent?.proposal?.monthly).toBeGreaterThan(0);
    expect(a.decision).toBeUndefined();
    expect(a.status).not.toBe("approved");
    const q = (await s.call({ method: "GET", url: "/office/agents" })).json();
    expect(q.counts.ready_for_approval).toBe(1);
  });

  it("asks the student once for what is missing, and not again while nothing changes", async () => {
    const s = setup();
    const id = await submitted(s, "mira", ["parent_unsigned", "host_missing"]);
    await s.call({ method: "POST", url: "/admin/agents/run" });
    let a = s.store.get(id)!;
    expect(a.agent?.stage).toBe("waiting_student");
    expect(a.status).toBe("info_requested");
    const mails = a.outbox?.length ?? 0;
    expect(mails).toBeGreaterThan(0);
    const again = (await s.call({ method: "POST", url: "/admin/agents/run" })).json();
    expect(again.unchanged).toBe(1);
    a = s.store.get(id)!;
    expect(a.outbox?.length).toBe(mails);
  });

  it("escalates doubtful readings to an employee, with a briefing", async () => {
    const s = setup();
    const id = await submitted(s, "paul", ["unclear_income"]);
    await s.call({ method: "POST", url: "/admin/agents/run" });
    const a = s.store.get(id)!;
    expect(a.agent?.stage).toBe("needs_employee");
    expect(a.agent?.escalation?.summary).toMatch(/low confidence/);
  });

  it("uses the model for the briefing when a key is set, and falls back when the model fails", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    const calls: string[] = [];
    const ok: typeof fetch = async (_url, init) => {
      calls.push(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Check the income amount on the tax notice."}' } }] }), { status: 200 });
    };
    const s = setup(ok);
    const id = await submitted(s, "paul", ["unclear_income"]);
    await s.call({ method: "POST", url: "/admin/agents/run" });
    expect(s.store.get(id)!.agent?.escalation).toMatchObject({ llm: true, summary: "Check the income amount on the tax notice." });
    expect(calls.length).toBe(1);

    process.env.LLM_RETRY_MS = "1";
    const down: typeof fetch = async () => new Response("no", { status: 500 });
    const t = setup(down);
    const id2 = await submitted(t, "paul", ["unclear_income"]);
    await t.call({ method: "POST", url: "/admin/agents/run" });
    expect(t.store.get(id2)!.agent?.escalation?.llm).toBe(false);
  });

  it("is idempotent across ticks and skips overlapping ones", async () => {
    const s = setup();
    await submitted(s, "lea", []);
    const [one, two] = await Promise.all([s.call({ method: "POST", url: "/admin/agents/run" }), s.call({ method: "POST", url: "/admin/agents/run" })]);
    const results = [one.json(), two.json()];
    expect(results.filter((r) => r.busy).length + results.filter((r) => !r.busy).length).toBe(2);
    expect(results.reduce((n, r) => n + r.processed, 0)).toBe(1);
  });
});
