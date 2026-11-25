import type { Bilingual } from "@digieurope/shared";
import type { ContextEdgeKind, ContextGraph, ContextNodeType } from "./context.js";

/**
 * The declared schema of the context model: which kinds of things exist, what each one holds,
 * and which relations are allowed between them and how many. The graph is checked against it,
 * and the schema view draws it.
 */

export type Card = "1" | "0..1" | "0..*" | "1..*";
export type Group = "organisation" | "process" | "rules" | "documents" | "systems" | "federal";

export interface EntityType {
  type: ContextNodeType;
  label: Bilingual;
  group: Group;
  attributes: { name: string; type: string }[];
}

export interface Relation {
  kind: ContextEdgeKind;
  from: ContextNodeType;
  to: ContextNodeType;
  /** How many "from" items one "to" item has, and how many "to" items one "from" item has. */
  fromCard: Card;
  toCard: Card;
  /** A shortcut that follows from other relations (for example Process → Rule through its steps). Not drawn in the schema view. */
  shortcut?: boolean;
  /** Inferred, not stated in the data. */
  derived?: boolean;
}

const b = (de: string, en: string): Bilingual => ({ de, en });
const a = (...xs: [string, string][]) => xs.map(([name, type]) => ({ name, type }));

export const ENTITY_TYPES: EntityType[] = [
  { type: "office", label: b("Amt", "Office"), group: "organisation", attributes: a(["name", "text"], ["languages", "list"], ["slaDays", "number"]) },
  { type: "person", label: b("Person", "Person"), group: "organisation", attributes: a(["name", "text"], ["title", "text"]) },
  { type: "role", label: b("Rolle", "Role"), group: "organisation", attributes: a(["name", "text"]) },
  { type: "team", label: b("Team", "Team"), group: "organisation", attributes: a(["name", "text"]) },
  { type: "process", label: b("Prozess", "Process"), group: "process", attributes: a(["name", "text"], ["version", "number"], ["state", "live | draft | changed"], ["owner", "text"], ["changeNote", "text"]) },
  { type: "step", label: b("Schritt", "Step"), group: "process", attributes: a(["name", "text"], ["kind", "step kind"], ["purpose", "text"], ["config", "settings"]) },
  { type: "message", label: b("Nachrichtenvorlage", "Message template"), group: "process", attributes: a(["name", "text"], ["version", "number"], ["subject", "de / en"], ["body", "de / en"], ["state", "live | draft"]) },
  { type: "rule", label: b("Regel", "Rule"), group: "rules", attributes: a(["id", "text"], ["title", "de / en"], ["version", "number"], ["scope", "federal | office"], ["severity", "blocker | warning"], ["state", "live | draft | paused"]) },
  { type: "source", label: b("Rechtsquelle", "Legal source"), group: "rules", attributes: a(["label", "text"], ["url", "link"]) },
  { type: "template", label: b("Vorlage", "Template"), group: "documents", attributes: a(["name", "de / en"], ["formblatt", "text"], ["title", "text"], ["providedBy", "student | parents | …"], ["confirmed", "yes / no"]) },
  { type: "field", label: b("Feld", "Field"), group: "documents", attributes: a(["key", "text"], ["label", "text"], ["type", "text | number | date | yesno"], ["required", "yes / no"]) },
  { type: "data", label: b("Datenpunkt", "Data item"), group: "documents", attributes: a(["id", "text"], ["label", "de / en"], ["source", "system | application | decision | collected"]) },
  { type: "proposal", label: b("Vorlagenvorschlag", "Template proposal"), group: "documents", attributes: a(["name", "text"], ["status", "draft | submitted | …"], ["proposedAt", "date"]) },
  { type: "connector", label: b("Verbindung", "Connector"), group: "systems", attributes: a(["name", "de / en"], ["enabled", "yes / no"], ["mode", "sandbox | live"], ["lastTest", "date, ok"]) },
  { type: "action", label: b("Aktion", "Action"), group: "systems", attributes: a(["id", "text"], ["label", "de / en"]) },
  { type: "catalog", label: b("Katalogeintrag", "Catalogue entry"), group: "federal", attributes: a(["id", "text"], ["title", "de / en"], ["level", "domain | service | variant"]) },
  { type: "peer", label: b("Anderes Amt", "Other office"), group: "federal", attributes: a(["name", "text"], ["city", "text"]) },
  { type: "reference", label: b("Referenzmodell", "Reference model"), group: "federal", attributes: a(["name", "text"], ["process", "process"], ["settings", "settings"]) },
];

const r = (kind: ContextEdgeKind, from: ContextNodeType, to: ContextNodeType, fromCard: Card, toCard: Card, extra: Partial<Relation> = {}): Relation => ({ kind, from, to, fromCard, toCard, ...extra });

export const RELATIONS: Relation[] = [
  // Organisation
  r("heads", "person", "office", "0..1", "0..1"),
  r("oversees", "person", "office", "0..*", "0..*"),
  r("reports_to", "person", "person", "0..*", "0..1", { derived: true }),
  r("deputizes_for", "person", "person", "0..*", "0..*"),
  r("has_role", "person", "role", "1..*", "0..*"),
  // Process design
  r("runs", "office", "process", "0..1", "0..*"),
  r("owns", "person", "process", "0..1", "0..*"),
  r("has_step", "process", "step", "1", "1..*"),
  r("next", "step", "step", "0..*", "0..*"),
  r("uses_rule", "step", "rule", "0..*", "0..*"),
  r("sends", "step", "message", "0..*", "0..1"),
  r("calls", "step", "connector", "0..*", "0..1"),
  r("invokes", "step", "action", "0..*", "0..1"),
  r("routes_to", "step", "team", "0..*", "0..1"),
  r("provides", "step", "data", "0..*", "0..*"),
  r("asks", "process", "field", "0..*", "0..*"),
  r("requires", "process", "template", "0..*", "0..*"),
  r("uses_rule", "process", "rule", "0..*", "0..*", { shortcut: true }),
  r("sends", "process", "message", "0..*", "0..*", { shortcut: true }),
  r("calls", "process", "connector", "0..*", "0..*", { shortcut: true }),
  r("wrote", "person", "message", "0..*", "0..*"),
  r("approved", "person", "message", "0..*", "0..*"),
  // Rules and law
  r("wrote", "person", "rule", "0..*", "0..*"),
  r("approved", "person", "rule", "0..*", "0..*"),
  r("based_on", "rule", "source", "0..*", "0..1"),
  r("reads", "rule", "field", "0..*", "0..*"),
  r("reads", "rule", "template", "0..*", "0..*"),
  // Documents and data
  r("has_field", "template", "field", "0..1", "0..*"),
  r("owns", "person", "template", "0..1", "0..*"),
  r("provides", "field", "data", "0..*", "0..*"),
  r("proposed", "person", "proposal", "1", "0..*"),
  // Systems
  r("administers", "person", "connector", "0..*", "0..*"),
  r("offers", "connector", "action", "1", "1..*"),
  r("needs", "action", "data", "0..*", "0..*"),
  // Federal level
  r("implements", "process", "catalog", "0..*", "1"),
  r("implements", "peer", "catalog", "0..*", "0..*"),
  r("part_of", "catalog", "catalog", "0..*", "0..1"),
  r("defines", "reference", "catalog", "0..1", "1"),
  r("maintains", "person", "reference", "0..*", "0..*"),
];

const max = (c: Card) => (c === "1" || c === "0..1" ? 1 : Infinity);
const relKey = (kind: string, from: string, to: string) => `${kind}|${from}|${to}`;

/** Where the graph does not match the schema: relations that are not declared, and "at most one" that is exceeded. */
export function checkSchema(graph: ContextGraph): { undeclared: { kind: string; from: string; to: string; count: number }[]; tooMany: { relation: Relation; node: string; count: number }[] } {
  const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const decl = new Map(RELATIONS.map((x) => [relKey(x.kind, x.from, x.to), x]));
  const undeclared = new Map<string, { kind: string; from: string; to: string; count: number }>();
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const e of graph.edges) {
    const from = types.get(e.source)!;
    const to = types.get(e.target)!;
    const key = relKey(e.kind, from, to);
    if (!decl.has(key)) {
      const u = undeclared.get(key) ?? { kind: e.kind, from, to, count: 0 };
      u.count += 1;
      undeclared.set(key, u);
      continue;
    }
    outCount.set(`${key}|${e.source}`, (outCount.get(`${key}|${e.source}`) ?? 0) + 1);
    inCount.set(`${key}|${e.target}`, (inCount.get(`${key}|${e.target}`) ?? 0) + 1);
  }
  const tooMany: { relation: Relation; node: string; count: number }[] = [];
  for (const [k, n] of outCount) {
    const [kind, from, to, node] = k.split("|") as [string, string, string, string];
    const rel = decl.get(relKey(kind, from, to))!;
    if (n > max(rel.toCard)) tooMany.push({ relation: rel, node, count: n });
  }
  for (const [k, n] of inCount) {
    const [kind, from, to, node] = k.split("|") as [string, string, string, string];
    const rel = decl.get(relKey(kind, from, to))!;
    if (n > max(rel.fromCard)) tooMany.push({ relation: rel, node, count: n });
  }
  return { undeclared: [...undeclared.values()], tooMany };
}

/** The schema with how many items and links of each kind the office has right now. */
export function schemaView(graph: ContextGraph) {
  const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const count = new Map<string, number>();
  for (const n of graph.nodes) count.set(n.type, (count.get(n.type) ?? 0) + 1);
  const links = new Map<string, number>();
  for (const e of graph.edges) {
    const k = relKey(e.kind, types.get(e.source)!, types.get(e.target)!);
    links.set(k, (links.get(k) ?? 0) + 1);
  }
  return {
    types: ENTITY_TYPES.map((t) => ({ ...t, count: count.get(t.type) ?? 0 })),
    relations: RELATIONS.map((x) => ({ ...x, count: links.get(relKey(x.kind, x.from, x.to)) ?? 0 })),
  };
}
