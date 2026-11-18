import { describe, expect, it } from "vitest";
import { applyMentions, canMerge, decideSuggestion, documentProcess, isRenamed, mergeComments, renameImpact, renameOutputTokens } from "./documentation.js";
import { extractPicks, getJsonPath, listPaths, parsePath, suggestName } from "./json.js";
import { defaultProcess, outputsOfNode, upstreamOutputs } from "./process.js";

const body = { data: { rates: [{ currency: "CAD", value: 1.5 }, { currency: "USD", value: 1.1 }], "odd key": { ok: true }, empty: null } };

describe("JSON picker paths", () => {
  it("lists nested fields with the code that reaches them", () => {
    const paths = listPaths(body).map((p) => p.path);
    expect(paths).toContain("data.rates[0].currency");
    expect(paths).toContain('data["odd key"].ok');
  });
  it("reads a field, every item with [*], and says nothing for a missing one", () => {
    expect(getJsonPath(body, "data.rates[1].value")).toBe(1.1);
    expect(getJsonPath(body, "data.rates[*].currency")).toEqual(["CAD", "USD"]);
    expect(getJsonPath(body, 'data["odd key"].ok')).toBe(true);
    expect(getJsonPath(body, "data.nothing.here")).toBeUndefined();
    expect(() => parsePath("data[")).toThrow("without");
    expect(() => parsePath("data[x]")).toThrow("Use a number");
  });
  it("extracts the picked fields as outputs and names a missing one", () => {
    const out = extractPicks(body, [{ name: "a", path: "data.rates[0].value", type: "number" }, { name: "b", path: "data.rates[*].currency", type: "list" }, { name: "c", path: 'data["odd key"].ok', type: "yesno" }]);
    expect(out).toEqual({ a: "1.5", b: "• CAD\n• USD", c: "yes" });
    expect(() => extractPicks(body, [{ name: "x", path: "data.gone", type: "text" }])).toThrow("data.gone");
  });
  it("suggests unique snake_case names", () => {
    expect(suggestName("data.rates[0].currencyCode", [])).toBe("currency_code");
    expect(suggestName("a.value", ["value"])).toBe("value_2");
  });
  it("picked fields are outputs of the step, in order downstream", () => {
    const def = defaultProcess();
    const node = { id: "h", kind: "http_request" as const, position: { x: 0, y: 0 }, config: { picks: JSON.stringify([{ name: "rate", path: "a", type: "number" }]) } };
    expect(outputsOfNode(node).map((o) => o.name)).toContain("rate");
    const g = { nodes: [...def.nodes, node], edges: [...def.edges, { id: "x", source: "assign", target: "h" }, { id: "y", source: "h", target: "read" }] };
    expect(upstreamOutputs(g, "read").some((u) => u.nodeId === "h" && u.output.name === "rate")).toBe(true);
  });
});

describe("AI documentation and renaming", () => {
  const def = defaultProcess();
  it("proposes names for steps nobody renamed and comments that mention neighbours by their names", () => {
    const plain = { ...def, nodes: def.nodes.map((n) => (n.id === "read-ok" ? { ...n, name: "Condition" } : n)) };
    const s = documentProcess(plain);
    expect(s["read-ok"]!.name).toBe("Result of reading is valid?");
    expect(s["read-ok"]!.comment).toContain("“Check required inputs”");
    expect(s["read-ok"]!.comment).toContain("“Review unclear fields”");
  });
  it("leaves a name a person chose alone and only merges when name and comment are there", () => {
    const mine = { ...def.nodes.find((n) => n.id === "rules")!, name: "Our rule check", comment: "Applies the approved rules." };
    expect(isRenamed(mine)).toBe(true);
    expect(canMerge(mine)).toBe(true);
    expect(canMerge({ ...mine, comment: "" })).toBe(false);
    const sug = { ...mine, suggestion: { comment: "Applies the ticked, approved rules to the application. Then “Draft e-mail”.", at: "now" } };
    expect(decideSuggestion(sug, "reject").suggestion).toBeUndefined();
    expect(decideSuggestion(sug, "reject").comment).toBe("Applies the approved rules.");
    expect(decideSuggestion(sug, "use").comment).toContain("ticked");
    const merged = decideSuggestion(sug, "merge");
    expect(merged.name).toBe("Our rule check");
    expect(merged.comment!.startsWith("Applies the approved rules.")).toBe(true);
    expect(merged.comment).toContain("Draft e-mail");
    expect(mergeComments("Applies the approved rules.", "Applies the approved rules.")).toBe("Applies the approved rules.");
  });
  it("finds where a renamed step is used: tiles update by themselves, written-out names are proposed", () => {
    const edited = { ...def, nodes: def.nodes.map((n) => (n.id === "end-ok" ? { ...n, comment: "After “Caseworker decides” approved." } : n)) };
    const impact = renameImpact(edited, "human", "Caseworker decides", "Decision by the team");
    expect(impact.tiles.some((t) => t.nodeId === "notify-ok")).toBe(true);
    expect(impact.mentions.map((m) => m.nodeId)).toContain("end-ok");
    const fixed = applyMentions(edited, impact.mentions);
    expect(fixed.nodes.find((n) => n.id === "end-ok")!.comment).toBe("After “Decision by the team” approved.");
  });
  it("a renamed picked field changes its tiles downstream", () => {
    const d = { ...def, nodes: def.nodes.map((n) => (n.id === "ask" ? { ...n, config: { ...n.config, fallback: "Rate {draft.draft_subject:count} and {=upper|{draft.draft_subject}}" } } : n)) };
    const r = renameOutputTokens(d, "draft", "draft_subject", "headline");
    expect(r.changed.length).toBeGreaterThan(0);
    expect(String(r.def.nodes.find((n) => n.id === "ask")!.config.fallback)).toBe("Rate {draft.headline:count} and {=upper|{draft.headline}}");
  });
});
