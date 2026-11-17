import { describe, expect, it } from "vitest";
import { defaultProcess, validateProcess } from "./process.js";

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
