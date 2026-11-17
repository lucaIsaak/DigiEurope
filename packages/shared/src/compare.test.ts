import { describe, expect, it } from "vitest";
import { catalogVariants, DEFAULT_CATEGORY, isCatalogVariant } from "./catalog.js";
import { compareSettings, diffInputs, diffProcesses, harmony, jaccard, type OfficeSettings } from "./compare.js";
import { computeRequirements } from "./requirements.js";
import { runChecks } from "./check.js";
import { defaultRuleStates } from "./rules.js";
import { BUILTIN_TEMPLATES, suggestTemplateFromLines } from "./templates.js";
import { defaultInputs, defaultProcess, referenceProcess, validateProcess } from "./process.js";
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

describe("required inputs", () => {
  const app = (over = {}) => ({
    stay: { type: "study" as const, country: "CA", city: "Toronto", institution: "X", startDate: "2027-04-01", endDate: "2027-10-14", tuitionFees: 0 },
    documents: [], parents: { status: "not_requested" as const, email: "", married: null, siblingsInEducation: 0 },
    student: { firstName: "A", lastName: "B", birthDate: "2003-01-01", email: "", university: "", course: "" }, ...over,
  });
  it("only requires what applies", () => {
    const r = computeRequirements(defaultInputs(), app());
    const by = (id: string) => r.find((x) => x.id === id)!;
    expect(by("doc:host_confirmation").applies).toBe(true);
    expect(by("doc:internship_contract").applies).toBe(false);
    expect(by("doc:tuition_waiver_proof").applies).toBe(false);
    expect(by("doc:fb08").applies).toBe(false);
    expect(computeRequirements(defaultInputs(), app({ info: { parents_refuse: "yes" } })).find((x) => x.id === "doc:fb08")!.applies).toBe(true);
    expect(computeRequirements(defaultInputs(), app({ stay: { ...app().stay, tuitionFees: 3000 } })).find((x) => x.id === "doc:tuition_waiver_proof")!.applies).toBe(true);
  });
  it("a required form that is missing blocks, and a rule finding is not reported twice", () => {
    const report = runChecks(app(), defaultRuleStates(), new Date("2026-11-16"), undefined, { inputs: defaultInputs() });
    expect(report.findings.filter((f) => f.documentKind === "fb06").map((f) => f.ruleId)).toEqual(["INPUT:fb06"]);
    expect(report.findings.filter((f) => f.documentKind === "host_confirmation")).toHaveLength(1);
    expect(report.ready).toBe(false);
  });
  it("optional and unmet-condition inputs never block", () => {
    const only = defaultInputs().filter((i) => i.id === "doc:fb08" || i.id === "info:parents_refuse");
    expect(runChecks(app(), {}, new Date("2026-11-16"), [], { inputs: only }).ready).toBe(true);
  });
  it("inputs that differ lower the comparison", () => {
    expect(diffInputs({ inputs: defaultInputs() }, { inputs: defaultInputs() }).similarity).toBe(1);
    const fewer = defaultInputs().filter((i) => i.ref !== "fb06");
    const d = diffInputs({ inputs: fewer }, { inputs: defaultInputs() });
    expect(d.onlyInB).toEqual(["document:fb06:required:null"]);
    expect(d.similarity).toBeLessThan(1);
  });
});

describe("templates", () => {
  it("has Formblatt 6 and 8 ready with unique ids and titles", () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["fb06", "fb08"]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.title)).size).toBe(ids.length);
  });
  it("suggests a template from the lines of a sample document", () => {
    const s = suggestTemplateFromLines(["Studierendenwerk Musterstadt", "Formblatt 12: Beispiel", "Name: Ada", "Geburtsdatum: 2001-02-03", "Betrag: 120", "Wohnheim bestätigt: Ja", "Unterschrift Antragsteller:in: Ada (gezeichnet)", "BEISPIELDOKUMENT: fiktiv"]);
    expect(s.title).toBe("Formblatt 12: Beispiel");
    expect(s.fields.map((f) => `${f.key}:${f.type}`)).toEqual(["name:text", "geburtsdatum:date", "betrag:number", "wohnheim_bestaetigt:yesno"]);
    expect(s.signatures).toHaveLength(1);
  });
});


import { factCatalog, fromCheck, toCheck } from "./conditions.js";
import { RULES as ALL_RULES } from "./rules.js";
import { runRuleTests } from "./engine.js";
import { baselineFacts } from "./facts.js";

describe("no-code conditions", () => {
  it("every built-in rule can be shown in the editor and turned back into the same check", () => {
    for (const r of ALL_RULES) {
      const pass = fromCheck(r.pass);
      const when = fromCheck(r.when);
      expect(pass, r.id).not.toBeNull();
      expect(when, r.id).not.toBeNull();
      const rebuilt = { ...r, pass: toCheck(pass!)!, when: toCheck(when!) };
      expect(runRuleTests(rebuilt, baselineFacts() as unknown as Record<string, unknown>).every((t) => t.ok), r.id).toBe(true);
    }
  });
  it("lists document fields and signatures from the templates", () => {
    const f = factCatalog(BUILTIN_TEMPLATES);
    expect(f.some((x) => x.path === "docs.parent_form.sig.parent")).toBe(true);
    expect(f.some((x) => x.path === "docs.fb06.fields.credit_recognition" && x.type === "yesno")).toBe(true);
  });
});
