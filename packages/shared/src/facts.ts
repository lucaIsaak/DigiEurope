import { isEuOrCh } from "./countries.js";
import { daysBetween, isoDate, parseDate } from "./dates.js";
import type { Application, DocumentKind } from "./types.js";
import { DOCUMENT_KINDS } from "./types.js";

/** Flattens an application into the facts the rules look at. Pure and deterministic. */
export function buildFacts(app: Pick<Application, "stay" | "documents" | "parents" | "student"> & { info?: Record<string, string> }, now: Date = new Date()) {
  const start = parseDate(app.stay.startDate);
  const end = parseDate(app.stay.endDate);
  const weeks = start && end ? Math.round((daysBetween(start, end) / 7) * 10) / 10 : 0;
  const docs: Record<string, { present: boolean; fields: Record<string, string>; sig: Record<string, boolean> }> = {};
  let unreadableCount = 0;
  const unreadable: string[] = [];
  for (const kind of new Set<string>([...DOCUMENT_KINDS, ...app.documents.map((d) => d.kind)])) {
    const list = app.documents.filter((d) => d.kind === kind);
    const readable = [...list].reverse().find((d) => d.extraction.readable);
    docs[kind] = readable
      ? { present: true, fields: readable.extraction.fields, sig: readable.extraction.signatures }
      : { present: false, fields: {}, sig: {} };
  }
  for (const d of app.documents) if (!d.extraction.readable) {
    unreadableCount += 1;
    unreadable.push(d.filename);
  }
  return {
    today: isoDate(now),
    stay: {
      type: app.stay.type,
      country: app.stay.country,
      isEU: isEuOrCh(app.stay.country),
      startDate: app.stay.startDate,
      endDate: app.stay.endDate,
      weeks,
      tuitionFees: app.stay.tuitionFees,
      hasTuition: app.stay.tuitionFees > 0,
    },
    daysUntilStart: start ? daysBetween(now, start) : 0,
    incomeYearRequired: start ? start.getUTCFullYear() - 2 : 0,
    unreadableCount,
    unreadable: unreadable.join(", "),
    info: app.info ?? ({} as Record<string, string>),
    docs,
  };
}

export type Facts = ReturnType<typeof buildFacts>;

/** An "everything is fine" fact set used as the starting point of rule tests. */
export function baselineFacts(): Facts {
  const d = (fields: Record<string, string> = {}, sig: Record<string, boolean> = {}) => ({ present: true, fields, sig });
  const docs = Object.fromEntries(DOCUMENT_KINDS.map((k) => [k, d()])) as unknown as Facts["docs"];
  docs.application_form = d({ name: "Test Student" }, { student: true });
  docs.host_confirmation = d({ period_from: "2027-02-01", period_to: "2027-08-15" }, { host: true });
  docs.internship_contract = d({}, { intern: true, employer: true });
  docs.internship_uni_confirmation = d({ mandatory: "Ja" }, { university: true });
  docs.health_insurance = d({ insurance_type: "gesetzlich", covers_abroad: "Ja" });
  docs.parent_form = d({ parents_married: "Ja", siblings_in_education: "0" }, { parent: true });
  docs.parent_tax = d({ tax_year: "2025", sum_of_income: "52000", income_tax: "6000" });
  docs.fb06 = d({}, { student: true });
  return {
    today: "2026-11-16",
    stay: { type: "study", country: "CA", isEU: false, startDate: "2027-02-01", endDate: "2027-08-15", weeks: 28, tuitionFees: 0, hasTuition: false },
    daysUntilStart: 120,
    incomeYearRequired: 2025,
    unreadableCount: 0,
    unreadable: "",
    info: {} as Record<string, string>,
    docs,
  };
}

export const REQUIRED_DOCS: Record<"study" | "internship", DocumentKind[]> = {
  study: ["application_form", "enrollment_cert", "host_confirmation", "health_insurance", "parent_form", "parent_tax"],
  internship: ["application_form", "enrollment_cert", "internship_contract", "internship_uni_confirmation", "health_insurance", "parent_form", "parent_tax"],
};
