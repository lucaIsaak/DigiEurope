import { describe, expect, it } from "vitest";
import { assignCaseworker, checkAssignment, defaultAssignment, surnameLetter } from "./assignment.js";
import { defaultProcess, upgradeAssignment, validateProcess } from "./process.js";

describe("family-name letter", () => {
  it("ignores prefixes and accents", () => {
    expect(surnameLetter("Müller")).toBe("M");
    expect(surnameLetter("von Hagen")).toBe("H");
    expect(surnameLetter("de la Cruz")).toBe("C");
    expect(surnameLetter("Çelik")).toBe("C");
    expect(surnameLetter("Özdemir")).toBe("O");
    expect(surnameLetter("Ścibor")).toBe("S");
    expect(surnameLetter("Weiß-Neumann")).toBe("W");
    expect(surnameLetter("  ")).toBe("");
  });
});

describe("assigning a caseworker", () => {
  const table = defaultAssignment();
  it("uses the range of the first letter", () => {
    expect(assignCaseworker("Adler", table)).toMatchObject({ staffId: "s-beispiel", via: "range" });
    expect(assignCaseworker("Krause", table)).toMatchObject({ staffId: "s-kaya", via: "range" });
    expect(assignCaseworker("Neumann", table)).toMatchObject({ staffId: "s-demir", via: "range" });
    expect(assignCaseworker("Zimmer", table)).toMatchObject({ staffId: "s-vogel", via: "range" });
  });
  it("sends a name without a letter to the fallback", () => {
    expect(assignCaseworker("123", table)).toMatchObject({ staffId: "s-obermeier", via: "fallback" });
  });
  it("an absent caseworker is covered by the substitute, and by the fallback if the substitute is away too", () => {
    const away = { ...table, away: { "s-kaya": "s-beispiel" } };
    expect(assignCaseworker("Krause", away)).toMatchObject({ staffId: "s-beispiel", via: "substitute", covering: "s-kaya" });
    const both = { ...table, away: { "s-kaya": "s-beispiel", "s-beispiel": "s-kaya" } };
    expect(assignCaseworker("Krause", both)).toMatchObject({ staffId: "s-obermeier", via: "fallback" });
  });
  it("finds overlaps and gaps in the table", () => {
    expect(checkAssignment(table)).toEqual({ invalid: [], overlaps: [], gaps: [] });
    const bad = { ...table, ranges: [{ from: "A", to: "H", staffId: "s-beispiel" }, { from: "G", to: "L", staffId: "s-kaya" }] };
    const c = checkAssignment(bad);
    expect(c.overlaps).toEqual(["G", "H"]);
    expect(c.gaps[0]).toBe("M");
  });
});

describe("assign caseworker step", () => {
  it("is the first step after the start of the standard process", () => {
    const p = defaultProcess();
    expect(p.edges.find((e) => e.id === "start:out")!.target).toBe("assign");
    expect(p.nodes.some((n) => n.id === "team")).toBe(false);
    expect(validateProcess(p)).toEqual([]);
  });
  it("an older copy with the fixed team is upgraded once", () => {
    const old = defaultProcess();
    old.nodes = old.nodes.filter((n) => n.id !== "assign").concat({ id: "team", kind: "assign_team", position: { x: 0, y: 0 }, config: { team: "Team Ausland" } });
    old.edges = old.edges.filter((e) => e.source !== "assign" && e.id !== "start:out" && e.id !== "rules:complete").concat(
      { id: "start:out", source: "start", sourceHandle: "out", target: "read" },
      { id: "rules:complete", source: "rules", sourceHandle: "complete", target: "team" },
      { id: "team:out", source: "team", sourceHandle: "out", target: "human" },
    );
    const up = upgradeAssignment(old);
    expect(up.nodes.some((n) => n.kind === "assign_caseworker")).toBe(true);
    expect(up.nodes.some((n) => n.id === "team")).toBe(false);
    expect(validateProcess(up)).toEqual([]);
    expect(upgradeAssignment(up)).toBe(up);
  });
});
