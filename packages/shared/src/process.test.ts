import { describe, expect, it } from "vitest";
import { STEP_OUTPUTS, defaultConfig, defaultProcess, upstreamOutputs, processRuleIds, ruleSelection, upgradeQuestionPath, validateProcess } from "./process.js";

describe("process validation", () => {
  it("accepts the default process", () => {
    expect(validateProcess(defaultProcess())).toEqual([]);
  });
  it("reports a loose end", () => {
    const p = defaultProcess();
    p.edges = p.edges.filter((e) => e.id !== "rules:incomplete");
    expect(validateProcess(p).some((i) => i.message.en.includes("not connected"))).toBe(true);
  });
  it("reports a loop", () => {
    const p = defaultProcess();
    p.edges = p.edges.map((e) => (e.id === "draft:out" ? { ...e, target: "rules" } : e));
    expect(validateProcess(p).some((i) => i.message.en.includes("loop"))).toBe(true);
  });
  it("needs exactly one start", () => {
    const p = defaultProcess();
    p.nodes = p.nodes.filter((n) => n.kind !== "trigger");
    expect(validateProcess(p).some((i) => i.message.en.includes("start"))).toBe(true);
  });
});

describe("rule selection", () => {
  it("starts empty on a new block and asks for a rule in the validation", () => {
    expect(defaultConfig("run_rules").rules).toBe("");
    const p = defaultProcess();
    p.nodes = p.nodes.map((n) => (n.kind === "run_rules" ? { ...n, config: defaultConfig("run_rules") } : n));
    expect(processRuleIds(p)).toEqual([]);
    expect(validateProcess(p).some((i) => i.message.en.includes("no rule is ticked"))).toBe(true);
  });
  it("the standard process ticks the federal rules", () => {
    expect(processRuleIds(defaultProcess())!.length).toBeGreaterThan(5);
  });
  it("a block saved before the selection existed runs all live rules", () => {
    expect(ruleSelection({ kind: "run_rules", config: {} })).toBeNull();
    expect(processRuleIds({ nodes: [{ id: "r", kind: "run_rules", position: { x: 0, y: 0 }, config: {} }] })).toBeNull();
  });
  it("collects the rules of several blocks", () => {
    const node = (id: string, rules: string) => ({ id, kind: "run_rules" as const, position: { x: 0, y: 0 }, config: { rules } });
    expect(processRuleIds({ nodes: [node("a", "R-A,R-B"), node("b", "R-B, R-C")] })).toEqual(["R-A", "R-B", "R-C"]);
  });
});

describe("question path", () => {
  it("the standard process sends a question from the review to the caseworker, then waits", () => {
    const p = defaultProcess();
    expect(p.edges.find((e) => e.id === "review:info")!.target).toBe("ask-q");
    expect(p.nodes.find((n) => n.id === "ask-q")!.config.sending).toBe("caseworker");
    expect(validateProcess(p)).toEqual([]);
  });
  it("an older copy that ended right after the question is upgraded once", () => {
    const old = defaultProcess();
    old.nodes = old.nodes.filter((n) => n.id !== "ask-q" && n.id !== "wait-q");
    old.edges = old.edges.filter((e) => e.source !== "ask-q" && e.source !== "wait-q").map((e) => (e.id === "review:info" ? { ...e, target: "end-review" } : e));
    const up = upgradeQuestionPath(old);
    expect(up.edges.find((e) => e.id === "review:info")!.target).toBe("ask-q");
    expect(validateProcess(up)).toEqual([]);
    expect(upgradeQuestionPath(up)).toBe(up);
  });
});

describe("outputs handed on between steps", () => {
  const names = (id: string) => upstreamOutputs(defaultProcess(), id).map((x) => x.output.name);
  it("the question step after the review can use what the review and the reading produced", () => {
    const n = names("ask-q");
    expect(n).toContain("review_list");
    expect(n).toContain("review_details");
    expect(n).toContain("unreadable_documents");
    expect(n).toContain("caseworker");
    expect(n).not.toContain("open_items");
  });
  it("the message after the rules can use the open items, but the approval message cannot yet use a missing-documents list from another branch", () => {
    expect(names("draft")).toContain("open_items");
    expect(names("notify-ok")).toContain("decision_amount");
  });
  it("every step that makes sense has outputs, the start and the end have none", () => {
    expect(STEP_OUTPUTS.trigger).toEqual([]);
    expect(STEP_OUTPUTS.end).toEqual([]);
    expect(STEP_OUTPUTS.run_rules.map((x) => x.name)).toEqual(["open_items", "missing_documents", "warnings", "open_count"]);
  });
  it("validation says when a text uses something no earlier step provides", () => {
    const p = defaultProcess();
    p.nodes = p.nodes.map((n) => (n.id === "review" ? { ...n, config: { ...n.config, instruction: "Check {open_items} and {caseworker}" } } : n));
    const issues = validateProcess(p).map((i) => i.message.en);
    expect(issues.some((m) => m.includes("{open_items} is not available here"))).toBe(true);
    expect(issues.some((m) => m.includes("{caseworker} is not available here"))).toBe(false);
  });
});

describe("outputs of one particular step: validation", () => {
  it("accepts a token that points at an earlier step that provides it, refuses others", () => {
    const p = defaultProcess();
    const set = (text: string) => ({ ...p, nodes: p.nodes.map((n) => (n.id === "notify-ok" ? { ...n, config: { ...n.config, body_en: text } } : n)) });
    expect(validateProcess(set("{rules.open_count} and {review.review_list}")).filter((i) => /not|no longer/.test(i.message.en))).toEqual([]);
    expect(validateProcess(set("{ghost.open_count}")).some((i) => i.message.en.includes("no longer exists"))).toBe(true);
    expect(validateProcess(set("{notify-no.message_body}")).some((i) => i.message.en.includes("does not provide"))).toBe(true);
  });
});
