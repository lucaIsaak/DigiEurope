import type { Check, Operand } from "./types.js";
import type { Bilingual, DocumentTemplate } from "./types.js";

/** One line of the no-code rule editor: "[fact] [operator] [value or other fact]". */
export type CondOp = "present" | "absent" | "eq" | "ne" | "gte" | "lte";
export interface Condition {
  path: string;
  op: CondOp;
  /** A fixed value, or `valueRef` to compare with another fact. */
  value?: string;
  valueRef?: string;
}

export type FactType = "bool" | "text" | "number" | "date" | "yesno" | "stayType";
export interface Fact {
  path: string;
  label: Bilingual;
  group: Bilingual;
  type: FactType;
}

const literal = (v: string | undefined): Operand => (v !== undefined && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v ?? "");

/** Turns editor lines into the fixed check that runs. All lines must hold. */
export function toCheck(conds: Condition[]): Check | undefined {
  const one = (c: Condition): Check => {
    const right: Operand = c.valueRef ? { ref: c.valueRef } : literal(c.value);
    switch (c.op) {
      case "present": return { truthy: { ref: c.path } };
      case "absent": return { not: { truthy: { ref: c.path } } };
      case "eq": return { eq: [{ ref: c.path }, right] };
      case "ne": return { not: { eq: [{ ref: c.path }, right] } };
      case "gte": return { gte: [{ ref: c.path }, right] };
      case "lte": return { lte: [{ ref: c.path }, right] };
    }
  };
  if (conds.length === 0) return undefined;
  return conds.length === 1 ? one(conds[0]!) : { all: conds.map(one) };
}

const refOf = (o: Operand): string | undefined => (o !== null && typeof o === "object" && "ref" in o ? o.ref : undefined);
const valOf = (o: Operand): Pick<Condition, "value" | "valueRef"> => (refOf(o) ? { valueRef: refOf(o) } : { value: String(o) });

/** Reads a check back into editor lines. Returns null for shapes the editor cannot show (for example "any of"). */
export function fromCheck(check: Check | undefined): Condition[] | null {
  if (!check) return [];
  const one = (c: Check): Condition | null => {
    if ("truthy" in c) return refOf(c.truthy) ? { path: refOf(c.truthy)!, op: "present" } : null;
    if ("not" in c) {
      const inner = c.not;
      if ("truthy" in inner && refOf(inner.truthy)) return { path: refOf(inner.truthy)!, op: "absent" };
      if ("eq" in inner && refOf(inner.eq[0])) return { path: refOf(inner.eq[0])!, op: "ne", ...valOf(inner.eq[1]) };
      return null;
    }
    if ("eq" in c && refOf(c.eq[0])) return { path: refOf(c.eq[0])!, op: "eq", ...valOf(c.eq[1]) };
    if ("gte" in c && refOf(c.gte[0])) return { path: refOf(c.gte[0])!, op: "gte", ...valOf(c.gte[1]) };
    if ("lte" in c && refOf(c.lte[0])) return { path: refOf(c.lte[0])!, op: "lte", ...valOf(c.lte[1]) };
    return null;
  };
  const list = "all" in check ? check.all : [check];
  const out: Condition[] = [];
  for (const c of list) {
    const x = one(c);
    if (!x) return null;
    out.push(x);
  }
  return out;
}

const b = (de: string, en: string): Bilingual => ({ de, en });

/** Everything a rule can look at, with readable names. Built from the templates, so new forms appear automatically. */
export function factCatalog(templates: DocumentTemplate[]): Fact[] {
  const stay = b("Aufenthalt", "Stay");
  const general = b("Allgemein", "General");
  const facts: Fact[] = [
    { path: "stay.type", label: b("Art des Aufenthalts", "Type of stay"), group: stay, type: "stayType" },
    { path: "stay.weeks", label: b("Dauer in Wochen", "Length in weeks"), group: stay, type: "number" },
    { path: "stay.isEU", label: b("In EU oder Schweiz", "In the EU or Switzerland"), group: stay, type: "bool" },
    { path: "stay.hasTuition", label: b("Studiengebühren angegeben", "Tuition fees entered"), group: stay, type: "bool" },
    { path: "stay.tuitionFees", label: b("Studiengebühren (€)", "Tuition fees (€)"), group: stay, type: "number" },
    { path: "stay.startDate", label: b("Beginn", "Start"), group: stay, type: "date" },
    { path: "stay.endDate", label: b("Ende", "End"), group: stay, type: "date" },
    { path: "daysUntilStart", label: b("Tage bis zum Beginn", "Days until the start"), group: general, type: "number" },
    { path: "incomeYearRequired", label: b("Benötigtes Einkommensjahr", "Income year needed"), group: general, type: "number" },
    { path: "unreadableCount", label: b("Nicht lesbare Dateien", "Unreadable files"), group: general, type: "number" },
  ];
  for (const t of templates) {
    facts.push({ path: `docs.${t.id}.present`, label: b(`${t.name.de}: hochgeladen`, `${t.name.en}: uploaded`), group: t.name, type: "bool" });
    for (const f of t.fields) facts.push({ path: `docs.${t.id}.fields.${f.key}`, label: b(`${t.name.de} › ${f.label}`, `${t.name.en} › ${f.label}`), group: t.name, type: f.type === "yesno" ? "yesno" : f.type });
    for (const s of t.signatures) facts.push({ path: `docs.${t.id}.sig.${s.key}`, label: b(`${t.name.de} › ${s.label}: unterschrieben`, `${t.name.en} › ${s.label}: signed`), group: t.name, type: "bool" });
  }
  return facts;
}

const OPS: Record<CondOp, Bilingual> = {
  present: b("ist vorhanden", "is present"),
  absent: b("fehlt", "is missing"),
  eq: b("ist", "is"),
  ne: b("ist nicht", "is not"),
  gte: b("ist mindestens", "is at least"),
  lte: b("ist höchstens", "is at most"),
};
export const opLabel = (op: CondOp) => OPS[op];

/** One readable sentence per line, for reviewers who do not read code. */
export function describeRuleCondition(c: Condition, facts: Fact[], lang: "de" | "en"): string {
  const name = (p: string) => facts.find((f) => f.path === p)?.label[lang] ?? p;
  const fact = facts.find((f) => f.path === c.path);
  if (fact?.type === "bool" && (c.op === "present" || c.op === "absent")) {
    return `${name(c.path)}: ${c.op === "present" ? (lang === "de" ? "ja" : "yes") : lang === "de" ? "nein" : "no"}`;
  }
  const right = c.valueRef ? name(c.valueRef) : c.value === undefined ? "" : `„${c.value}“`;
  return `${name(c.path)} ${OPS[c.op][lang]}${c.op === "present" || c.op === "absent" ? "" : ` ${right}`}`;
}
