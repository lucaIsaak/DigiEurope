import { describe, expect, it } from "vitest";
import { runRuleTests } from "./engine.js";
import { estimate, parentContribution } from "./estimate.js";
import { baselineFacts } from "./facts.js";
import { analyzeLetter } from "./letter.js";
import { answerFromKnowledge } from "./knowledge.js";
import { RULES } from "./rules.js";

describe("rule sample cases", () => {
  for (const rule of RULES) {
    it(`${rule.id} passes all its sample cases`, () => {
      const outcomes = runRuleTests(rule, baselineFacts() as unknown as Record<string, unknown>);
      expect(outcomes.filter((o) => !o.ok)).toEqual([]);
      expect(outcomes.length).toBeGreaterThan(1);
    });
  }
});

describe("estimate", () => {
  it("is zero contribution below the allowance", () => {
    expect(parentContribution({ netMonthly: 2000, married: true, siblings: 0 })).toBe(0);
  });
  it("counts half of the excess above the allowance", () => {
    expect(parentContribution({ netMonthly: 3540, married: true, siblings: 0 })).toBe(500);
  });
  it("is provisional without parent documents", () => {
    const e = estimate({ stay: { type: "study", country: "CA", city: "", institution: "", startDate: "2027-02-01", endDate: "2027-08-15", tuitionFees: 0 }, documents: [], parents: { status: "not_requested", email: "", married: null, siblingsInEducation: 0 }, student: { firstName: "", lastName: "", birthDate: "", email: "", university: "", course: "" } });
    expect(e.provisional).toBe(true);
    expect(e.monthly).toBeGreaterThan(900);
  });
});

describe("letter analysis", () => {
  const letter = { name: "X", period_from: "2025-09-01", period_to: "2026-08-31", country: "CA", need_monthly: 1100, parent_income_year: 2023, parent_net_monthly: 3980, parents_married: true, siblings_in_education: 0, parent_contribution: 720, grant_monthly: 380, tuition_supplement: 5200, tuition_months: 12, travel_allowance: 1000 };
  it("predicts rejection when parental income rises a lot", () => {
    expect(analyzeLetter(letter, { incomeChangePercent: 25, tuitionAgain: true, extraSiblings: 0 }).next.verdict).toBe("likely_rejected");
  });
  it("flags the ending tuition supplement", () => {
    const a = analyzeLetter(letter, { incomeChangePercent: 0, tuitionAgain: true, extraSiblings: 0 });
    expect(a.next.reasons.some((r) => r.text.en.includes("tuition supplement"))).toBe(true);
  });
});

describe("knowledge", () => {
  it("cites a source for every match", () => {
    expect(answerFromKnowledge("Werden Studiengebühren übernommen?")?.source.url).toMatch(/^https:/);
  });
  it("returns null for off-topic questions", () => {
    expect(answerFromKnowledge("what is the weather")).toBeNull();
  });
});
