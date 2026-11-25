import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Bilingual } from "@digieurope/shared";

/**
 * Reads docs/ontology.md, the source of truth of the context model, into entity types and relations.
 * The format is described at the top of that file. Errors name the line, so the person editing it can fix them.
 */

export type Card = "1" | "0..1" | "0..*" | "1..*";
export const GROUPS = ["organisation", "process", "rules", "documents", "systems", "federal"] as const;
export type Group = (typeof GROUPS)[number];

export interface EntityType {
  type: string;
  label: Bilingual;
  group: Group;
  description: string;
  attributes: { name: string; type: string; description: string }[];
}

export interface Relation {
  kind: string;
  label: Bilingual;
  from: string;
  to: string;
  /** How many "from" items one "to" item has, and how many "to" items one "from" item has. */
  fromCard: Card;
  toCard: Card;
  description: string;
  /** Follows from other relations; not drawn in the schema view. */
  shortcut?: boolean;
  /** Inferred, not stated in the data. */
  derived?: boolean;
}

export interface Ontology {
  types: EntityType[];
  relations: Relation[];
}

export class OntologyError extends Error {
  constructor(readonly problems: string[]) {
    super(`docs/ontology.md has ${problems.length} problem(s): ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? " …" : ""}`);
  }
}

const CARDS: Card[] = ["1", "0..1", "0..*", "1..*"];
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const isTable = (line: string) => line.trim().startsWith("|");
const isSeparator = (line: string) => /^\|?\s*:?-{3,}/.test(line.trim());
const unticked = (x: string) => x.replace(/^`|`$/g, "").trim();

export function parseOntology(text: string): Ontology {
  const lines = text.split(/\r?\n/);
  const problems: string[] = [];
  type Raw = { heading: string; line: number; id?: string; group?: string; de?: string; description: string[]; fields: { cells: string[]; line: number }[]; relations: { cells: string[]; line: number }[] };
  const raws: Raw[] = [];
  let cur: Raw | null = null;
  let table: "fields" | "relations" | null = null;
  let headerSeen = false;

  lines.forEach((line, i) => {
    const n = i + 1;
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h && !line.startsWith("###")) {
      cur = { heading: h[1]!, line: n, description: [], fields: [], relations: [] };
      raws.push(cur);
      table = null;
      return;
    }
    if (!cur) return;
    const c: Raw = cur;
    const meta = /^-\s*(id|group|de)\s*:\s*(.+?)\s*$/.exec(line);
    if (meta && !table && c.description.length === 0) {
      const v = unticked(meta[2]!);
      if (meta[1] === "id") c.id = v;
      else if (meta[1] === "group") c.group = v;
      else c.de = v;
      return;
    }
    if (/^\*\*Fields\*\*/.test(line.trim())) { table = "fields"; headerSeen = false; return; }
    if (/^\*\*Relations\*\*/.test(line.trim())) { table = "relations"; headerSeen = false; return; }
    if (table && isTable(line)) {
      if (isSeparator(line)) return;
      if (!headerSeen) { headerSeen = true; return; }
      (table === "fields" ? c.fields : c.relations).push({ cells: cells(line), line: n });
      return;
    }
    if (table && line.trim() === "") return;
    if (!table && c.id && line.trim() && !line.startsWith("-")) c.description.push(line.trim());
  });

  // Sections without an id are prose (like "How this file is read"); everything else is an entity.
  const entities = raws.filter((r) => r.id !== undefined);
  const byName = new Map<string, Raw>();
  for (const r of entities) {
    if (!/^[a-z][a-z0-9_]*$/.test(r.id!)) problems.push(`line ${r.line}: "${r.heading}" has an invalid id "${r.id}" (lower case letters, digits and _)`);
    if (!r.group || !GROUPS.includes(r.group as Group)) problems.push(`line ${r.line}: "${r.heading}" needs a group, one of ${GROUPS.join(", ")}`);
    if (!r.de) problems.push(`line ${r.line}: "${r.heading}" needs a German name (- de: …)`);
    if (entities.filter((x) => x.id === r.id).length > 1) problems.push(`line ${r.line}: the id "${r.id}" is used twice`);
    byName.set(r.heading.toLowerCase(), r);
    byName.set(r.id!.toLowerCase(), r);
  }

  const types: EntityType[] = entities.map((r) => ({
    type: r.id!,
    label: { en: r.heading, de: r.de ?? r.heading },
    group: (GROUPS.includes(r.group as Group) ? r.group : "organisation") as Group,
    description: r.description.join(" "),
    attributes: r.fields.map((f) => {
      if (!f.cells[0]) problems.push(`line ${f.line}: a field needs a name`);
      return { name: f.cells[0] ?? "", type: (f.cells[1] ?? "").replace(/\s*\/\s*/g, " | "), description: f.cells[2] ?? "" };
    }),
  }));

  const relations: Relation[] = [];
  for (const r of entities) {
    for (const row of r.relations) {
      const [rel, label, to, card, kind, description] = row.cells;
      const where = `line ${row.line} ("${r.heading}")`;
      const id = unticked(rel ?? "");
      if (!/^[a-z][a-z0-9_]*$/.test(id)) { problems.push(`${where}: relation "${rel}" needs an id like \`has_step\``); continue; }
      const target = byName.get(String(to ?? "").toLowerCase());
      if (!target) { problems.push(`${where}: "${to}" is not an entity in this file`); continue; }
      const m = /^\s*(\S+)\s*(?:→|->)\s*(\S+)\s*$/.exec(card ?? "");
      if (!m || !CARDS.includes(m[1] as Card) || !CARDS.includes(m[2] as Card)) { problems.push(`${where}: cardinality "${card}" must look like "0..1 → 0..*" (values ${CARDS.join(", ")})`); continue; }
      const k = (kind ?? "stated").toLowerCase();
      if (!["stated", "derived", "shortcut"].includes(k)) problems.push(`${where}: kind "${kind}" must be stated, derived or shortcut`);
      const [en, de] = String(label ?? id).split(/\s+\/\s+/);
      if (relations.some((x) => x.kind === id && x.from === r.id && x.to === target.id)) problems.push(`${where}: \`${id}\` to ${target.heading} is listed twice`);
      relations.push({
        kind: id, label: { en: en || id, de: de || en || id }, from: r.id!, to: target.id!, fromCard: m[1] as Card, toCard: m[2] as Card, description: description ?? "",
        ...(k === "shortcut" ? { shortcut: true } : {}), ...(k === "derived" ? { derived: true } : {}),
      });
    }
  }
  if (!types.length) problems.push("no entities found (each needs a ## heading and a - id: line)");
  if (problems.length) throw new OntologyError(problems);
  return { types, relations };
}

// ---- Loading, with the last valid version kept when an edit breaks the file -------------------------------

export const ONTOLOGY_FILE = process.env.ONTOLOGY_FILE ?? fileURLToPath(new URL("../../../docs/ontology.md", import.meta.url));

let current: Ontology = { types: [], relations: [] };
let error: string[] | null = null;
let loadedAt: string | null = null;
let mtime = 0;

/** Reads the file again. Returns whether something changed (a new valid version, or a new error). */
export function reloadOntology(file = ONTOLOGY_FILE): boolean {
  try {
    const parsed = parseOntology(readFileSync(file, "utf8"));
    const changed = JSON.stringify(parsed) !== JSON.stringify(current) || error !== null;
    current = parsed;
    error = null;
    loadedAt = new Date().toISOString();
    return changed;
  } catch (e) {
    const next = e instanceof OntologyError ? e.problems : [e instanceof Error ? e.message : String(e)];
    const changed = JSON.stringify(next) !== JSON.stringify(error);
    error = next;
    return changed;
  }
}

/** The current ontology. Reads the file again when it changed on disk, so edits show up without a restart. */
export function ontology(): { ontology: Ontology; error: string[] | null; loadedAt: string | null; file: string; changed: boolean } {
  let changed = false;
  try {
    const m = statSync(ONTOLOGY_FILE).mtimeMs;
    if (m !== mtime) {
      const first = mtime === 0;
      mtime = m;
      changed = reloadOntology() && !first;
    }
  } catch {
    if (!error) error = [`${ONTOLOGY_FILE} cannot be read`];
  }
  return { ontology: current, error, loadedAt, file: ONTOLOGY_FILE, changed };
}
