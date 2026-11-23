import { evaluateRule } from "./check.js";
import { AMOUNTS, estimate } from "./estimate.js";
import { REQUIRED_DOCS, buildFacts } from "./facts.js";
import { RULES } from "./rules.js";
import type { Application, Bilingual } from "./types.js";

/**
 * The decision as a tree: the questions the rules ask about a case, in order, and where each answer leads.
 * Every office uses the same tree, because it is federal law. A process only calls it ("run approved rules") and carries on with the outcome.
 * The tree is a picture of what the code does: the walk below uses the same functions as the checks and the estimate.
 */
export type TreeOutcome = "approved" | "rejected" | "ask" | "review";

export interface TreeQuestion {
  id: string;
  kind: "question";
  question: Bilingual;
  /** What is looked at, in a few words. */
  looksAt: Bilingual;
  source: { label: string; url: string };
  /** The rules (by id) whose result feeds this question. Questions that rest on the funding calculation list none. */
  rules: string[];
  yes: string;
  no: string;
}

export interface TreeLeaf {
  id: string;
  kind: "leaf";
  outcome: TreeOutcome;
  label: Bilingual;
  detail: Bilingual;
}

export type TreeNode = TreeQuestion | TreeLeaf;

const b = (de: string, en: string): Bilingual => ({ de, en });
const G = "https://www.gesetze-im-internet.de";

export const DECISION_TREE: { start: string; nodes: TreeNode[] } = {
  start: "docs",
  nodes: [
    {
      id: "docs", kind: "question", rules: ["R-READABLE", "R-FORM-SIGNED", "R-ENROLL", "R-HOST-CONFIRM", "R-HOST-PERIOD", "R-INTERN-CONTRACT", "R-INTERN-UNI", "R-PARENT-FORM", "R-HEALTH", "R-HEALTH-ABROAD", "R-TUITION-WAIVER"], yes: "stay", no: "ask-docs",
      question: b("Sind alle nötigen Unterlagen da und lesbar?", "Are all required documents there and readable?"),
      looksAt: b("Unterlagen des Antrags", "Documents of the application"),
      source: { label: "§ 46 BAföG", url: `${G}/baf_g/__46.html` },
    },
    {
      id: "stay", kind: "question", rules: ["R-MIN-STUDY", "R-MIN-INTERN"], yes: "income", no: "no-stay",
      question: b("Ist der Aufenthalt lang genug?", "Is the stay long enough?"),
      looksAt: b("Dauer in Wochen", "Length in weeks"),
      source: { label: "§ 5 BAföG", url: `${G}/baf_g/__5.html` },
    },
    {
      id: "income", kind: "question", rules: ["R-PARENT-TAX", "R-PARENT-YEAR"], yes: "assets", no: "check-income",
      question: b("Ist das Einkommen der Eltern sicher gelesen?", "Is the parents' income read with certainty?"),
      looksAt: b("Steuerbescheid der Eltern", "Parents' tax notice"),
      source: { label: "§ 21 BAföG", url: `${G}/baf_g/__21.html` },
    },
    {
      id: "assets", kind: "question", rules: [], yes: "no-assets", no: "need",
      question: b("Liegt das Vermögen der Person über dem Freibetrag?", "Are the student's assets above the allowance?"),
      looksAt: b("Vermögen laut Antrag", "Assets stated in the application"),
      source: { label: "§ 29 BAföG", url: `${G}/baf_g/__29.html` },
    },
    {
      id: "need", kind: "question", rules: ["R-TUITION-CAP"], yes: "no-need", no: "grant",
      question: b("Deckt der Beitrag der Eltern den ganzen Bedarf?", "Does the parents' contribution cover the whole need?"),
      looksAt: b("Bedarf und Elternbeitrag pro Monat", "Need and parents' contribution per month"),
      source: { label: "§§ 11, 25 BAföG", url: `${G}/baf_g/__25.html` },
    },
    { id: "ask-docs", kind: "leaf", outcome: "ask", label: b("Unterlagen nachfordern", "Ask for the documents"), detail: b("Der Fall ist noch nicht entscheidbar. Die Person wird um die fehlenden Unterlagen gebeten.", "The case cannot be decided yet. The applicant is asked for what is missing.") },
    { id: "no-stay", kind: "leaf", outcome: "rejected", label: b("Abgelehnt: Aufenthalt zu kurz", "Rejected: stay too short"), detail: b("Die Mindestdauer ist nicht erreicht.", "The minimum length is not reached.") },
    { id: "check-income", kind: "leaf", outcome: "review", label: b("Prüfung durch die Sachbearbeitung", "A caseworker checks the values"), detail: b("Ein Wert im Steuerbescheid ist unklar. Eine Person bestätigt ihn, dann läuft der Baum weiter.", "A value on the tax notice is unclear. A person confirms it, then the tree carries on.") },
    { id: "no-assets", kind: "leaf", outcome: "rejected", label: b("Abgelehnt: Vermögen über dem Freibetrag", "Rejected: assets above the allowance"), detail: b("Vereinfacht im Prototyp: Das Vermögen über dem Freibetrag beendet die Prüfung. Im Gesetz wird es auf den Bedarf angerechnet.", "Simplified in the prototype: assets above the allowance end the check. In the law, they are counted against the need.") },
    { id: "no-need", kind: "leaf", outcome: "rejected", label: b("Abgelehnt: Elternbeitrag deckt den Bedarf", "Rejected: parents' contribution covers the need"), detail: b("Das angerechnete Einkommen der Eltern ist so hoch wie der Bedarf. Förderung wird nicht gezahlt.", "The income counted from the parents is as high as the need. No funding is paid.") },
    { id: "grant", kind: "leaf", outcome: "approved", label: b("Bewilligt", "Approved"), detail: b("Der Bedarf wird nicht ganz gedeckt. Die Differenz wird als Förderung gezahlt.", "The need is not fully covered. The difference is paid as funding.") },
  ],
};

export interface TreeStep {
  id: string;
  answer: "yes" | "no";
  /** The value the answer rests on, as text. */
  value: Bilingual;
}

export interface TreeWalk {
  steps: TreeStep[];
  leaf: string;
  outcome: TreeOutcome;
  /** The monthly funding when the walk ends in "approved". */
  monthly: number;
}

type Input = Pick<Application, "stay" | "documents" | "parents" | "student"> & { info?: Record<string, string> };

const eur = (n: number) => `${Math.round(n).toLocaleString("en-GB")} €`;
const eurDe = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;
const money = (n: number): Bilingual => ({ de: eurDe(n), en: eur(n) });

/** Walks one case through the tree. Pure: the same case gives the same path. */
export function walkDecisionTree(app: Input, now: Date = new Date()): TreeWalk {
  const facts = buildFacts(app, now);
  const est = estimate(app, now);
  const steps: TreeStep[] = [];
  const ask = (id: string, answer: boolean, value: Bilingual) => { steps.push({ id, answer: answer ? "yes" : "no", value }); return answer; };

  const needed = REQUIRED_DOCS[app.stay.type === "internship" ? "internship" : "study"];
  const present = needed.filter((k) => facts.docs[k]?.present).length;
  const docsOk = present === needed.length && facts.unreadableCount === 0;
  const unreadable = facts.unreadableCount;
  const docsValue = b(
    `${present} von ${needed.length} Unterlagen da${unreadable ? `, ${unreadable} unlesbar` : ""}`,
    `${present} of ${needed.length} documents there${unreadable ? `, ${unreadable} unreadable` : ""}`,
  );
  if (!ask("docs", docsOk, docsValue)) return end("ask-docs");

  const minWeeks = app.stay.type === "internship" ? 12 : facts.stay.isEU ? 0 : 26;
  const rule = RULES.find((r) => r.id === (app.stay.type === "internship" ? "R-MIN-INTERN" : "R-MIN-STUDY"));
  const stayOk = rule ? evaluateRule(rule, facts) !== "fail" : true;
  const weeks = facts.stay.weeks;
  if (!ask("stay", stayOk, b(`${weeks} Wochen${minWeeks ? ` (mindestens ${minWeeks})` : " (keine Mindestdauer)"}`, `${weeks} weeks${minWeeks ? ` (minimum ${minWeeks})` : " (no minimum)"}`))) return end("no-stay");

  const incomeOk = !est.provisional;
  const taxFields = facts.docs.parent_tax.fields;
  const sum = Number(taxFields.sum_of_income);
  if (!ask("income", incomeOk, incomeOk ? b(`Einkünfte ${eurDe(sum)}, Steuer ${eurDe(Number(taxFields.income_tax))}`, `Income ${eur(sum)}, tax ${eur(Number(taxFields.income_tax))}`) : b("ein Wert ist unklar oder fehlt", "a value is unclear or missing"))) return end("check-income");

  const rawAssets = facts.docs.application_form.fields.assets;
  const assets = rawAssets === undefined || rawAssets === "" ? null : Number(rawAssets);
  const assetsKnown = assets !== null && Number.isFinite(assets);
  const assetsOver = assetsKnown && (assets as number) > AMOUNTS.assetAllowance;
  if (ask("assets", assetsOver, assetsKnown ? b(`${eurDe(assets as number)} (Freibetrag ${eurDe(AMOUNTS.assetAllowance)})`, `${eur(assets as number)} (allowance ${eur(AMOUNTS.assetAllowance)})`) : b(`nicht angegeben (Freibetrag ${eurDe(AMOUNTS.assetAllowance)})`, `not stated (allowance ${eur(AMOUNTS.assetAllowance)})`))) return end("no-assets");

  const covers = est.parentContribution >= est.need;
  ask("need", covers, b(`Bedarf ${eurDe(est.need)}, Elternbeitrag ${eurDe(est.parentContribution)}`, `Need ${eur(est.need)}, parents' contribution ${eur(est.parentContribution)}`));
  return end(covers ? "no-need" : "grant");

  function end(leaf: string): TreeWalk {
    const node = DECISION_TREE.nodes.find((n) => n.id === leaf) as TreeLeaf;
    return { steps, leaf, outcome: node.outcome, monthly: node.outcome === "approved" ? est.monthly : 0 };
  }
}

export { money as treeMoney };
