/** Who handles a case, decided by the first letter of the family name. An office-wide setting. */
export interface AssignmentRange {
  /** First and last letter, "A" to "Z". */
  from: string;
  to: string;
  staffId: string;
}

export interface OfficeAssignment {
  ranges: AssignmentRange[];
  /** Caseworkers who are away, with the person who covers for them. */
  away: Record<string, string>;
  /** Gets cases whose name matches no range, and cases whose caseworker and substitute are both away. */
  fallbackId: string;
}

export interface AssignmentResult {
  staffId: string;
  via: "range" | "substitute" | "fallback";
  /** The letter the family name was sorted under, or "" if it has none. */
  letter: string;
  /** The caseworker the range named, when someone else covers. */
  covering?: string;
}

const PREFIXES = new Set(["von", "van", "vom", "der", "den", "de", "di", "da", "du", "la", "le", "zu", "zur", "zum", "ter", "ten", "el", "al", "bin", "ibn"]);

/** The letter a family name is filed under: no prefixes like "von" or "de", no accents, ß counts as s. "" if there is none. */
export function surnameLetter(lastName: string): string {
  const parts = lastName.trim().split(/[\s-]+/).filter(Boolean);
  while (parts.length > 1 && PREFIXES.has(parts[0]!.toLowerCase())) parts.shift();
  const plain = (parts[0] ?? "").replace(/ß/g, "ss").replace(/æ/gi, "a").replace(/ø/gi, "o").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const m = plain.match(/[A-Z]/);
  return m ? m[0] : "";
}

export function assignCaseworker(lastName: string, a: OfficeAssignment): AssignmentResult {
  const letter = surnameLetter(lastName);
  const range = letter ? a.ranges.find((r) => letter >= r.from && letter <= r.to) : undefined;
  if (!range) return { staffId: a.fallbackId, via: "fallback", letter };
  const sub = a.away[range.staffId];
  if (sub === undefined) return { staffId: range.staffId, via: "range", letter };
  if (a.away[sub] === undefined && sub !== range.staffId) return { staffId: sub, via: "substitute", letter, covering: range.staffId };
  return { staffId: a.fallbackId, via: "fallback", letter, covering: range.staffId };
}

/** Problems with the table: letters given to two people, and letters nobody covers (those go to the fallback person). */
export function checkAssignment(a: OfficeAssignment): { invalid: string[]; overlaps: string[]; gaps: string[] } {
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const invalid = a.ranges.filter((r) => !/^[A-Z]$/.test(r.from) || !/^[A-Z]$/.test(r.to) || r.from > r.to).map((r) => `${r.from}–${r.to}`);
  const owners = new Map<string, number>();
  for (const r of a.ranges) if (!invalid.includes(`${r.from}–${r.to}`)) for (const l of LETTERS) if (l >= r.from && l <= r.to) owners.set(l, (owners.get(l) ?? 0) + 1);
  return {
    invalid,
    overlaps: LETTERS.filter((l) => (owners.get(l) ?? 0) > 1),
    gaps: LETTERS.filter((l) => !owners.has(l)),
  };
}

/** The table a new office starts with: four caseworkers share the alphabet. */
export function defaultAssignment(): OfficeAssignment {
  return {
    ranges: [
      { from: "A", to: "F", staffId: "s-beispiel" },
      { from: "G", to: "L", staffId: "s-kaya" },
      { from: "M", to: "R", staffId: "s-demir" },
      { from: "S", to: "Z", staffId: "s-vogel" },
    ],
    away: {},
    fallbackId: "s-obermeier",
  };
}
