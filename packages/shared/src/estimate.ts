import { isEurope, isEuOrCh, surchargePercent } from "./countries.js";
import { buildFacts } from "./facts.js";
import type { Application, Estimate } from "./types.js";

/** Statutory amounts (BAföG §§ 13, 13a, 25; AuslandszuschlagsV). Source links are in docs/bafoeg-rules-sources.md. */
export const AMOUNTS = {
  base: 475,
  housing: 380,
  healthStatutory: 102,
  careStatutory: 35,
  healthVoluntary: 185,
  careVoluntary: 48,
  allowanceMarried: 2540,
  allowanceSingle: 1690,
  allowancePerChild: 770,
  creditFreePercent: 50,
  creditFreePerChild: 5,
  travelEurope: 250,
  travelElsewhere: 500,
  tuitionCap: 5600,
  /** Simplified lump sum for social security and taxes when deriving net income. ILLUSTRATIVE. */
  deductionPercent: 21.5,
};

const round10 = (n: number) => Math.round(n / 10) * 10;

export interface ParentIncome {
  netMonthly: number;
  married: boolean;
  siblings: number;
}

/** Parents' monthly contribution under the simplified rules. */
export function parentContribution(p: ParentIncome): number {
  const allowance = (p.married ? AMOUNTS.allowanceMarried : AMOUNTS.allowanceSingle) + AMOUNTS.allowancePerChild * p.siblings;
  const excess = Math.max(0, p.netMonthly - allowance);
  const countable = 1 - (AMOUNTS.creditFreePercent + AMOUNTS.creditFreePerChild * p.siblings) / 100;
  return Math.round((excess * Math.max(0, countable)) / (1 + p.siblings));
}

export function netMonthlyFromTax(sumOfIncome: number, incomeTax: number): number {
  return Math.max(0, (sumOfIncome - incomeTax - (sumOfIncome * AMOUNTS.deductionPercent) / 100) / 12);
}

export function monthlyNeed(country: string, insurance: "statutory" | "voluntary" = "statutory") {
  const health = insurance === "statutory" ? AMOUNTS.healthStatutory + AMOUNTS.careStatutory : AMOUNTS.healthVoluntary + AMOUNTS.careVoluntary;
  const surcharge = Math.round(((AMOUNTS.base + AMOUNTS.housing) * surchargePercent(country)) / 100);
  return {
    parts: [
      { key: "base", amount: AMOUNTS.base },
      { key: "housing", amount: AMOUNTS.housing },
      { key: "health", amount: health },
      ...(surcharge > 0 ? [{ key: "surcharge", amount: surcharge }] : []),
    ],
    total: AMOUNTS.base + AMOUNTS.housing + health + surcharge,
  };
}

/** A NON-BINDING estimate. Always shown as "likely"; the caseworker decides. */
export function estimate(app: Pick<Application, "stay" | "documents" | "parents" | "student">, now: Date = new Date()): Estimate {
  const facts = buildFacts(app, now);
  const need = monthlyNeed(app.stay.country, facts.docs.health_insurance.fields.insurance_type === "freiwillig" ? "voluntary" : "statutory");
  const tax = facts.docs.parent_tax;
  const form = facts.docs.parent_form;
  const sum = Number(tax.fields.sum_of_income);
  const incomeTax = Number(tax.fields.income_tax);
  // A value that could not be read (for example "5?000") counts as unknown until a person has corrected it.
  const known = tax.present && form.present && Number.isFinite(sum) && Number.isFinite(incomeTax);
  const contribution = known
    ? parentContribution({
        netMonthly: netMonthlyFromTax(sum, incomeTax),
        married: form.fields.parents_married !== "Nein",
        siblings: Number(form.fields.siblings_in_education ?? 0) || 0,
      })
    : 0;
  let grant = Math.max(0, need.total - contribution);
  if (grant < 10) grant = 0;
  const months = Math.max(1, Math.round(facts.stay.weeks / 4.345));
  const travelEach = isEurope(app.stay.country) ? AMOUNTS.travelEurope : AMOUNTS.travelElsewhere;
  const notes = ["est.note.nonBinding", "est.note.loan", "est.note.illustrative"];
  if (!known) notes.unshift("est.note.provisional");
  if (isEuOrCh(app.stay.country)) notes.push("est.note.noSurcharge");
  return {
    provisional: !known,
    months,
    need: need.total,
    monthly: round10(grant),
    low: round10(grant * 0.93),
    high: Math.min(round10(need.total), round10(grant * 1.07 + 10)),
    parts: need.parts,
    parentContribution: contribution,
    oneOff: {
      travel: travelEach * 2,
      tuition: app.stay.type === "study" ? Math.min(app.stay.tuitionFees, AMOUNTS.tuitionCap) : 0,
    },
    notes,
  };
}
