import type { ContextGraph } from "./context.js";
import { ontology, type Card, type Relation } from "./ontologyDoc.js";

/**
 * The declared schema of the context model comes from docs/ontology.md (see ontologyDoc.ts).
 * Here the graph is checked against it, and the schema view gets it with live counts.
 */

export type { Card, EntityType, Group, Relation } from "./ontologyDoc.js";

/** Entity types and relations, as docs/ontology.md declares them right now. */
export const schemaNow = () => ontology().ontology;

const max = (c: Card) => (c === "1" || c === "0..1" ? 1 : Infinity);
const relKey = (kind: string, from: string, to: string) => `${kind}|${from}|${to}`;

/** Where the graph does not match the schema: relations that are not declared, and "at most one" that is exceeded. */
export function checkSchema(graph: ContextGraph, schema = schemaNow()): { unknownTypes: { type: string; count: number }[]; undeclared: { kind: string; from: string; to: string; count: number }[]; tooMany: { relation: Relation; node: string; count: number }[] } {
  const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const known = new Set(schema.types.map((t) => t.type));
  const unknownTypes = new Map<string, number>();
  for (const n of graph.nodes) if (!known.has(n.type)) unknownTypes.set(n.type, (unknownTypes.get(n.type) ?? 0) + 1);
  const decl = new Map(schema.relations.map((x) => [relKey(x.kind, x.from, x.to), x]));
  const undeclared = new Map<string, { kind: string; from: string; to: string; count: number }>();
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const e of graph.edges) {
    const from = types.get(e.source)!;
    const to = types.get(e.target)!;
    if (!known.has(from) || !known.has(to)) continue;
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
  return { unknownTypes: [...unknownTypes].map(([type, count]) => ({ type, count })), undeclared: [...undeclared.values()], tooMany };
}

/** The schema with how many items and links of each kind the office has right now. */
export function schemaView(graph: ContextGraph) {
  const doc = ontology();
  const schema = doc.ontology;
  const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const count = new Map<string, number>();
  for (const n of graph.nodes) count.set(n.type, (count.get(n.type) ?? 0) + 1);
  const links = new Map<string, number>();
  for (const e of graph.edges) {
    const k = relKey(e.kind, types.get(e.source)!, types.get(e.target)!);
    links.set(k, (links.get(k) ?? 0) + 1);
  }
  return {
    types: schema.types.map((t) => ({ ...t, count: count.get(t.type) ?? 0 })),
    relations: schema.relations.map((x) => ({ ...x, count: links.get(relKey(x.kind, x.from, x.to)) ?? 0 })),
    source: { file: "docs/ontology.md", loadedAt: doc.loadedAt, error: doc.error },
  };
}
