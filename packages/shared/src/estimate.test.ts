import { describe, expect, it } from "vitest";
import { draftExplanation, estimate, explainEstimate } from "./estimate.js";

const app = {
  stay: { type: "study" as const, country: "CA", city: "", institution: "", startDate: "2027-02-01", endDate: "2027-08-15", tuitionFees: 0 },
  documents: [],
  parents: { status: "not_requested" as const, email: "", married: null, siblingsInEducation: 0 },
  student: { firstName: "", lastName: "", birthDate: "", email: "", university: "", course: "" },
};

describe("decision explanation", () => {
  it("the step-by-step calculation adds up to the estimate", () => {
    const x = explainEstimate(app);
    const e = estimate(app);
    expect(x.parts.reduce((s, p) => s + p.amount, 0)).toBe(x.need);
    expect(x.grant).toBe(e.monthly);
    expect(x.parentsKnown).toBe(false);
  });
  it("drafts a plain explanation in the student's language", () => {
    const x = explainEstimate(app);
    expect(draftExplanation(x, "approved", x.grant, "de")).toMatch(/Bedarf/);
    expect(draftExplanation(x, "rejected", 0, "en")).toMatch(/no funding/);
  });
});
