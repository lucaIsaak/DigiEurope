import { CONNECTORS, NODE_CATALOG, PROCESS_CATALOG, factCatalog, ruleSelection, type Bilingual, type CatalogNode, type Check, type Operand } from "@digieurope/shared";
import { allTemplates } from "./cases.js";
import { CONNECTOR_CONTRACTS, DATA_ITEMS, collectedFrom } from "./contracts.js";
import { people, processVersions, type ContextEdgeKind, type ContextNode } from "./context.js";
import { PEER_OFFICES } from "./offices.js";
import type { Store } from "./store.js";

/**
 * The design-time entities below the core graph: steps and their order, connector actions and their data contracts,
 * template fields and the rules that read them, roles, teams, deputies, legal sources, the process catalogue,
 * other offices and the reference model.
 */

type EdgeFn = (source: string, target: string, kind: ContextEdgeKind, draftOnly?: boolean, derived?: boolean) => void;

const b = (de: string, en: string): Bilingual => ({ de, en });
const same = (x: string): Bilingual => ({ de: x, en: x });

/** Every fact path a rule's check looks at. */
export function refsOf(check: Check | undefined): string[] {
  if (!check) return [];
  const op = (o: Operand | Operand[]): string[] => (Array.isArray(o) ? o.flatMap(op) : o && typeof o === "object" && "ref" in o ? [o.ref] : []);
  if ("all" in check) return check.all.flatMap(refsOf);
  if ("any" in check) return check.any.flatMap(refsOf);
  if ("not" in check) return refsOf(check.not);
  if ("truthy" in check) return op(check.truthy);
  const pair = ("eq" in check ? check.eq : "gte" in check ? check.gte : "lte" in check ? check.lte : check.in) as Operand[];
  return pair.flatMap(op);
}

/** The node a fact path belongs to: a template field or signature, the template itself ("uploaded"), or an application fact. */
export function factNodeId(path: string): string {
  const m = /^docs\.([^.]+)\.(present|fields\.[^.]+|sig\.[^.]+)$/.exec(path);
  if (m) return m[2] === "present" ? `template:${m[1]}` : `field:docs.${m[1]}.${m[2]}`;
  return `field:${path}`;
}

export function extendGraph(store: Store, nodes: Map<string, ContextNode>, edge: EdgeFn) {
  const add = (n: ContextNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const ppl = people(store);
  const templates = allTemplates(store);

  // Roles: the permissions people hold, as entities of their own.
  const ROLES: [string, Bilingual, (m: (typeof ppl.staff)[number]) => boolean][] = [
    ["caseworker", b("Sachbearbeitung", "Caseworker"), (m) => Boolean(m.isCaseworker)],
    ["designer", b("Prozessgestaltung", "Process designer"), (m) => m.canBuild && !m.isAdmin],
    ["admin", b("Administration", "Administrator"), (m) => m.isAdmin],
    ["extractor_owner", b("Verantwortung Extraktoren", "Extractor owner"), (m) => Boolean(m.canApproveTemplates)],
    ["oversight", b("Aufsicht", "Oversight"), (m) => Boolean(m.isOversight)],
  ];
  for (const [id, label, has] of ROLES) {
    if (!ppl.staff.some(has)) continue;
    add({ id: `role:${id}`, type: "role", label, sub: b("Rolle", "Role") });
    for (const m of ppl.staff.filter(has)) edge(`person:${m.id}`, `role:${id}`, "has_role");
  }
  // Deputies from the office's assignment table.
  for (const [who, sub] of Object.entries(store.assignment().away ?? {})) edge(`person:${sub}`, `person:${who}`, "deputizes_for");

  // The process catalogue: domain > service > variant.
  const walk = (list: CatalogNode[], parent?: string) => {
    for (const c of list) {
      const id = `catalog:${c.id}`;
      add({ id, type: "catalog", label: c.title, sub: c.children ? b("Katalog", "Catalogue") : b("Katalog · Variante", "Catalogue · variant") });
      if (parent) edge(id, parent, "part_of");
      if (c.children) walk(c.children, id);
    }
  };
  walk(PROCESS_CATALOG);
  for (const p of processVersions(store)) edge(`process:${p.catalogId}`, `catalog:${p.catalogId}`, "implements");
  // Other offices and the reference model of the oversight body.
  for (const o of PEER_OFFICES) {
    add({ id: `peer:${o.id}`, type: "peer", label: same(o.name), sub: b("Anderes Amt", "Other office") });
    for (const cat of Object.keys(o.processes)) edge(`peer:${o.id}`, `catalog:${cat}`, "implements");
  }
  add({ id: "reference:bafoeg.abroad", type: "reference", label: b("Referenzmodell Auslands-BAföG", "Reference model BAföG abroad"), sub: b("Aufsicht", "Oversight") });
  edge("reference:bafoeg.abroad", "catalog:bafoeg.abroad", "defines");
  for (const m of ppl.staff.filter((x) => x.isOversight)) edge(`person:${m.id}`, "reference:bafoeg.abroad", "maintains");

  // Legal sources the rules rest on, and the fields each rule reads.
  const known = new Set(factCatalog(templates).map((f) => f.path));
  const facts = new Map(factCatalog(templates).map((f) => [f.path, f]));
  for (const t of templates) {
    for (const f of t.fields) {
      const id = `field:docs.${t.id}.fields.${f.key}`;
      add({ id, type: "field", label: b(`${t.name.de} › ${f.label}`, `${t.name.en} › ${f.label}`), sub: b(`Feld · ${f.type}`, `Field · ${f.type}`) });
      edge(`template:${t.id}`, id, "has_field");
    }
    for (const s of t.signatures) {
      const id = `field:docs.${t.id}.sig.${s.key}`;
      add({ id, type: "field", label: b(`${t.name.de} › ${s.label}`, `${t.name.en} › ${s.label}`), sub: b("Unterschrift", "Signature") });
      edge(`template:${t.id}`, id, "has_field");
    }
  }
  for (const [id, r] of Object.entries(store.rules())) {
    const rule = (r.draft ?? r.live)?.rule;
    if (!rule) continue;
    const src = rule.source.label.trim();
    if (src) {
      const sid = `source:${src}`;
      add({ id: sid, type: "source", label: same(src), sub: rule.source.url ? same(rule.source.url) : b("Rechtsquelle", "Legal source") });
      edge(`rule:${id}`, sid, "based_on");
    }
    for (const path of new Set([...refsOf(rule.when), ...refsOf(rule.pass)])) {
      const nid = factNodeId(path);
      if (!nodes.has(nid)) {
        const f = facts.get(path);
        // A rule may read a field no template has any more: it still becomes a node, so the gap is visible.
        add({ id: nid, type: "field", label: f?.label ?? same(path), sub: known.has(path) ? b("Angabe im Antrag", "Application fact") : b("Unbekanntes Feld", "Unknown field"), ...(known.has(path) ? {} : { state: "unknown" }) });
      }
      edge(`rule:${id}`, nid, "reads");
    }
  }

  // Connector actions and the data they need.
  for (const d of DATA_ITEMS) add({ id: `data:${d.id}`, type: "data", label: d.label, sub: b(`Datenpunkt · ${d.source}`, `Data item · ${d.source}`) });
  for (const c of CONNECTORS) {
    for (const a of c.actions) {
      const id = `action:${c.id}.${a.id}`;
      add({ id, type: "action", label: a.label, sub: c.name });
      edge(`connector:${c.id}`, id, "offers");
      for (const need of CONNECTOR_CONTRACTS[c.id]?.[a.id] ?? []) edge(id, `data:${need}`, "needs");
    }
  }

  // Steps of each process (the draft if there is one), their order and what each step uses.
  const teams = new Set<string>();
  for (const p of processVersions(store)) {
    const def = p.current;
    const pid = `process:${p.catalogId}`;
    const sid = (nodeId: string) => `step:${p.catalogId}:${nodeId}`;
    for (const n of def.nodes) {
      const spec = NODE_CATALOG[n.kind];
      add({ id: sid(n.id), type: "step", label: n.name ? same(n.name) : spec?.title ?? same(n.kind), sub: b(`${spec?.title.de ?? n.kind} · ${def.name}`, `${spec?.title.en ?? n.kind} · ${def.name}`), ...(p.draft ? { state: "draft" } : {}) });
      edge(pid, sid(n.id), "has_step");
      const rules = ruleSelection(n);
      if (n.kind === "run_rules" && rules) for (const r of rules) edge(sid(n.id), `rule:${r}`, "uses_rule");
      if (n.config.template) edge(sid(n.id), `message:${String(n.config.template)}`, "sends");
      if (n.kind === "connector") {
        edge(sid(n.id), `connector:${String(n.config.system)}`, "calls");
        edge(sid(n.id), `action:${String(n.config.system)}.${String(n.config.action)}`, "invokes");
      }
      if (n.kind === "human_task") for (const d of DATA_ITEMS.filter((x) => x.source === "decision")) edge(sid(n.id), `data:${d.id}`, "provides");
      if (n.kind === "assign_team" && n.config.team) {
        const team = String(n.config.team);
        if (!teams.has(team)) {
          teams.add(team);
          add({ id: `team:${team}`, type: "team", label: same(team), sub: b("Team", "Team") });
        }
        edge(sid(n.id), `team:${team}`, "routes_to");
      }
    }
    for (const e of def.edges) edge(sid(e.source), sid(e.target), "next");
    // Questions of the process become fields; collected data items point to where they come from.
    for (const i of def.inputs.filter((x) => x.type === "info")) {
      const id = `field:info.${i.ref}`;
      add({ id, type: "field", label: i.question?.label ?? same(i.ref), sub: b("Frage im Antrag", "Question on the application") });
      edge(pid, id, "asks");
    }
    for (const d of DATA_ITEMS.filter((x) => x.source === "collected")) {
      const from = collectedFrom(d, def, templates);
      if (from?.template) edge(`field:docs.${from.template}.fields.${from.field}`, `data:${d.id}`, "provides");
      if (from?.question) edge(`field:info.${from.question}`, `data:${d.id}`, "provides");
    }
  }
}
