/**
 * The JSON picker: a person looks at a real answer of a system, ticks the fields needed, and these paths
 * are what the process runs, every time, to take exactly those fields out of the answer.
 * A path reads like code: data.rates[0].usd  or  items[*].name  (every item: a list).
 */

export type JsonPickType = "text" | "number" | "list" | "yesno";

export interface JsonPick {
  /** The name of the output this field becomes, for example "rate". */
  name: string;
  /** Where the field is in the answer, for example "data.rates[0].usd". */
  path: string;
  type: JsonPickType;
}

export interface JsonLeaf {
  path: string;
  /** What is there: a value, an object, or a list. */
  kind: "string" | "number" | "boolean" | "null" | "object" | "array";
  sample: string;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const key = (k: string) => (IDENT.test(k) ? k : `["${k.replace(/"/g, '\\"')}"]`);
const join = (base: string, k: string) => (k.startsWith("[") ? `${base}${k}` : base ? `${base}.${k}` : k);

/** Every field of a JSON value with its path, depth first. Lists are shown with their first item only, and as "[*]" for all of them. */
export function listPaths(value: unknown, base = "", depth = 0, out: JsonLeaf[] = []): JsonLeaf[] {
  if (depth > 8) return out;
  if (Array.isArray(value)) {
    if (base) out.push({ path: base, kind: "array", sample: `${value.length} item${value.length === 1 ? "" : "s"}` });
    if (value.length) listPaths(value[0], `${base}[0]`, depth + 1, out);
    return out;
  }
  if (value && typeof value === "object") {
    if (base) out.push({ path: base, kind: "object", sample: "{…}" });
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) listPaths(v, join(base, key(k)), depth + 1, out);
    return out;
  }
  out.push({ path: base, kind: value === null ? "null" : (typeof value as "string" | "number" | "boolean"), sample: value === null ? "null" : String(value).slice(0, 80) });
  return out;
}

type Step = { k: "key"; v: string } | { k: "index"; v: number } | { k: "all" };

/** A path as steps: data.items[0]["a b"] and items[*]. Throws on a path that is not well formed. */
export function parsePath(path: string): Step[] {
  const steps: Step[] = [];
  let i = 0;
  const p = path.trim();
  while (i < p.length) {
    const c = p[i]!;
    if (c === ".") {
      i++;
      continue;
    }
    if (c === "[") {
      const close = p.indexOf("]", i);
      if (close < 0) throw new Error(`The path “${path}” has a “[” without a “]”.`);
      const inner = p.slice(i + 1, close).trim();
      if (inner === "*") steps.push({ k: "all" });
      else if (/^\d+$/.test(inner)) steps.push({ k: "index", v: Number(inner) });
      else if (/^".*"$/.test(inner)) steps.push({ k: "key", v: inner.slice(1, -1).replace(/\\"/g, '"') });
      else throw new Error(`The path “${path}” has “[${inner}]”. Use a number, * or a quoted name.`);
      i = close + 1;
      continue;
    }
    const m = /^[^.[\]]+/.exec(p.slice(i));
    if (!m) throw new Error(`The path “${path}” is not valid.`);
    steps.push({ k: "key", v: m[0] });
    i += m[0].length;
  }
  return steps;
}

/** The value at a path. undefined when it is not there. "[*]" collects every item into a list. */
export function getJsonPath(value: unknown, path: string): unknown {
  const walk = (v: unknown, steps: Step[]): unknown => {
    if (steps.length === 0) return v;
    const [s, ...rest] = steps;
    if (s!.k === "key") return v && typeof v === "object" && !Array.isArray(v) && s!.v in (v as object) ? walk((v as Record<string, unknown>)[s!.v], rest) : undefined;
    if (s!.k === "index") return Array.isArray(v) && s!.v < v.length ? walk(v[s!.v], rest) : undefined;
    if (!Array.isArray(v)) return undefined;
    return v.map((x) => walk(x, rest)).filter((x) => x !== undefined);
  };
  return walk(value, parsePath(path));
}

/** The type a picked value gets as an output. */
export function pickTypeOf(v: unknown, path: string): JsonPickType {
  if (path.includes("[*]") || Array.isArray(v)) return "list";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "yesno";
  return "text";
}

/** A value as the text an output holds: lists as lines with bullets, yes/no as yes/no. */
export function pickText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map((x) => `• ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join("\n");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** An output name from the last part of a path: "data.rates[0].usd" becomes "usd". */
export function suggestName(path: string, taken: string[]): string {
  const last = [...parsePath(path)].reverse().find((s) => s.k === "key");
  const base = (last?.k === "key" ? last.v : "value").replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "value";
  const safe = /^[a-z]/.test(base) ? base : `v_${base}`;
  const used = new Set(taken);
  if (!used.has(safe)) return safe;
  for (let i = 2; ; i++) if (!used.has(`${safe}_${i}`)) return `${safe}_${i}`;
}

export function parsePicks(raw: unknown): JsonPick[] {
  try {
    const v = JSON.parse(String(raw || "[]")) as unknown;
    return Array.isArray(v) ? v.filter((p): p is JsonPick => Boolean(p) && typeof (p as JsonPick).name === "string" && typeof (p as JsonPick).path === "string").map((p) => ({ name: p.name, path: p.path, type: p.type ?? "text" })) : [];
  } catch {
    return [];
  }
}

/** The code the picker writes for a pick, as a person would write it by hand. Shown next to the field. */
export const pickCode = (p: JsonPick): string => `response.${p.path}`;

/** Takes the picked fields out of an answer. Throws a clear message when one is missing. */
export function extractPicks(body: unknown, picks: JsonPick[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of picks) {
    const v = getJsonPath(body, p.path);
    if (v === undefined) throw new Error(`The field “${p.path}” is not in the answer of the system. It may have changed.`);
    out[p.name] = pickText(v);
  }
  return out;
}
