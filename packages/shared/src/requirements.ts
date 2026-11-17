import { buildFacts, type Facts } from "./facts.js";
import { evaluate } from "./engine.js";
import type { InputCondition, ProcessInput } from "./process.js";
import { BUILTIN_TEMPLATES } from "./templates.js";
import type { Application, Bilingual, DocumentTemplate, Requirement } from "./types.js";

/** Information the application form collects anyway. A process can require it, so offices can compare what they ask for. */
export const KNOWN_INFO: { key: string; label: Bilingual }[] = [
  { key: "country", label: { de: "Zielland", en: "Destination country" } },
  { key: "city", label: { de: "Stadt", en: "City" } },
  { key: "institution", label: { de: "Gasthochschule oder Praktikumsstelle", en: "Host university or organisation" } },
  { key: "startDate", label: { de: "Beginn des Aufenthalts", en: "Start of the stay" } },
  { key: "endDate", label: { de: "Ende des Aufenthalts", en: "End of the stay" } },
  { key: "tuitionFees", label: { de: "Studiengebühren", en: "Tuition fees" } },
  { key: "parentEmail", label: { de: "E-Mail der Eltern", en: "Parent's e-mail" } },
];

export const knownInfoLabel = (key: string) => KNOWN_INFO.find((k) => k.key === key)?.label;

function knownValue(app: Pick<Application, "stay" | "parents">, key: string): string {
  switch (key) {
    case "country": return app.stay.country;
    case "city": return app.stay.city;
    case "institution": return app.stay.institution;
    case "startDate": return app.stay.startDate;
    case "endDate": return app.stay.endDate;
    case "tuitionFees": return String(app.stay.tuitionFees ?? "");
    case "parentEmail": return app.parents.email;
    default: return "";
  }
}

export function conditionApplies(when: InputCondition | undefined, facts: Facts): boolean {
  if (!when) return true;
  if (when.kind === "stay_type") return facts.stay.type === when.value;
  if (when.kind === "tuition") return facts.stay.hasTuition;
  return evaluate({ eq: [{ ref: `info.${when.key}` }, when.equals] }, facts);
}

export function describeCondition(when: InputCondition | undefined): Bilingual {
  if (!when) return { de: "immer", en: "always" };
  if (when.kind === "stay_type") return when.value === "study" ? { de: "nur bei Studium", en: "study only" } : { de: "nur bei Praktikum", en: "internship only" };
  if (when.kind === "tuition") return { de: "nur mit Studiengebühren", en: "only with tuition fees" };
  return { de: `wenn „${when.key}“ = ${when.equals}`, en: `if “${when.key}” = ${when.equals}` };
}

/** Evaluates the inputs of a process for one application: which apply, and which are provided. */
export function computeRequirements(
  inputs: ProcessInput[],
  app: Pick<Application, "stay" | "documents" | "parents" | "student"> & { info?: Record<string, string> },
  templates: DocumentTemplate[] = BUILTIN_TEMPLATES,
  now: Date = new Date(),
): Requirement[] {
  const facts = buildFacts(app, now);
  return inputs.map((i) => {
    const applies = conditionApplies(i.when, facts);
    if (i.type === "document") {
      const t = templates.find((x) => x.id === i.ref);
      return {
        id: i.id, type: "document", ref: i.ref, label: t?.name ?? { de: i.ref, en: i.ref }, required: i.required, applies,
        state: facts.docs[i.ref]?.present ? "ok" : "missing", providedBy: t?.providedBy ?? "student",
      };
    }
    const known = knownInfoLabel(i.ref);
    const value = known ? knownValue(app, i.ref) : (app.info?.[i.ref] ?? "");
    return {
      id: i.id, type: "info", ref: i.ref, label: known ?? i.question?.label ?? { de: i.ref, en: i.ref }, required: i.required, applies,
      state: value.trim() !== "" ? "ok" : "missing", providedBy: "student",
      ...(i.question && !known ? { question: { type: i.question.type, help: i.question.help } } : {}),
    };
  });
}
