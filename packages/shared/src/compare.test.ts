import { describe, expect, it } from "vitest";
import { catalogVariants, DEFAULT_CATEGORY, isCatalogVariant } from "./catalog.js";
import { compareSettings, diffProcesses, harmony, jaccard, type OfficeSettings } from "./compare.js";
import { defaultProcess, referenceProcess, validateProcess } from "./process.js";
import { RULES } from "./rules.js";

const settings = (over: Partial<OfficeSettings> = {}): OfficeSettings => ({
  approvedRules: RULES.map((r) => r.id), extractionDefault: "ai", extractionByType: {}, slaDays: 5, languages: ["de", "en"], ...over,
});

describe("catalogue", () => {
  it("has unique variant ids and the default category", () => {
    const ids = catalogVariants().map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isCatalogVariant(DEFAULT_CATEGORY)).toBe(true);
    expect(isCatalogVariant("nope")).toBe(false);
  });
  it("a process needs a catalogue category to be valid", () => {
    expect(validateProcess({ ...defaultProcess(), catalogId: "nope" }).length).toBeGreaterThan(0);
    expect(validateProcess(defaultProcess())).toEqual([]);
  });
});

describe("comparison", () => {
  it("identical processes are 100 % similar and the reference itself is valid", () => {
    const ref = referenceProcess();
    expect(validateProcess(ref)).toEqual([]);
    expect(diffProcesses(ref, ref).structure).toBe(1);
    expect(harmony({ def: ref, settings: settings() }, { def: ref, settings: settings() }).total).toBe(100);
  });
  it("finds what the standard process lacks compared with the reference", () => {
    const d = diffProcesses(defaultProcess(), referenceProcess());
    expect(d.stepsOnlyInB).toEqual(expect.arrayContaining(["connector|portal.send_status", "connector|efile.archive_case"]));
    expect(d.stepsOnlyInA).toEqual([]);
    expect(d.structure).toBeLessThan(1);
    expect(d.unmatchedB.length).toBe(2);
  });
  it("ignores local wording such as team names and message texts", () => {
    const a = defaultProcess();
    const b = defaultProcess();
    b.nodes = b.nodes.map((n) => (n.kind === "assign_team" ? { ...n, config: { ...n.config, team: "Anderes Team" } } : n.kind === "send_notification" ? { ...n, config: { ...n.config, subject: "x", body: "y" } } : n));
    expect(diffProcesses(a, b).structure).toBe(1);
  });
  it("settings differences lower the score", () => {
    const a = { def: referenceProcess(), settings: settings() };
    const same = compareSettings(a, a).score;
    const other = compareSettings(a, { def: referenceProcess(), settings: settings({ approvedRules: RULES.slice(0, 5).map((r) => r.id), extractionDefault: "builtin", slaDays: 15 }) }).score;
    expect(same).toBe(1);
    expect(other).toBeLessThan(0.7);
  });
  it("jaccard handles empty and repeated entries", () => {
    expect(jaccard([], [])).toBe(1);
    expect(jaccard(["a", "a"], ["a"])).toBe(0.5);
  });
});
