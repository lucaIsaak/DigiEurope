import type { Bilingual } from "./types.js";

/**
 * Expressions inside the texts of a process.
 *
 * A function is written {=name|slot|slot}: its name, then one slot per parameter. A slot holds text, outputs of earlier
 * steps ({step.output}) and other functions, mixed freely. In a slot, \ | { } are written \\ \| \{ \} . Outside a function
 * a text is just text: only {=…} and {step.output} mean something.
 */

export type Value = string | number | boolean | string[];

export type Part =
  | { k: "text"; v: string }
  | { k: "ref"; raw: string; step?: string; name: string; format?: string }
  | { k: "call"; raw: string; name: string; slots: Part[][]; slotSrc: string[] };

export interface ParseResult {
  parts: Part[];
  errors: string[];
}

const REF_AT = /^\{([A-Za-z0-9_-]+)(?:\.([a-z_]+))?(?::([a-z]+))?\}/;

/** Reads parts from `src` starting at i. In a slot (inSlot) it stops at an unescaped | or }. */
function readParts(src: string, start: number, inSlot: boolean, errors: string[]): { parts: Part[]; end: number } {
  const parts: Part[] = [];
  let text = "";
  let i = start;
  const flush = () => {
    if (text) parts.push({ k: "text", v: text });
    text = "";
  };
  while (i < src.length) {
    const c = src[i]!;
    if (inSlot && c === "\\" && i + 1 < src.length) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (inSlot && (c === "|" || c === "}")) break;
    if (c === "{") {
      if (src[i + 1] === "=") {
        const callStart = i;
        i += 2;
        let name = "";
        while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) name += src[i++];
        const slots: Part[][] = [];
        const slotSrc: string[] = [];
        let closed = false;
        while (i < src.length) {
          if (src[i] === "}") {
            i += 1;
            closed = true;
            break;
          }
          if (src[i] === "|") {
            i += 1;
            const from = i;
            const r = readParts(src, i, true, errors);
            slots.push(r.parts);
            slotSrc.push(src.slice(from, r.end));
            i = r.end;
            continue;
          }
          errors.push(`Unexpected “${src[i]}” in the function “${name}”.`);
          i += 1;
        }
        if (!closed) errors.push(`The function “${name || "?"}” is not closed with }.`);
        flush();
        parts.push({ k: "call", raw: src.slice(callStart, i), name, slots, slotSrc });
        continue;
      }
      const m = REF_AT.exec(src.slice(i));
      if (m) {
        flush();
        parts.push(m[2] ? { k: "ref", raw: m[0], step: m[1]!, name: m[2], ...(m[3] ? { format: m[3] } : {}) } : { k: "ref", raw: m[0], name: m[1]!, ...(m[3] ? { format: m[3] } : {}) });
        i += m[0].length;
        continue;
      }
    }
    text += c;
    i += 1;
  }
  flush();
  return { parts, end: i };
}

/** The parts of a whole text: plain text, outputs of earlier steps and functions. */
export function parseText(src: string): ParseResult {
  const errors: string[] = [];
  const { parts } = readParts(src, 0, false, errors);
  return { parts, errors };
}

/** The parts of a slot's source text (where \ | { } are escaped). */
export function parseSlot(src: string): Part[] {
  return readParts(src, 0, true, []).parts;
}

/** The raw pieces of a text: plain text, or a tile ({step.output} or a whole {=function}). Used to draw tiles in a field. */
export function segmentsOf(src: string): { tile: boolean; raw: string }[] {
  return parseText(src).parts.map((p) => (p.k === "text" ? { tile: false, raw: p.v } : { tile: true, raw: p.raw }));
}

/** The name and the raw slot texts of one function, for editing. */
export function callOf(raw: string): { name: string; slots: string[] } | null {
  const p = parseText(raw).parts;
  const c = p[0];
  return p.length === 1 && c?.k === "call" ? { name: c.name, slots: c.slotSrc } : null;
}

/** Builds the stored text of a function from its name and slot texts. */
export const buildCall = (name: string, slots: string[]): string => `{=${name}${slots.map((s) => `|${s}`).join("")}}`;

/** Escapes a text typed into a slot. */
export const escapeSlot = (text: string): string => text.replace(/[\\|{}]/g, (c) => `\\${c}`);

// ---- Values -------------------------------------------------------------------------------

export const asText = (v: Value | undefined): string => {
  if (v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => `• ${x}`).join("\n");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e9) / 1e9);
  return v;
};

/** "1.234,56" and "1,234.56" and "12,5" all become numbers. */
export function parseNumber(text: string): number {
  let t = text.trim().replace(/[\s€$£%]/g, "");
  if (t === "") return NaN;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

export function asNumber(v: Value | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return v.length;
  const n = parseNumber(v ?? "");
  if (Number.isNaN(n)) throw new Error(`“${v ?? ""}” is not a number.`);
  return n;
}

export const asList = (v: Value | undefined, sep = "\n"): string[] => {
  if (Array.isArray(v)) return v;
  const t = asText(v);
  if (!t.trim()) return [];
  return t.split(sep).map((x) => x.replace(/^•\s*/, "").trim()).filter((x) => x !== "");
};

export const asBool = (v: Value | undefined): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  return !["", "no", "false", "0", "nein", "n"].includes((v ?? "").trim().toLowerCase());
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
};
const DAYS = { en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], de: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] };

/** Reads 2026-11-18, 18.11.2026 or 18/11/2026 as a date at noon UTC, so no time zone moves the day. */
export function asDate(v: Value | undefined): Date {
  const t = asText(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else throw new Error(`“${t}” is not a date.`);
  const out = new Date(Date.UTC(y, mo - 1, d, 12));
  if (Number.isNaN(out.getTime())) throw new Error(`“${t}” is not a date.`);
  return out;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ---- The functions ----------------------------------------------------------------------

export type FnCategory = "text" | "number" | "convert" | "date" | "list" | "logic" | "id";
export type ParamType = "text" | "number" | "list" | "bool" | "any" | "choice";
export type ReturnType = "text" | "number" | "list" | "date" | "yesno" | "any";

export interface FnParam {
  name: string;
  label: Bilingual;
  type: ParamType;
  options?: { value: string; label: Bilingual }[];
  /** Needed for the function to work. Others may stay empty. */
  required?: boolean;
  hint?: string;
}

export interface FnEnv {
  now: Date;
  lang: "de" | "en";
  /** A random value. "case": created once for each case and kept, so a rerun shows the same. "run": new every time the step runs. */
  random: (kind: "case" | "run", shape: string) => string;
}

export interface FnSpec {
  name: string;
  category: FnCategory;
  label: Bilingual;
  help: Bilingual;
  params: FnParam[];
  returns: ReturnType;
  example: string;
  run: (a: Value[], env: FnEnv) => Value;
}

const b = (de: string, en: string): Bilingual => ({ de, en });
const P = (name: string, de: string, en: string, type: ParamType = "text", required = true, hint?: string): FnParam => ({ name, label: b(de, en), type, required, ...(hint ? { hint } : {}) });
const choice = (name: string, de: string, en: string, opts: [string, string, string][]): FnParam => ({ name, label: b(de, en), type: "choice", required: true, options: opts.map(([value, d, e]) => ({ value, label: b(d, e) })) });
const S = (a: Value[], i: number, def = "") => (a[i] === undefined ? def : asText(a[i]));
const N = (a: Value[], i: number, def?: number) => (a[i] === undefined || asText(a[i]) === "" ? (def ?? asNumber(a[i])) : asNumber(a[i]));
const L = (a: Value[], i: number) => asList(a[i]);

const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A small deterministic fingerprint of a text: the same text always gives the same value. Not for secrets. */
export function checksum(text: string, length = 8): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")).slice(0, Math.max(1, Math.min(16, length)));
}

/** + - * / % and brackets, on numbers. Nothing else is allowed. */
export function calculate(formula: string): number {
  const src = formula.replace(/\s+/g, "");
  let i = 0;
  const fail = () => {
    throw new Error(`The calculation “${formula.trim()}” cannot be read.`);
  };
  const number = (): number => {
    if (src[i] === "(") {
      i += 1;
      const v = sum();
      if (src[i] !== ")") fail();
      i += 1;
      return v;
    }
    if (src[i] === "-") {
      i += 1;
      return -number();
    }
    if (src[i] === "+") {
      i += 1;
      return number();
    }
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) return fail() as never;
    i += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = number();
    while (src[i] === "*" || src[i] === "/" || src[i] === "%") {
      const op = src[i++]!;
      const r = number();
      if ((op === "/" || op === "%") && r === 0) throw new Error("Cannot divide by zero.");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (src[i] === "+" || src[i] === "-") {
      const op = src[i++]!;
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  if (src === "") fail();
  const v = sum();
  if (i !== src.length) fail();
  return v;
}

const sortBy = (list: string[]) => [...list].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }));

function formatDate(d: Date, fmt: string, lang: "de" | "en"): string {
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  return fmt.replace(/yyyy|MMMM|MM|dddd|dd|d|M|HH|mm/g, (t) => {
    switch (t) {
      case "yyyy": return String(y);
      case "MMMM": return MONTHS[lang][mo]!;
      case "MM": return pad(mo + 1);
      case "M": return String(mo + 1);
      case "dddd": return DAYS[lang][d.getUTCDay()]!;
      case "dd": return pad(day);
      case "d": return String(day);
      default: return "00";
    }
  });
}

const fn = (spec: FnSpec): FnSpec => spec;

export const FUNCTIONS: FnSpec[] = [
  // ---- Text ----
  fn({ name: "split", category: "text", label: b("Text teilen", "Split text"), help: b("Teilt einen Text an einem Zeichen in eine Liste.", "Cuts a text at a character into a list."), params: [P("text", "Text", "Text"), P("separator", "Trennzeichen", "Separator", "text", true, "-")], returns: "list", example: "split(2026-11-18, -) → 2026 · 11 · 18",
    run: (a) => (S(a, 1) === "" ? [S(a, 0)] : S(a, 0).split(S(a, 1))) }),
  fn({ name: "pieces", category: "text", label: b("Teile auswählen", "Pick pieces"), help: b("Teilt einen Text an einem Zeichen und gibt die gewählten Teile zurück, von bis (ab 1, -1 ist der letzte).", "Cuts a text at a character and returns the chosen pieces, from to (starting at 1, -1 is the last)."), params: [P("text", "Text", "Text"), P("separator", "Trennzeichen", "Separator", "text", true, "-"), P("from", "Ab Teil", "From piece", "number", true, "1"), P("to", "Bis Teil", "To piece", "number", false, "2"), P("join", "Verbinden mit", "Join with", "text", false)], returns: "text", example: "pieces(AB-12-X7, -, 1, 2) → AB-12",
    run: (a) => {
      const sep = S(a, 1);
      const parts = sep === "" ? [S(a, 0)] : S(a, 0).split(sep);
      const idx = (v: number) => (v < 0 ? parts.length + v + 1 : v);
      const from = Math.max(1, idx(N(a, 2, 1)));
      const to = S(a, 3) === "" ? parts.length : Math.min(parts.length, idx(N(a, 3)));
      return parts.slice(from - 1, Math.max(from - 1, to)).join(a[4] === undefined || S(a, 4) === "" ? sep : S(a, 4));
    } }),
  fn({ name: "item", category: "list", label: b("Eintrag aus Liste", "Item of a list"), help: b("Ein Eintrag einer Liste: erster, letzter oder die Nummer (ab 1).", "One item of a list: first, last or the number (from 1)."), params: [P("list", "Liste", "List", "list"), P("position", "Position", "Position", "text", true, "first")], returns: "text", example: "item(a · b · c, last) → c",
    run: (a) => {
      const l = L(a, 0);
      const p = S(a, 1).trim().toLowerCase();
      if (p === "first" || p === "erster") return l[0] ?? "";
      if (p === "last" || p === "letzter") return l[l.length - 1] ?? "";
      const n = asNumber(p);
      return l[(n < 0 ? l.length + n : n - 1)] ?? "";
    } }),
  fn({ name: "left", category: "text", label: b("Links", "Left"), help: b("Die ersten Zeichen eines Textes.", "The first characters of a text."), params: [P("text", "Text", "Text"), P("count", "Anzahl", "Count", "number")], returns: "text", example: "left(Frankfurt, 5) → Frank", run: (a) => S(a, 0).slice(0, Math.max(0, N(a, 1))) }),
  fn({ name: "right", category: "text", label: b("Rechts", "Right"), help: b("Die letzten Zeichen eines Textes.", "The last characters of a text."), params: [P("text", "Text", "Text"), P("count", "Anzahl", "Count", "number")], returns: "text", example: "right(Frankfurt, 4) → furt", run: (a) => { const n = Math.max(0, N(a, 1)); return n === 0 ? "" : S(a, 0).slice(-n); } }),
  fn({ name: "mid", category: "text", label: b("Ausschnitt", "Middle"), help: b("Ein Stück aus der Mitte: ab Zeichen (ab 1), so viele Zeichen.", "A piece from the middle: from character (starting at 1), this many characters."), params: [P("text", "Text", "Text"), P("start", "Ab Zeichen", "From character", "number"), P("length", "Länge", "Length", "number")], returns: "text", example: "mid(MS-2026-00044, 4, 4) → 2026", run: (a) => S(a, 0).substr(Math.max(0, N(a, 1) - 1), Math.max(0, N(a, 2))) }),
  fn({ name: "before", category: "text", label: b("Vor Zeichen", "Before"), help: b("Alles vor dem ersten Vorkommen einer Zeichenfolge.", "Everything before the first occurrence of a string."), params: [P("text", "Text", "Text"), P("marker", "Zeichenfolge", "String", "text", true, "@")], returns: "text", example: "before(paul@example.org, @) → paul", run: (a) => { const i = S(a, 0).indexOf(S(a, 1)); return i < 0 ? S(a, 0) : S(a, 0).slice(0, i); } }),
  fn({ name: "after", category: "text", label: b("Nach Zeichen", "After"), help: b("Alles nach dem ersten Vorkommen einer Zeichenfolge.", "Everything after the first occurrence of a string."), params: [P("text", "Text", "Text"), P("marker", "Zeichenfolge", "String", "text", true, "@")], returns: "text", example: "after(paul@example.org, @) → example.org", run: (a) => { const i = S(a, 0).indexOf(S(a, 1)); return i < 0 ? "" : S(a, 0).slice(i + S(a, 1).length); } }),
  fn({ name: "between", category: "text", label: b("Zwischen zwei Zeichen", "Between"), help: b("Der Text zwischen zwei Zeichenfolgen.", "The text between two strings."), params: [P("text", "Text", "Text"), P("start", "Nach", "After", "text", true, "("), P("end", "Vor", "Before", "text", true, ")")], returns: "text", example: "between(Paul (Rotterdam), (, )) → Rotterdam", run: (a) => { const t = S(a, 0); const i = t.indexOf(S(a, 1)); if (i < 0) return ""; const rest = t.slice(i + S(a, 1).length); const j = rest.indexOf(S(a, 2)); return j < 0 ? rest : rest.slice(0, j); } }),
  fn({ name: "join", category: "list", label: b("Liste verbinden", "Join a list"), help: b("Verbindet die Einträge einer Liste zu einem Text.", "Joins the items of a list into one text."), params: [P("list", "Liste", "List", "list"), P("separator", "Verbinden mit", "Join with", "text", false, ", ")], returns: "text", example: "join(a · b · c, ; ) → a; b; c", run: (a) => L(a, 0).join(a[1] === undefined ? ", " : S(a, 1)) }),
  fn({ name: "trim", category: "text", label: b("Leerzeichen entfernen", "Trim"), help: b("Entfernt Leerzeichen am Anfang und Ende.", "Removes spaces at the start and the end."), params: [P("text", "Text", "Text")], returns: "text", example: "trim(  Paul ) → Paul", run: (a) => S(a, 0).trim() }),
  fn({ name: "upper", category: "text", label: b("GROSSBUCHSTABEN", "UPPER CASE"), help: b("Alles in Großbuchstaben.", "All capitals."), params: [P("text", "Text", "Text")], returns: "text", example: "upper(Paul) → PAUL", run: (a) => S(a, 0).toUpperCase() }),
  fn({ name: "lower", category: "text", label: b("kleinbuchstaben", "lower case"), help: b("Alles in Kleinbuchstaben.", "All lower case."), params: [P("text", "Text", "Text")], returns: "text", example: "lower(Paul) → paul", run: (a) => S(a, 0).toLowerCase() }),
  fn({ name: "capitalize", category: "text", label: b("Anfangsbuchstaben groß", "Capitalise"), help: b("Jedes Wort beginnt mit einem Großbuchstaben.", "Every word starts with a capital."), params: [P("text", "Text", "Text")], returns: "text", example: "capitalize(paul neumann) → Paul Neumann", run: (a) => S(a, 0).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, s: string, c: string) => s + c.toUpperCase()) }),
  fn({ name: "replace", category: "text", label: b("Ersetzen", "Replace"), help: b("Ersetzt jedes Vorkommen einer Zeichenfolge.", "Replaces every occurrence of a string."), params: [P("text", "Text", "Text"), P("find", "Suchen", "Find"), P("with", "Ersetzen durch", "Replace with", "text", false)], returns: "text", example: "replace(a-b-c, -, /) → a/b/c", run: (a) => (S(a, 1) === "" ? S(a, 0) : S(a, 0).split(S(a, 1)).join(S(a, 2))) }),
  fn({ name: "concat", category: "text", label: b("Aneinanderhängen", "Put together"), help: b("Hängt Texte aneinander.", "Puts texts one after the other."), params: [P("a", "Text 1", "Text 1"), P("b", "Text 2", "Text 2", "text", false), P("c", "Text 3", "Text 3", "text", false)], returns: "text", example: "concat(MS, -, 044) → MS-044", run: (a) => a.map((x) => asText(x)).join("") }),
  fn({ name: "length", category: "text", label: b("Länge", "Length"), help: b("Anzahl der Zeichen eines Textes oder der Einträge einer Liste.", "The number of characters of a text or of items of a list."), params: [P("value", "Text oder Liste", "Text or list", "any")], returns: "number", example: "length(Paul) → 4", run: (a) => (Array.isArray(a[0]) ? a[0].length : S(a, 0).length) }),
  fn({ name: "contains", category: "logic", label: b("Enthält", "Contains"), help: b("Ja, wenn der Text oder die Liste das Gesuchte enthält.", "Yes if the text or list contains what is looked for."), params: [P("value", "Text oder Liste", "Text or list", "any"), P("part", "Gesucht", "Looked for")], returns: "yesno", example: "contains(Rotterdam, dam) → yes", run: (a) => (Array.isArray(a[0]) ? a[0].some((x) => x.toLowerCase() === S(a, 1).toLowerCase()) : S(a, 0).toLowerCase().includes(S(a, 1).toLowerCase())) }),
  fn({ name: "startsWith", category: "logic", label: b("Beginnt mit", "Starts with"), help: b("Ja, wenn der Text so beginnt.", "Yes if the text starts like this."), params: [P("text", "Text", "Text"), P("start", "Anfang", "Start")], returns: "yesno", example: "startsWith(MS-2026-00044, MS) → yes", run: (a) => S(a, 0).toLowerCase().startsWith(S(a, 1).toLowerCase()) }),
  fn({ name: "padLeft", category: "text", label: b("Links auffüllen", "Pad left"), help: b("Füllt links mit einem Zeichen auf eine Länge auf, zum Beispiel 7 → 0007.", "Fills on the left with a character up to a length, for example 7 → 0007."), params: [P("text", "Text", "Text"), P("width", "Länge", "Length", "number"), P("char", "Zeichen", "Character", "text", false, "0")], returns: "text", example: "padLeft(7, 4, 0) → 0007", run: (a) => S(a, 0).padStart(Math.max(0, N(a, 1)), S(a, 2, "0").charAt(0) || "0") }),
  fn({ name: "truncate", category: "text", label: b("Kürzen", "Shorten"), help: b("Kürzt einen langen Text und hängt „…“ an.", "Shortens a long text and adds “…”."), params: [P("text", "Text", "Text"), P("max", "Höchstens", "At most", "number")], returns: "text", example: "truncate(A long sentence, 6) → A long…", run: (a) => (S(a, 0).length > N(a, 1) ? `${S(a, 0).slice(0, Math.max(0, N(a, 1)))}…` : S(a, 0)) }),
  fn({ name: "slug", category: "text", label: b("Für Dateinamen", "Slug"), help: b("Macht aus einem Text etwas für Dateinamen und Links: kleingeschrieben, ohne Akzente, Bindestriche.", "Turns a text into something for file names and links: lower case, no accents, hyphens."), params: [P("text", "Text", "Text")], returns: "text", example: "slug(Çelik, Özge) → celik-ozge", run: (a) => S(a, 0).replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") }),
  fn({ name: "initials", category: "text", label: b("Initialen", "Initials"), help: b("Die Anfangsbuchstaben der Wörter.", "The first letters of the words."), params: [P("text", "Text", "Text")], returns: "text", example: "initials(Paul Neumann) → PN", run: (a) => S(a, 0).split(/[\s-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase()).join("") }),
  fn({ name: "mask", category: "text", label: b("Verdecken", "Mask"), help: b("Zeigt nur die letzten Zeichen, der Rest wird ••••.", "Shows only the last characters, the rest becomes ••••."), params: [P("text", "Text", "Text"), P("keep", "Sichtbar", "Visible", "number", false, "4")], returns: "text", example: "mask(DE89370400440532013000, 4) → ••••••••••••••••••3000", run: (a) => { const keep = Math.max(0, N(a, 1, 4)); const t = S(a, 0); return "•".repeat(Math.max(0, t.length - keep)) + t.slice(Math.max(0, t.length - keep)); } }),

  // ---- Numbers ----
  fn({ name: "calc", category: "number", label: b("Rechnung", "Calculation"), help: b("Eine Rechnung mit + − * / % und Klammern. Setzen Sie Kacheln hinein: {x} * 2 + 1.", "A calculation with + − * / % and brackets. Put tiles in: {x} * 2 + 1."), params: [P("formula", "Rechnung", "Calculation", "text", true, "(2 + 3) * 4")], returns: "number", example: "calc((2 + 3) * 4) → 20", run: (a) => calculate(S(a, 0)) }),
  fn({ name: "add", category: "number", label: b("Addieren", "Add"), help: b("Summe von zwei oder drei Zahlen.", "The sum of two or three numbers."), params: [P("a", "Zahl 1", "Number 1", "number"), P("b", "Zahl 2", "Number 2", "number"), P("c", "Zahl 3", "Number 3", "number", false)], returns: "number", example: "add(2, 3) → 5", run: (a) => a.reduce<number>((s, x) => s + (asText(x) === "" ? 0 : asNumber(x)), 0) }),
  fn({ name: "subtract", category: "number", label: b("Subtrahieren", "Subtract"), help: b("Zahl 1 minus Zahl 2.", "Number 1 minus number 2."), params: [P("a", "Zahl 1", "Number 1", "number"), P("b", "Zahl 2", "Number 2", "number")], returns: "number", example: "subtract(10, 3) → 7", run: (a) => N(a, 0) - N(a, 1) }),
  fn({ name: "multiply", category: "number", label: b("Multiplizieren", "Multiply"), help: b("Zahl 1 mal Zahl 2.", "Number 1 times number 2."), params: [P("a", "Zahl 1", "Number 1", "number"), P("b", "Zahl 2", "Number 2", "number")], returns: "number", example: "multiply(4, 5) → 20", run: (a) => N(a, 0) * N(a, 1) }),
  fn({ name: "divide", category: "number", label: b("Dividieren", "Divide"), help: b("Zahl 1 geteilt durch Zahl 2.", "Number 1 divided by number 2."), params: [P("a", "Zahl 1", "Number 1", "number"), P("b", "Zahl 2", "Number 2", "number")], returns: "number", example: "divide(10, 4) → 2.5", run: (a) => { if (N(a, 1) === 0) throw new Error("Cannot divide by zero."); return N(a, 0) / N(a, 1); } }),
  fn({ name: "modulo", category: "number", label: b("Rest der Division", "Remainder"), help: b("Der Rest bei Zahl 1 geteilt durch Zahl 2.", "The remainder of number 1 divided by number 2."), params: [P("a", "Zahl 1", "Number 1", "number"), P("b", "Zahl 2", "Number 2", "number")], returns: "number", example: "modulo(10, 4) → 2", run: (a) => { if (N(a, 1) === 0) throw new Error("Cannot divide by zero."); return N(a, 0) % N(a, 1); } }),
  fn({ name: "round", category: "number", label: b("Runden", "Round"), help: b("Rundet auf eine Zahl von Nachkommastellen.", "Rounds to a number of decimals."), params: [P("n", "Zahl", "Number", "number"), P("decimals", "Nachkommastellen", "Decimals", "number", false, "0")], returns: "number", example: "round(3.14159, 2) → 3.14", run: (a) => { const f = 10 ** Math.max(0, N(a, 1, 0)); return Math.round(N(a, 0) * f) / f; } }),
  fn({ name: "floor", category: "number", label: b("Abrunden", "Round down"), help: b("Rundet auf die nächste ganze Zahl ab.", "Rounds down to a whole number."), params: [P("n", "Zahl", "Number", "number")], returns: "number", example: "floor(3.9) → 3", run: (a) => Math.floor(N(a, 0)) }),
  fn({ name: "ceil", category: "number", label: b("Aufrunden", "Round up"), help: b("Rundet auf die nächste ganze Zahl auf.", "Rounds up to a whole number."), params: [P("n", "Zahl", "Number", "number")], returns: "number", example: "ceil(3.1) → 4", run: (a) => Math.ceil(N(a, 0)) }),
  fn({ name: "abs", category: "number", label: b("Betrag", "Absolute value"), help: b("Die Zahl ohne Vorzeichen.", "The number without its sign."), params: [P("n", "Zahl", "Number", "number")], returns: "number", example: "abs(-5) → 5", run: (a) => Math.abs(N(a, 0)) }),
  fn({ name: "min", category: "number", label: b("Kleinere Zahl", "Smaller"), help: b("Die kleinere von zwei Zahlen.", "The smaller of two numbers."), params: [P("a", "Zahl 1", "Number 1", "number"), P("b", "Zahl 2", "Number 2", "number")], returns: "number", example: "min(3, 8) → 3", run: (a) => Math.min(N(a, 0), N(a, 1)) }),
  fn({ name: "max", category: "number", label: b("Größere Zahl", "Larger"), help: b("Die größere von zwei Zahlen.", "The larger of two numbers."), params: [P("a", "Zahl 1", "Number 1", "number"), P("b", "Zahl 2", "Number 2", "number")], returns: "number", example: "max(3, 8) → 8", run: (a) => Math.max(N(a, 0), N(a, 1)) }),
  fn({ name: "sum", category: "number", label: b("Summe einer Liste", "Sum of a list"), help: b("Zählt die Zahlen einer Liste zusammen.", "Adds up the numbers of a list."), params: [P("list", "Liste", "List", "list")], returns: "number", example: "sum(1 · 2 · 3) → 6", run: (a) => L(a, 0).reduce((s, x) => s + asNumber(x), 0) }),
  fn({ name: "average", category: "number", label: b("Durchschnitt", "Average"), help: b("Der Durchschnitt der Zahlen einer Liste.", "The average of the numbers of a list."), params: [P("list", "Liste", "List", "list")], returns: "number", example: "average(2 · 4 · 6) → 4", run: (a) => { const l = L(a, 0); if (!l.length) throw new Error("The list is empty."); return l.reduce((s, x) => s + asNumber(x), 0) / l.length; } }),
  fn({ name: "percent", category: "number", label: b("Prozent", "Percent"), help: b("Wie viel Prozent ist Teil von Ganzes?", "What percent is part of whole?"), params: [P("part", "Teil", "Part", "number"), P("whole", "Ganzes", "Whole", "number"), P("decimals", "Nachkommastellen", "Decimals", "number", false, "0")], returns: "number", example: "percent(3, 8, 1) → 37.5", run: (a) => { if (N(a, 1) === 0) throw new Error("Cannot divide by zero."); const f = 10 ** Math.max(0, N(a, 2, 0)); return Math.round((N(a, 0) / N(a, 1)) * 100 * f) / f; } }),
  fn({ name: "formatNumber", category: "number", label: b("Zahl formatieren", "Format a number"), help: b("Mit Tausendertrennung und festen Nachkommastellen, je nach Sprache.", "With thousands separators and fixed decimals, by language."), params: [P("n", "Zahl", "Number", "number"), P("decimals", "Nachkommastellen", "Decimals", "number", false, "2")], returns: "text", example: "formatNumber(1234.5, 2) → 1,234.50", run: (a, env) => N(a, 0).toLocaleString(env.lang === "de" ? "de-DE" : "en-GB", { minimumFractionDigits: Math.max(0, N(a, 1, 2)), maximumFractionDigits: Math.max(0, N(a, 1, 2)) }) }),
  fn({ name: "formatEuro", category: "number", label: b("Euro-Betrag", "Euro amount"), help: b("Ein Betrag in Euro, in der Schreibweise der Sprache.", "An amount in euros, written the way the language does."), params: [P("n", "Betrag", "Amount", "number")], returns: "text", example: "formatEuro(1234.5) → 1,234.50 €", run: (a, env) => `${N(a, 0).toLocaleString(env.lang === "de" ? "de-DE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` }),

  // ---- Convert ----
  fn({ name: "toText", category: "convert", label: b("In Text umwandeln", "To text"), help: b("Macht aus einer Zahl, Liste oder Ja/Nein einen Text.", "Turns a number, list or yes/no into text."), params: [P("value", "Wert", "Value", "any")], returns: "text", example: "toText(42) → 42", run: (a) => asText(a[0]) }),
  fn({ name: "toNumber", category: "convert", label: b("In Zahl umwandeln", "To number"), help: b("Liest einen Text als Zahl, auch 1.234,56 oder 12 €.", "Reads a text as a number, also 1,234.56 or 12 €."), params: [P("text", "Text", "Text")], returns: "number", example: "toNumber(1.234,56 €) → 1234.56", run: (a) => asNumber(S(a, 0)) }),
  fn({ name: "toInteger", category: "convert", label: b("In ganze Zahl umwandeln", "To whole number"), help: b("Schneidet die Nachkommastellen ab.", "Cuts off the decimals."), params: [P("value", "Wert", "Value", "any")], returns: "number", example: "toInteger(7.9) → 7", run: (a) => Math.trunc(asNumber(a[0])) }),
  fn({ name: "toBoolean", category: "convert", label: b("In Ja/Nein umwandeln", "To yes/no"), help: b("„ja“, „yes“, „true“ und „1“ sind Ja, leer, „nein“, „no“, „false“ und „0“ sind Nein.", "“yes”, “ja”, “true” and “1” are yes; empty, “no”, “nein”, “false” and “0” are no."), params: [P("value", "Wert", "Value", "any")], returns: "yesno", example: "toBoolean(ja) → yes", run: (a) => asBool(a[0]) }),
  fn({ name: "toList", category: "convert", label: b("In Liste umwandeln", "To list"), help: b("Macht aus einem Text mit Zeilen (oder getrennt an einem Zeichen) eine Liste.", "Turns a text with lines (or separated by a character) into a list."), params: [P("text", "Text", "Text"), P("separator", "Trennzeichen", "Separator", "text", false, "newline")], returns: "list", example: "toList(a, b, c; ,) → a · b · c", run: (a) => (S(a, 1) === "" ? asList(a[0]) : asList(a[0], S(a, 1))) }),
  fn({ name: "toDate", category: "convert", label: b("In Datum umwandeln", "To date"), help: b("Liest 2026-11-18, 18.11.2026 oder 18/11/2026 als Datum.", "Reads 2026-11-18, 18.11.2026 or 18/11/2026 as a date."), params: [P("text", "Text", "Text")], returns: "date", example: "toDate(18.11.2026) → 2026-11-18", run: (a) => iso(asDate(a[0])) }),

  // ---- Dates ----
  fn({ name: "now", category: "date", label: b("Jetzt", "Now"), help: b("Das heutige Datum, wie es zu dem Zeitpunkt war, als der Schritt lief.", "Today's date as it was when the step ran."), params: [], returns: "date", example: "now() → 2026-11-18", run: (_a, env) => iso(env.now) }),
  fn({ name: "addDays", category: "date", label: b("Tage addieren", "Add days"), help: b("Ein Datum plus oder minus Tage.", "A date plus or minus days."), params: [P("date", "Datum", "Date", "text", true, "2026-11-18"), P("days", "Tage", "Days", "number")], returns: "date", example: "addDays(2026-11-18, 7) → 2026-11-25", run: (a) => { const d = asDate(a[0]); d.setUTCDate(d.getUTCDate() + N(a, 1)); return iso(d); } }),
  fn({ name: "addMonths", category: "date", label: b("Monate addieren", "Add months"), help: b("Ein Datum plus oder minus Monate.", "A date plus or minus months."), params: [P("date", "Datum", "Date", "text", true, "2026-11-18"), P("months", "Monate", "Months", "number")], returns: "date", example: "addMonths(2026-11-18, 2) → 2027-01-18", run: (a) => { const d = asDate(a[0]); d.setUTCMonth(d.getUTCMonth() + N(a, 1)); return iso(d); } }),
  fn({ name: "formatDate", category: "date", label: b("Datum schreiben", "Write a date"), help: b("Schreibt ein Datum nach einer Vorlage: yyyy, MM, dd, MMMM (Monatsname), dddd (Wochentag).", "Writes a date by a pattern: yyyy, MM, dd, MMMM (month name), dddd (weekday)."), params: [P("date", "Datum", "Date", "text", true, "2026-11-18"), P("pattern", "Vorlage", "Pattern", "text", true, "dd.MM.yyyy")], returns: "text", example: "formatDate(2026-11-18, d MMMM yyyy) → 18 November 2026", run: (a, env) => formatDate(asDate(a[0]), S(a, 1, "yyyy-MM-dd"), env.lang) }),
  fn({ name: "daysBetween", category: "date", label: b("Tage dazwischen", "Days between"), help: b("Wie viele Tage von Datum 1 bis Datum 2.", "How many days from date 1 to date 2."), params: [P("from", "Von", "From", "text", true, "2026-11-18"), P("to", "Bis", "To", "text", true, "2026-12-01")], returns: "number", example: "daysBetween(2026-11-18, 2026-12-01) → 13", run: (a) => Math.round((asDate(a[1]).getTime() - asDate(a[0]).getTime()) / 86_400_000) }),
  fn({ name: "year", category: "date", label: b("Jahr", "Year"), help: b("Das Jahr eines Datums.", "The year of a date."), params: [P("date", "Datum", "Date", "text", true, "2026-11-18")], returns: "number", example: "year(2026-11-18) → 2026", run: (a) => asDate(a[0]).getUTCFullYear() }),
  fn({ name: "weekday", category: "date", label: b("Wochentag", "Weekday"), help: b("Der Name des Wochentags.", "The name of the weekday."), params: [P("date", "Datum", "Date", "text", true, "2026-11-18")], returns: "text", example: "weekday(2026-11-18) → Wednesday", run: (a, env) => DAYS[env.lang][asDate(a[0]).getUTCDay()]! }),
  fn({ name: "endOfMonth", category: "date", label: b("Monatsende", "End of month"), help: b("Der letzte Tag des Monats.", "The last day of the month."), params: [P("date", "Datum", "Date", "text", true, "2026-11-18")], returns: "date", example: "endOfMonth(2026-11-18) → 2026-11-30", run: (a) => { const d = asDate(a[0]); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12))); } }),

  // ---- Logic ----
  fn({ name: "if", category: "logic", label: b("Wenn", "If"), help: b("Wenn die Bedingung Ja ist, kommt der erste Wert, sonst der zweite.", "If the condition is yes, the first value comes out, otherwise the second."), params: [P("condition", "Bedingung", "Condition", "bool"), P("then", "Dann", "Then", "any"), P("else", "Sonst", "Else", "any", false)], returns: "any", example: "if(yes, A, B) → A", run: (a) => (asBool(a[0]) ? (a[1] ?? "") : (a[2] ?? "")) }),
  fn({ name: "coalesce", category: "logic", label: b("Erster Wert, der da ist", "First that is there"), help: b("Nimmt den ersten Wert, der nicht leer ist.", "Takes the first value that is not empty."), params: [P("a", "Wert 1", "Value 1", "any"), P("b", "Wert 2", "Value 2", "any"), P("c", "Wert 3", "Value 3", "any", false)], returns: "any", example: "coalesce(, Frau Demir) → Frau Demir", run: (a) => a.find((x) => asText(x).trim() !== "") ?? "" }),
  fn({ name: "isEmpty", category: "logic", label: b("Ist leer", "Is empty"), help: b("Ja, wenn nichts da ist.", "Yes if there is nothing."), params: [P("value", "Wert", "Value", "any")], returns: "yesno", example: "isEmpty() → yes", run: (a) => asText(a[0]).trim() === "" }),
  fn({ name: "equals", category: "logic", label: b("Ist gleich", "Equals"), help: b("Ja, wenn beide Werte gleich sind (Zahlen als Zahlen).", "Yes if both values are the same (numbers as numbers)."), params: [P("a", "Wert 1", "Value 1", "any"), P("b", "Wert 2", "Value 2", "any")], returns: "yesno", example: "equals(2, 2.0) → yes", run: (a) => { const x = asText(a[0]).trim(); const y = asText(a[1]).trim(); const nx = parseNumber(x); const ny = parseNumber(y); return !Number.isNaN(nx) && !Number.isNaN(ny) ? nx === ny : x.toLowerCase() === y.toLowerCase(); } }),
  fn({ name: "greater", category: "logic", label: b("Ist größer", "Is greater"), help: b("Ja, wenn Wert 1 größer als Wert 2 ist.", "Yes if value 1 is greater than value 2."), params: [P("a", "Wert 1", "Value 1", "number"), P("b", "Wert 2", "Value 2", "number")], returns: "yesno", example: "greater(5, 3) → yes", run: (a) => N(a, 0) > N(a, 1) }),
  fn({ name: "less", category: "logic", label: b("Ist kleiner", "Is less"), help: b("Ja, wenn Wert 1 kleiner als Wert 2 ist.", "Yes if value 1 is less than value 2."), params: [P("a", "Wert 1", "Value 1", "number"), P("b", "Wert 2", "Value 2", "number")], returns: "yesno", example: "less(2, 3) → yes", run: (a) => N(a, 0) < N(a, 1) }),
  fn({ name: "and", category: "logic", label: b("Und", "And"), help: b("Ja, wenn beide Ja sind.", "Yes if both are yes."), params: [P("a", "Wert 1", "Value 1", "bool"), P("b", "Wert 2", "Value 2", "bool")], returns: "yesno", example: "and(yes, no) → no", run: (a) => asBool(a[0]) && asBool(a[1]) }),
  fn({ name: "or", category: "logic", label: b("Oder", "Or"), help: b("Ja, wenn eines Ja ist.", "Yes if one is yes."), params: [P("a", "Wert 1", "Value 1", "bool"), P("b", "Wert 2", "Value 2", "bool")], returns: "yesno", example: "or(yes, no) → yes", run: (a) => asBool(a[0]) || asBool(a[1]) }),
  fn({ name: "not", category: "logic", label: b("Nicht", "Not"), help: b("Dreht Ja und Nein um.", "Turns yes into no and no into yes."), params: [P("a", "Wert", "Value", "bool")], returns: "yesno", example: "not(yes) → no", run: (a) => !asBool(a[0]) }),
  fn({ name: "lookup", category: "logic", label: b("Nachschlagen", "Look up"), help: b("Schlägt einen Wert in einer Tabelle nach: „a=Eins;b=Zwei“. Wenn nichts passt, kommt der Standardwert.", "Looks a value up in a table: “a=One;b=Two”. If nothing matches, the default comes out."), params: [P("value", "Wert", "Value"), P("table", "Tabelle", "Table", "text", true, "NL=Netherlands;PT=Portugal"), P("default", "Standard", "Default", "text", false)], returns: "text", example: "lookup(PT, NL=Netherlands;PT=Portugal) → Portugal", run: (a) => { for (const pair of S(a, 1).split(";")) { const i = pair.indexOf("="); if (i > 0 && pair.slice(0, i).trim().toLowerCase() === S(a, 0).trim().toLowerCase()) return pair.slice(i + 1).trim(); } return S(a, 2); } }),
  fn({ name: "pluralize", category: "logic", label: b("Einzahl oder Mehrzahl", "Singular or plural"), help: b("Wählt je nach Anzahl die Einzahl oder Mehrzahl.", "Chooses singular or plural by the count."), params: [P("n", "Anzahl", "Count", "number"), P("one", "Einzahl", "Singular"), P("many", "Mehrzahl", "Plural")], returns: "text", example: "pluralize(2, document, documents) → documents", run: (a) => (N(a, 0) === 1 ? S(a, 1) : S(a, 2)) }),

  // ---- Lists ----
  fn({ name: "count", category: "list", label: b("Anzahl", "Count"), help: b("Wie viele Einträge hat die Liste?", "How many items does the list have?"), params: [P("list", "Liste", "List", "list")], returns: "number", example: "count(a · b · c) → 3", run: (a) => L(a, 0).length }),
  fn({ name: "first", category: "list", label: b("Erster Eintrag", "First item"), help: b("Der erste Eintrag einer Liste.", "The first item of a list."), params: [P("list", "Liste", "List", "list")], returns: "text", example: "first(a · b) → a", run: (a) => L(a, 0)[0] ?? "" }),
  fn({ name: "last", category: "list", label: b("Letzter Eintrag", "Last item"), help: b("Der letzte Eintrag einer Liste.", "The last item of a list."), params: [P("list", "Liste", "List", "list")], returns: "text", example: "last(a · b) → b", run: (a) => L(a, 0).at(-1) ?? "" }),
  fn({ name: "reverse", category: "list", label: b("Umkehren", "Reverse"), help: b("Dreht die Reihenfolge um.", "Reverses the order."), params: [P("list", "Liste", "List", "list")], returns: "list", example: "reverse(a · b) → b · a", run: (a) => [...L(a, 0)].reverse() }),
  fn({ name: "sort", category: "list", label: b("Sortieren", "Sort"), help: b("Sortiert die Liste von A bis Z (Zahlen nach Wert).", "Sorts the list from A to Z (numbers by value)."), params: [P("list", "Liste", "List", "list")], returns: "list", example: "sort(b · a) → a · b", run: (a) => sortBy(L(a, 0)) }),
  fn({ name: "unique", category: "list", label: b("Doppelte entfernen", "Remove duplicates"), help: b("Jeder Eintrag nur einmal.", "Every item only once."), params: [P("list", "Liste", "List", "list")], returns: "list", example: "unique(a · a · b) → a · b", run: (a) => [...new Set(L(a, 0))] }),
  fn({ name: "filterContains", category: "list", label: b("Einträge filtern", "Filter items"), help: b("Behält nur die Einträge, die das Gesuchte enthalten.", "Keeps only the items that contain what is looked for."), params: [P("list", "Liste", "List", "list"), P("part", "Enthält", "Contains")], returns: "list", example: "filterContains(Passport · Contract, pass) → Passport", run: (a) => L(a, 0).filter((x) => x.toLowerCase().includes(S(a, 1).toLowerCase())) }),
  fn({ name: "sentence", category: "list", label: b("Als Satzteil", "As a phrase"), help: b("„a, b und c“ in der Sprache des Antrags.", "“a, b and c” in the language of the application."), params: [P("list", "Liste", "List", "list")], returns: "text", example: "sentence(a · b · c) → a, b and c", run: (a, env) => { const l = L(a, 0); const w = env.lang === "de" ? "und" : "and"; return l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} ${w} ${l[l.length - 1]}`; } }),

  // ---- IDs and random values ----
  fn({ name: "randomId", category: "id", label: b("Zufällige ID (pro Antrag)", "Random ID (per case)"), help: b("Für jeden Antrag, der durch den Schritt läuft, eine neue ID. Läuft derselbe Antrag noch einmal durch, bleibt seine ID.", "A new ID for every case that flows through. If the same case runs again, its ID stays."), params: [P("length", "Länge", "Length", "number", false, "8")], returns: "text", example: "randomId(8) → K7Q2P9D4", run: (a, env) => env.random("case", `id:${Math.max(2, Math.min(32, N(a, 0, 8)))}`) }),
  fn({ name: "randomIdRun", category: "id", label: b("Zufällige ID (neu bei jedem Lauf)", "Random ID (new each run)"), help: b("Bei jedem Lauf eine neue ID, auch wenn derselbe Antrag noch einmal durchläuft.", "A new ID on every run, also when the same case runs again."), params: [P("length", "Länge", "Length", "number", false, "8")], returns: "text", example: "randomIdRun(8) → 3MX8TQ5R", run: (a, env) => env.random("run", `id:${Math.max(2, Math.min(32, N(a, 0, 8)))}`) }),
  fn({ name: "randomNumber", category: "id", label: b("Zufallszahl (pro Antrag)", "Random number (per case)"), help: b("Eine Zufallszahl von bis, für jeden Antrag neu, bei einem erneuten Lauf unverändert.", "A random number from to, new for each case, unchanged when the case runs again."), params: [P("min", "Von", "From", "number", true, "1"), P("max", "Bis", "To", "number", true, "100")], returns: "number", example: "randomNumber(1, 100) → 42", run: (a, env) => Number(env.random("case", `num:${N(a, 0)}:${N(a, 1)}`)) }),
  fn({ name: "randomNumberRun", category: "id", label: b("Zufallszahl (neu bei jedem Lauf)", "Random number (new each run)"), help: b("Eine Zufallszahl von bis, bei jedem Lauf neu.", "A random number from to, new on every run."), params: [P("min", "Von", "From", "number", true, "1"), P("max", "Bis", "To", "number", true, "100")], returns: "number", example: "randomNumberRun(1, 100) → 17", run: (a, env) => Number(env.random("run", `num:${N(a, 0)}:${N(a, 1)}`)) }),
  fn({ name: "guid", category: "id", label: b("GUID (pro Antrag)", "GUID (per case)"), help: b("Eine weltweit eindeutige Kennung, pro Antrag, bei einem erneuten Lauf unverändert.", "A globally unique identifier, per case, unchanged when the case runs again."), params: [], returns: "text", example: "guid() → 3f2b8c1e-…", run: (_a, env) => env.random("case", "guid") }),
  fn({ name: "guidRun", category: "id", label: b("GUID (neu bei jedem Lauf)", "GUID (new each run)"), help: b("Eine weltweit eindeutige Kennung, bei jedem Lauf neu.", "A globally unique identifier, new on every run."), params: [], returns: "text", example: "guidRun() → 9a10…", run: (_a, env) => env.random("run", "guid") }),
  fn({ name: "checksum", category: "id", label: b("Prüfsumme", "Checksum"), help: b("Ein kurzer Fingerabdruck eines Textes. Derselbe Text ergibt immer denselben Wert. Kein Schutz für Geheimnisse.", "A short fingerprint of a text. The same text always gives the same value. Not for secrets."), params: [P("text", "Text", "Text"), P("length", "Länge", "Length", "number", false, "8")], returns: "text", example: "checksum(MS-2026-00044) → 4a9c0e1b", run: (a) => checksum(S(a, 0), N(a, 1, 8)) }),
];

const BY_NAME = new Map(FUNCTIONS.map((f) => [f.name, f]));
export const fnByName = (name: string): FnSpec | undefined => BY_NAME.get(name);

export const FN_CATEGORIES: { id: FnCategory; label: Bilingual }[] = [
  { id: "text", label: b("Text", "Text") },
  { id: "number", label: b("Zahlen und Rechnen", "Numbers and maths") },
  { id: "convert", label: b("Umwandeln", "Convert") },
  { id: "date", label: b("Datum", "Dates") },
  { id: "list", label: b("Listen", "Lists") },
  { id: "logic", label: b("Logik", "Logic") },
  { id: "id", label: b("IDs und Zufall", "IDs and random") },
];

/** The random values the engine keeps, or a fixed one for previews. */
export function previewRandom(kind: "case" | "run", shape: string): string {
  if (shape === "guid") return "3f2b8c1e-9d47-4a6b-b1e0-5c7a2d9f8e14";
  if (shape.startsWith("num:")) return String(Number(shape.split(":")[1]));
  return ID_CHARS.slice(0, Number(shape.split(":")[1] ?? 8)).padEnd(Number(shape.split(":")[1] ?? 8), "K");
}

/** A random value of the given shape, from a source of numbers between 0 and 1. */
export function randomOfShape(shape: string, rnd: () => number): string {
  if (shape === "guid") {
    const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(rnd() * 4)]}${hex(3)}-${hex(12)}`;
  }
  if (shape.startsWith("num:")) {
    const [, lo, hi] = shape.split(":").map(Number) as [string, number, number];
    const a = Math.min(lo, hi);
    const z = Math.max(lo, hi);
    return String(a + Math.floor(rnd() * (z - a + 1)));
  }
  const n = Number(shape.split(":")[1] ?? 8);
  return Array.from({ length: n }, () => ID_CHARS[Math.floor(rnd() * ID_CHARS.length)]).join("");
}

// ---- Evaluating ----------------------------------------------------------------------------

export interface Env extends FnEnv {
  /** The value of an output or basic. undefined: not available, the token stays as it is. */
  ref: (p: Extract<Part, { k: "ref" }>) => Value | undefined;
}

const isBlank = (p: Part) => p.k === "text" && p.v.trim() === "";

/** One slot or text as a value: a single output or function keeps its type (a list stays a list); anything else is text. */
export function evalParts(parts: Part[], env: Env): Value {
  const real = parts.filter((p) => !isBlank(p));
  if (real.length === 1 && real[0]!.k !== "text") return evalPart(real[0]!, env);
  return parts.map((p) => asText(evalPart(p, env))).join("");
}

function evalPart(p: Part, env: Env): Value {
  if (p.k === "text") return p.v;
  if (p.k === "ref") return env.ref(p) ?? p.raw;
  const spec = fnByName(p.name);
  if (!spec) throw new Error(`There is no function “${p.name}”.`);
  const args = p.slots.map((s) => evalParts(s, env));
  const need = spec.params.filter((x) => x.required).length;
  if (args.filter((a, i) => i < need || asText(a) !== "").length < need) throw new Error(`“${spec.label.en}” needs ${need} value${need === 1 ? "" : "s"}.`);
  try {
    return spec.run(args, env);
  } catch (e) {
    throw new Error(`“${spec.label.en}”: ${e instanceof Error ? e.message : "failed"}`);
  }
}

/** Fills a whole text: plain text stays, outputs and functions are replaced by their value. */
export function renderText(text: string, env: Env): string {
  if (!text.includes("{")) return text;
  return parseText(text).parts.map((p) => (p.k === "ref" ? asText(env.ref(p) ?? p.raw) : asText(evalPart(p, env)))).join("");
}

// ---- Checking ----------------------------------------------------------------------------------

/** What is wrong with the functions in a text, in words. */
export function checkText(text: string): string[] {
  if (!text.includes("{=")) return [];
  const r = parseText(text);
  const out = [...r.errors];
  const visit = (parts: Part[]) => {
    for (const p of parts) {
      if (p.k !== "call") continue;
      const spec = fnByName(p.name);
      if (!spec) out.push(`There is no function “${p.name}”.`);
      else {
        const need = spec.params.filter((x) => x.required).length;
        if (p.slots.length > spec.params.length) out.push(`“${spec.label.en}” takes at most ${spec.params.length} values.`);
        const filled = p.slots.filter((s) => s.some((x) => !isBlank(x))).length;
        if (filled < need) out.push(`“${spec.label.en}” needs ${need} value${need === 1 ? "" : "s"}; ${filled} given.`);
      }
      p.slots.forEach(visit);
    }
  };
  visit(r.parts);
  return out;
}

/** The type a text gives when it is one function or one output (for conditions), otherwise text. */
export function typeOfText(text: string, outputType: (name: string) => ReturnType | undefined): ReturnType {
  const parts = parseText(text).parts.filter((p) => !isBlank(p));
  if (parts.length === 1) {
    const p = parts[0]!;
    if (p.k === "call") return fnByName(p.name)?.returns ?? "any";
    if (p.k === "ref") return p.format === "count" ? "number" : (outputType(p.name) ?? "text");
  }
  return /^\s*-?\d+([.,]\d+)?\s*$/.test(text) ? "number" : "text";
}

/** A function written out for people: left(Caseworker · Name, 3). */
export function describeCall(raw: string, refName: (r: Extract<Part, { k: "ref" }>) => string): string {
  const parse = (parts: Part[]): string => parts.map((p) => (p.k === "text" ? p.v : p.k === "ref" ? refName(p) : describe(p))).join("");
  const describe = (p: Extract<Part, { k: "call" }>): string => `${p.name}(${p.slots.map(parse).join(", ")})`;
  const first = parseText(raw).parts[0];
  return first?.k === "call" ? describe(first) : raw;
}

/** All outputs a text refers to, including the ones inside functions. */
export function refsInText(text: string): Extract<Part, { k: "ref" }>[] {
  const out: Extract<Part, { k: "ref" }>[] = [];
  const visit = (parts: Part[]) => {
    for (const p of parts) {
      if (p.k === "ref") out.push(p);
      else if (p.k === "call") p.slots.forEach(visit);
    }
  };
  visit(parseText(text).parts);
  return out;
}
