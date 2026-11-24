import { describe, expect, it } from "vitest";
import { applyEdit, interpretEdit, generateProcess, sanitizeOps, summarizeProcess, validateProcess, type EditOp } from "./index.js";

const EXAMPLE = "When an application arrives through the portal, read the documents. If the documents are not readable, ask the student to upload them again. If approved, create the payment order. If rejected, reject the application. A caseworker decides.";
const base = () => { const g = generateProcess(EXAMPLE); return { nodes: g.nodes, edges: g.edges }; };

describe("editing a process in words", () => {
  it("adds a reminder after asking the applicant: a wait and a message, in order", () => {
    const def = base();
    const r = interpretEdit("Add a reminder after 7 days", def);
    expect(r.ops.length).toBe(2);
    const out = applyEdit(def, r.ops);
    expect(out.skipped).toEqual([]);
    expect(out.nodes.some((n) => n.kind === "wait" && n.config.days === 7)).toBe(true);
    const wait = out.nodes.find((n) => n.kind === "wait")!;
    const msg = out.nodes.find((n) => n.name === "Remind the applicant")!;
    expect(out.edges.some((e) => e.source === wait.id && e.target === msg.id)).toBe(true);
  });

  it("puts a condition with a second review on the approved connection, and both answers carry on", () => {
    const def = base();
    const r = interpretEdit("If funding is over 1200, add a second review", def);
    expect(r.ops[0]?.op).toBe("branch");
    const out = applyEdit(def, r.ops);
    expect(out.skipped).toEqual([]);
    const cond = out.nodes.find((n) => n.kind === "condition" && n.config.field === "estimateMonthly")!;
    expect(cond).toBeTruthy();
    expect(cond.config.value).toBe("1200");
    const yes = out.edges.find((e) => e.source === cond.id && e.sourceHandle === "yes")!;
    const no = out.edges.find((e) => e.source === cond.id && e.sourceHandle === "no")!;
    expect(out.nodes.find((n) => n.id === yes.target)?.name).toBe("Second review");
    expect(out.nodes.find((n) => n.id === no.target)).toBeTruthy();
    // The extra review carries on to where the no-answer goes, so both ways meet again.
    const review = out.edges.find((e) => e.source === yes.target && e.sourceHandle === "approved");
    expect(review?.target ?? no.target).toBe(no.target);
  });

  it("removes and renames, refuses to remove the start, and says what it could not find", () => {
    const def = base();
    const out = applyEdit(def, [
      { op: "rename", step: "Caseworker decides", name: "Head of office decides" },
      { op: "remove", step: "the start" },
      { op: "remove", step: "unicorn" },
    ]);
    expect(out.nodes.some((n) => n.name === "Head of office decides")).toBe(true);
    expect(out.skipped.length).toBe(2);
    expect(out.nodes.some((n) => n.kind === "trigger")).toBe(true);
  });

  it("closes the gap when a step in the middle is removed", () => {
    const def = base();
    const read = def.nodes.find((n) => n.kind === "read_documents")!;
    const before = def.edges.find((e) => e.target === read.id)!;
    const next = def.edges.find((e) => e.source === read.id)!;
    const out = applyEdit(def, [{ op: "remove", step: read.id }]);
    expect(out.edges.find((e) => e.source === before.source && e.sourceHandle === before.sourceHandle)?.target).toBe(next.target);
  });

  it("drafts a whole process when the canvas is empty", () => {
    const r = interpretEdit(EXAMPLE, { nodes: base().nodes.slice(0, 1), edges: [] });
    expect(r.proposal?.nodes.length).toBeGreaterThan(3);
  });

  it("answers questions without changing anything, and says so when it does not understand", () => {
    const def = base();
    expect(interpretEdit("Explain this process", def).summary?.length).toBeGreaterThan(3);
    expect(interpretEdit("Is anything wrong?", def).ops).toEqual([]);
    expect(interpretEdit("Describe each step", def).action).toBe("document");
    const lost = interpretEdit("make it blue", def);
    expect(lost.ops).toEqual([]);
    expect(lost.reply.en).toMatch(/didn't understand|I can add/);
  });

  it("keeps a process valid after the edits it makes", () => {
    const def = base();
    const r = interpretEdit("Add a reminder after 7 days and if funding is over 1200, add a second review", def);
    const out = applyEdit(def, r.ops);
    const before = validateProcess(def).length;
    expect(validateProcess({ nodes: out.nodes, edges: out.edges }).length).toBeLessThanOrEqual(before);
  });

  it("drops anything a model returns that is not a known operation", () => {
    const ops = sanitizeOps([
      { op: "add", spec: { kind: "wait", config: { days: 3 } }, after: "x" },
      { op: "add", spec: { kind: "trigger" }, after: "x" },
      { op: "delete_everything" },
      { op: "set", step: "x", key: "days", value: { nested: true } },
      "nonsense",
    ]) as EditOp[];
    expect(ops.length).toBe(1);
    expect(ops[0]?.op).toBe("add");
  });

  it("reads a process aloud with its branches", () => {
    const lines = summarizeProcess(base());
    expect(lines[0]?.text.en).toMatch(/When an application arrives/);
    expect(lines.some((l) => /^If “/.test(l.text.en))).toBe(true);
  });
});
