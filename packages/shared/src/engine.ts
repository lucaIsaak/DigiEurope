import type { Check, Operand, Rule } from "./types.js";

/** Reads a dotted path out of a nested object. */
export function getPath(facts: unknown, path: string): unknown {
  let cur: unknown = facts;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function value(op: Operand, facts: unknown): unknown {
  return op !== null && typeof op === "object" && "ref" in op ? getPath(facts, op.ref) : op;
}

function compare(a: unknown, b: unknown): number | null {
  if (a === undefined || a === null || b === undefined || b === null || a === "" || b === "") return null;
  const numeric = (x: unknown) => typeof x === "number" || (typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x));
  if (numeric(a) && numeric(b)) return Number(a) - Number(b);
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0; // ISO dates compare as strings
  return null;
}

/** Deterministic evaluation of a rule check. No AI, no randomness, no I/O. */
export function evaluate(check: Check, facts: unknown): boolean {
  if ("all" in check) return check.all.every((c) => evaluate(c, facts));
  if ("any" in check) return check.any.some((c) => evaluate(c, facts));
  if ("not" in check) return !evaluate(check.not, facts);
  if ("eq" in check) {
    const [a, b] = check.eq;
    const va = value(a, facts);
    const vb = value(b, facts);
    return va !== undefined && va !== null && String(va) === String(vb);
  }
  if ("gte" in check) {
    const c = compare(value(check.gte[0], facts), value(check.gte[1], facts));
    return c !== null && c >= 0;
  }
  if ("lte" in check) {
    const c = compare(value(check.lte[0], facts), value(check.lte[1], facts));
    return c !== null && c <= 0;
  }
  if ("in" in check) {
    const v = value(check.in[0], facts);
    return check.in[1].some((o) => String(value(o, facts)) === String(v));
  }
  const v = value(check.truthy, facts);
  return v !== undefined && v !== null && v !== false && v !== "" && v !== 0;
}

/** Plain-language rendering of a check, shown next to the rule text so reviewers can see what will run. */
export function describeCheck(check: Check): string {
  const op = (o: Operand) => (o !== null && typeof o === "object" && "ref" in o ? o.ref : JSON.stringify(o));
  if ("all" in check) return check.all.map(describeCheck).map((s) => `(${s})`).join(" AND ");
  if ("any" in check) return check.any.map(describeCheck).map((s) => `(${s})`).join(" OR ");
  if ("not" in check) return `NOT (${describeCheck(check.not)})`;
  if ("eq" in check) return `${op(check.eq[0])} = ${op(check.eq[1])}`;
  if ("gte" in check) return `${op(check.gte[0])} >= ${op(check.gte[1])}`;
  if ("lte" in check) return `${op(check.lte[0])} <= ${op(check.lte[1])}`;
  if ("in" in check) return `${op(check.in[0])} IN [${check.in[1].map(op).join(", ")}]`;
  return `${op(check.truthy)} is present`;
}

export function interpolate(text: string, facts: unknown): string {
  return text.replace(/\{([\w.]+)\}/g, (_, p: string) => {
    const v = getPath(facts, p);
    return v === undefined || v === null ? `{${p}}` : String(v);
  });
}

function mergeDeep(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b)
        ? mergeDeep(b as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

export interface TestOutcome {
  name: string;
  expectPass: boolean;
  actualPass: boolean;
  ok: boolean;
}

/** Runs the sample cases of a rule against its executable check. `baseline` is an all-good fact set. */
export function runRuleTests(rule: Rule, baseline: Record<string, unknown>): TestOutcome[] {
  return rule.tests.map((t) => {
    const facts = mergeDeep(baseline, t.facts);
    const applies = rule.when ? evaluate(rule.when, facts) : true;
    const actualPass = applies ? evaluate(rule.pass, facts) : true;
    return { name: t.name, expectPass: t.expectPass, actualPass, ok: actualPass === t.expectPass };
  });
}
