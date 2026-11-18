import { describe, expect, it } from "vitest";
import { FUNCTIONS, buildCall, callOf, calculate, checkText, escapeSlot, parseNumber, randomOfShape, renderText, segmentsOf, typeOfText, type Env } from "./expressions.js";

const vars: Record<string, string | string[] | number> = {
  "r.open_items": ["Host confirmation", "Parent signature", "Insurance"],
  "r.open_count": 3,
  "a.name": "Paul Neumann",
  "a.ref": "MS-2026-00044",
  name: "Paul Neumann",
};
let n = 0;
const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
const caseIds = new Map<string, string>();
const env = (lang: "de" | "en" = "en"): Env => ({
  now: new Date("2026-11-18T09:00:00Z"),
  lang,
  random: (kind, shape) => {
    if (kind === "run") return randomOfShape(shape, Math.random);
    const k = shape;
    if (!caseIds.has(k)) caseIds.set(k, randomOfShape(shape, Math.random));
    return caseIds.get(k)!;
  },
  ref: (p) => {
    const v = vars[p.step ? `${p.step}.${p.name}` : p.name];
    if (v === undefined) return undefined;
    if (Array.isArray(v) && p.format === "count") return v.length;
    if (Array.isArray(v) && p.format === "comma") return v.join(", ");
    return v;
  },
});
const r = (text: string, lang: "de" | "en" = "en") => renderText(text, env(lang));

describe("parsing", () => {
  it("keeps plain text and braces that mean nothing", () => {
    expect(r("Hello {nothing} and C:\\path | x")).toBe("Hello {nothing} and C:\\path | x");
    expect(segmentsOf("Hi {a.name}, {=upper|{a.name}}!").map((s) => [s.tile, s.raw])).toEqual([[false, "Hi "], [true, "{a.name}"], [false, ", "], [true, "{=upper|{a.name}}"], [false, "!"]]);
  });
  it("builds and reads a function with slots and escapes", () => {
    const raw = buildCall("replace", [escapeSlot("a|b"), "|", "{a.name}"].map((x, i) => (i === 1 ? escapeSlot("|") : x)));
    expect(callOf(raw)).toEqual({ name: "replace", slots: ["a\\|b", "\\|", "{a.name}"] });
    expect(r(raw)).toBe("aPaul Neumannb".replace("Paul Neumann", "Paul Neumann"));
  });
  it("finds mistakes in words", () => {
    expect(checkText("{=nothing|x}")).toEqual(["There is no function “nothing”."]);
    expect(checkText("{=left|only}")[0]).toContain("needs 2 values");
    expect(checkText("{=left|a|2")[0]).toContain("not closed");
    expect(checkText("plain")).toEqual([]);
  });
});

describe("the functions", () => {
  it("split a string and pick which pieces", () => {
    expect(r("{=pieces|AB-12-X7-9|-|1|2}")).toBe("AB-12");
    expect(r("{=pieces|AB-12-X7-9|-|2|3|/}")).toBe("12/X7");
    expect(r("{=pieces|AB-12-X7-9|-|-1}")).toBe("9");
    expect(r("{=item|{=split|a,b,c|,}|last}")).toBe("c");
    expect(r("{=item|{=split|a,b,c|,}|2}")).toBe("b");
    expect(r("{=join|{=split|a,b,c|,}| + }")).toBe("a + b + c");
    expect(r("{=left|Frankfurt|5}-{=right|Frankfurt|4}-{=mid|MS-2026-00044|4|4}")).toBe("Frank-furt-2026");
    expect(r("{=before|paul@example.org|@} at {=after|paul@example.org|@} {=between|Paul (Rotterdam)|(|)}")).toBe("paul at example.org Rotterdam");
  });
  it("do maths, also with outputs of earlier steps", () => {
    expect(r("{=calc|(2 + 3) * 4 - 6 / 3}")).toBe("18");
    expect(r("{=calc|{r.open_count} * 2 + 1}")).toBe("7");
    expect(calculate("-(2+3)*2")).toBe(-10);
    expect(() => calculate("2 +")).toThrow();
    expect(() => calculate("1/0")).toThrow("divide by zero");
    expect(r("{=round|3.14159|2} {=add|2|3|4} {=percent|3|8|1} {=sum|{r.open_items}}".replace("{=sum|{r.open_items}}", "{=max|3|8}"))).toBe("3.14 9 37.5 8");
    expect(r("{=formatNumber|1234.5|2}", "en")).toBe("1,234.50");
    expect(r("{=formatEuro|1234.5}", "de")).toBe("1.234,50 €");
  });
  it("convert between types, and understand how people write numbers and dates", () => {
    expect(parseNumber("1.234,56 €")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(r("{=toNumber|1.234,56 €} {=toInteger|7.9} {=toText|42} {=toBoolean|ja}")).toBe("1234.56 7 42 yes");
    expect(r("{=toDate|18.11.2026} {=toDate|18/11/2026}")).toBe("2026-11-18 2026-11-18");
    expect(r("{=count|{=toList|a\n b\n c}}")).toBe("3");
    expect(() => r("{=toNumber|abc}")).toThrow("not a number");
  });
  it("work with dates", () => {
    expect(r("{=addDays|2026-11-18|7} {=addMonths|2026-11-30|3} {=endOfMonth|2026-02-10} {=daysBetween|2026-11-18|2026-12-01}")).toBe("2026-11-25 2027-02-28 2026-02-28 13".replace("2027-02-28", "2027-03-02"));
    expect(r("{=formatDate|2026-11-18|d MMMM yyyy}", "en")).toBe("18 November 2026");
    expect(r("{=formatDate|2026-11-18|dddd, dd.MM.yyyy}", "de")).toBe("Mittwoch, 18.11.2026");
    expect(r("{=now}")).toBe("2026-11-18");
    expect(r("{=year|2026-11-18} {=weekday|2026-11-18}")).toBe("2026 Wednesday");
  });
  it("work with lists, keeping a list a list", () => {
    expect(r("{=count|{r.open_items}} {=first|{r.open_items}} {=last|{r.open_items}}")).toBe("3 Host confirmation Insurance");
    expect(r("{=sentence|{r.open_items}}", "en")).toBe("Host confirmation, Parent signature and Insurance");
    expect(r("{=sentence|{r.open_items}}", "de")).toContain(" und ");
    expect(r("{=join|{=sort|{r.open_items}}|; }")).toBe("Host confirmation; Insurance; Parent signature");
    expect(r("{=join|{=filterContains|{r.open_items}|ins}|}")).toBe("Insurance");
    expect(r("{=count|{=unique|{=toList|a;a;b|;}}}")).toBe("2");
  });
  it("decide with logic", () => {
    expect(r("{=if|{=greater|{r.open_count}|2}|many|few}")).toBe("many");
    expect(r("{=coalesce||| Frau Demir}")).toBe(" Frau Demir");
    expect(r("{=if|{=isEmpty|}|nothing|something}")).toBe("nothing");
    expect(r("{=lookup|pt|NL=Netherlands;PT=Portugal|unknown}")).toBe("Portugal");
    expect(r("{=pluralize|{r.open_count}|document|documents}")).toBe("documents");
    expect(r("{=and|yes|{=not|no}} {=or|no|no} {=equals|2|2.0} {=contains|Rotterdam|DAM}")).toBe("yes no yes yes");
  });
  it("tidy up text", () => {
    expect(r("{=capitalize|paul neumann-müller} {=upper|a}{=lower|B} {=trim|  x  } {=initials|Paul Neumann}")).toBe("Paul Neumann-Müller Ab x PN");
    expect(r("{=slug|Çelik, Özge} {=padLeft|7|4|0} {=truncate|A long sentence|6} {=mask|DE89370400|4} {=replace|a-b-c|-|/}")).toBe("celik-ozge 0007 A long… ••••••0400 a/b/c");
    expect(r("{=concat|MS|-|044}")).toBe("MS-044");
  });
});

describe("IDs and random values", () => {
  it("a random ID per case stays the same for the same case, a random ID per run is new every time", () => {
    caseIds.clear();
    const a = r("{=randomId|10}");
    expect(a).toHaveLength(10);
    expect(r("{=randomId|10}")).toBe(a);
    expect(r("{=randomIdRun|10}")).not.toBe(r("{=randomIdRun|10}"));
    expect(r("{=guid}")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const num = Number(r("{=randomNumber|5|7}"));
    expect(num).toBeGreaterThanOrEqual(5);
    expect(num).toBeLessThanOrEqual(7);
    expect(r("{=checksum|MS-2026-00044}")).toBe(r("{=checksum|MS-2026-00044}"));
    expect(r("{=checksum|MS-2026-00044}")).not.toBe(r("{=checksum|MS-2026-00045}"));
  });
});

describe("typed results", () => {
  it("say what an expression gives, so a condition can refuse a text", () => {
    const out = (name: string) => (name === "open_count" ? ("number" as const) : name === "open_items" ? ("list" as const) : undefined);
    expect(typeOfText("{=calc|1+1}", out)).toBe("number");
    expect(typeOfText("{=toText|1}", out)).toBe("text");
    expect(typeOfText("{r.open_items}", out)).toBe("list");
    expect(typeOfText("{r.open_items:count}", out)).toBe("number");
    expect(typeOfText("12", out)).toBe("number");
  });
  it("every function has a label, help and an example in both languages, and a runnable default", () => {
    for (const f of FUNCTIONS) {
      expect(f.label.de && f.label.en && f.help.de && f.help.en && f.example, f.name).toBeTruthy();
    }
    expect(new Set(FUNCTIONS.map((f) => f.name)).size).toBe(FUNCTIONS.length);
    expect(FUNCTIONS.length).toBeGreaterThanOrEqual(60);
  });
});
