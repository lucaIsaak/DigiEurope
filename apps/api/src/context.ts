import { createHash } from "node:crypto";
import { CONNECTORS, DEFAULT_CATEGORY, diffProcess, factCatalog, processDependencies, type Bilingual, type ProcessDef, type ProcessIssue, type StaffMember } from "@digieurope/shared";
import { allTemplates } from "./cases.js";
import { missingInputs } from "./contracts.js";
import { extendGraph, factNodeId, refsOf } from "./ontology.js";
import type { Store } from "./store.js";

/**
 * The context model of the office: who and what exists, and how it is connected.
 * It is built from the store every time, so it can never drift from what really runs.
 * The watcher reads it on a schedule and after every change and turns what it finds into findings for a named person.
 */

/** Core types are always drawn; detail types (steps, fields, actions, roles, teams, legal sources) appear when something they belong to is in focus. */
export type ContextNodeType =
  | "office" | "person" | "process" | "rule" | "template" | "proposal" | "message" | "connector"
  | "catalog" | "peer" | "reference"
  | "step" | "action" | "field" | "data" | "role" | "team" | "source";
export type Severity = "problem" | "warning" | "info";

export interface ContextNode {
  id: string;
  type: ContextNodeType;
  label: Bilingual;
  sub?: Bilingual;
  /** Lifecycle of the item: live, draft, changed (live with a draft waiting), paused, off. */
  state?: string;
  /** Worst open finding about this node. */
  severity?: Severity;
}

export type ContextEdgeKind =
  | "runs" | "heads" | "reports_to" | "oversees" | "owns" | "wrote" | "approved" | "uses_rule" | "requires" | "sends" | "calls" | "proposed" | "administers"
  | "has_step" | "next" | "invokes" | "offers" | "needs" | "provides" | "has_field" | "reads" | "asks" | "routes_to"
  | "has_role" | "deputizes_for" | "based_on" | "implements" | "part_of" | "defines" | "maintains";

export interface ContextEdge {
  id: string;
  source: string;
  target: string;
  kind: ContextEdgeKind;
  /** Only the draft of a process has this connection, the live version does not. */
  draftOnly?: boolean;
  /** Not stated in the data but inferred (for example the reporting line). */
  derived?: boolean;
}

export interface ContextGraph {
  nodes: ContextNode[];
  edges: ContextEdge[];
}

export interface Finding {
  /** Stable: the same problem keeps its id from run to run. */
  id: string;
  severity: Severity;
  kind: string;
  title: Bilingual;
  detail: Bilingual;
  recommendation: Bilingual;
  /** The nodes this finding is about. */
  subjects: string[];
  /** Processes that are affected downstream. */
  affects: Bilingual[];
  owner: { id: string; name: string } | null;
  /** Where to fix it in the app. */
  href?: string;
  firstSeen: string;
  lastSeen: string;
}

export interface WatchRun {
  id: number;
  at: string;
  trigger: "schedule" | "event" | "manual" | "startup";
  reason: Bilingual;
  by?: string;
  ms: number;
  changed: Bilingual[];
  open: number;
  added: number;
  resolved: number;
}

export interface WatchDeps {
  store: Store;
  now: () => Date;
  /** Validation of a process, including the office's templates and messages. */
  validate: (def: ProcessDef) => ProcessIssue[];
  /** Runs the process's own sample cases. */
  runTests: (def: ProcessDef) => Promise<{ id: string; name: string; ok: boolean; failures: string[] }[]>;
  intervalMs: number;
}

const b = (de: string, en: string): Bilingual => ({ de, en });
const same = (x: string): Bilingual => ({ de: x, en: x });
const RULE_STALE_DAYS = 3;
const RANK: Record<Severity, number> = { problem: 3, warning: 2, info: 1 };

// ---- People: who is responsible for what --------------------------------------------------------------

export function people(store: Store) {
  const staff = store.staff();
  const admin = staff.find((m) => m.isAdmin) ?? null;
  const extractorOwner = staff.find((m) => m.canApproveTemplates && !m.isAdmin) ?? admin;
  const byName = (name: string | undefined) => (name ? staff.find((m) => m.name === name) ?? null : null);
  const ref = (m: StaffMember | null) => (m ? { id: m.id, name: m.name } : null);
  const processOwner = (def: ProcessDef) => byName(def.owner) ?? byName(def.updatedBy) ?? staff.find((m) => m.canBuild && !m.isAdmin) ?? admin;
  /** Two-person rule: whoever approves must not be the author. The administrator, unless they wrote it. */
  const approverFor = (author: string) => (admin && admin.name !== author ? admin : staff.find((m) => (m.canBuild || m.isAdmin) && m.name !== author) ?? null);
  return { staff, admin, extractorOwner, byName, ref, processOwner, approverFor };
}

export const processVersions = (store: Store) =>
  Object.entries(store.processes()).map(([catalogId, p]) => ({ catalogId, live: p.live, draft: p.draft ?? null, current: (p.draft ?? p.live)! })).filter((p) => p.current);

// ---- The graph ------------------------------------------------------------------------------------

export function buildGraph(store: Store): ContextGraph {
  const nodes = new Map<string, ContextNode>();
  const edges: ContextEdge[] = [];
  const seen = new Set<string>();
  const edge = (source: string, target: string, kind: ContextEdgeKind, draftOnly = false, derived = false) => {
    if (!nodes.has(source) || !nodes.has(target)) return;
    const id = `${kind}:${source}>${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, source, target, kind, ...(draftOnly ? { draftOnly } : {}), ...(derived ? { derived } : {}) });
  };
  const ppl = people(store);
  const personId = (name: string | undefined) => {
    const m = ppl.byName(name);
    return m ? `person:${m.id}` : null;
  };

  nodes.set("office", { id: "office", type: "office", label: same(store.config().name), sub: b("Amt", "Office") });
  for (const m of ppl.staff) nodes.set(`person:${m.id}`, { id: `person:${m.id}`, type: "person", label: same(m.name), sub: same(m.title) });

  const rules = store.rules();
  for (const [id, r] of Object.entries(rules)) {
    const rule = r.draft?.rule ?? r.live?.rule;
    if (!rule) continue;
    const state = r.draft && r.live ? "changed" : r.draft ? "draft" : r.paused ? "paused" : "live";
    nodes.set(`rule:${id}`, { id: `rule:${id}`, type: "rule", label: rule.title, sub: same(`${id} · v${rule.version}`), state });
  }
  const confirmed = store.config().templateChecks;
  for (const t of allTemplates(store)) nodes.set(`template:${t.id}`, { id: `template:${t.id}`, type: "template", label: t.name, sub: same(t.formblatt ?? t.title), state: confirmed[t.id] ? "live" : "unconfirmed" });
  for (const p of store.proposals().filter((x) => x.status === "submitted" || x.status === "draft")) nodes.set(`proposal:${p.id}`, { id: `proposal:${p.id}`, type: "proposal", label: same(p.name), sub: b("Vorschlag für eine Vorlage", "Template proposal"), state: p.status });
  for (const [id, m] of Object.entries(store.messages())) {
    const tpl = (m.draft ?? m.live)?.tpl;
    if (tpl) nodes.set(`message:${id}`, { id: `message:${id}`, type: "message", label: same(tpl.name), sub: b("Nachrichtenvorlage", "Message template"), state: m.draft && m.live ? "changed" : m.draft ? "draft" : "live" });
  }
  const conns = store.connections();
  for (const c of CONNECTORS) {
    const s = conns[c.id];
    nodes.set(`connector:${c.id}`, { id: `connector:${c.id}`, type: "connector", label: c.name, sub: s ? b(s.mode === "live" ? "Echtbetrieb" : "Testumgebung", s.mode === "live" ? "Live" : "Sandbox") : undefined, state: s?.enabled === false ? "off" : "live" });
  }
  const versions = processVersions(store);
  for (const p of versions) nodes.set(`process:${p.catalogId}`, { id: `process:${p.catalogId}`, type: "process", label: same(p.current.name), sub: same(p.live ? `v${p.live.version}${p.draft ? " + draft" : ""}` : "draft"), state: p.draft && p.live ? "changed" : p.draft ? "draft" : "live" });

  // People and the office: the hierarchy.
  for (const m of ppl.staff) {
    const id = `person:${m.id}`;
    if (m.isOversight) edge(id, "office", "oversees");
    else if (m.isAdmin) edge(id, "office", "heads");
    else if (ppl.admin) edge(id, `person:${ppl.admin.id}`, "reports_to", false, true);
  }
  if (ppl.admin) for (const c of CONNECTORS) edge(`person:${ppl.admin.id}`, `connector:${c.id}`, "administers");
  if (ppl.extractorOwner) for (const t of allTemplates(store)) edge(`person:${ppl.extractorOwner.id}`, `template:${t.id}`, "owns");

  // Who wrote and who approved.
  for (const [id, r] of Object.entries(rules)) {
    for (const v of [r.live, r.draft]) {
      const a = personId(v?.author);
      if (a) edge(a, `rule:${id}`, "wrote");
      const ap = personId(v?.approvedBy);
      if (ap) edge(ap, `rule:${id}`, "approved");
    }
  }
  for (const [id, m] of Object.entries(store.messages())) {
    for (const v of [m.live, m.draft]) {
      const a = personId(v?.author);
      if (a) edge(a, `message:${id}`, "wrote");
      const ap = personId(v?.approvedBy);
      if (ap) edge(ap, `message:${id}`, "approved");
    }
  }
  for (const p of store.proposals()) {
    const a = personId(p.proposedBy);
    if (a) edge(a, `proposal:${p.id}`, "proposed");
  }

  // What each process depends on. The live version and the draft together; what only the draft has is marked.
  const liveRuleIds = Object.entries(rules).filter(([, r]) => r.live && !r.paused).map(([id]) => id);
  for (const p of versions) {
    const pid = `process:${p.catalogId}`;
    if (p.live) edge("office", pid, "runs");
    const owner = ppl.processOwner(p.current);
    if (owner) edge(`person:${owner.id}`, pid, "owns");
    const live = p.live ? processDependencies(p.live) : null;
    const draft = p.draft ? processDependencies(p.draft) : null;
    const add = (pick: (d: ReturnType<typeof processDependencies>) => string[], prefix: string, kind: ContextEdgeKind) => {
      const inLive = new Set(live ? pick(live) : []);
      for (const id of inLive) edge(pid, `${prefix}:${id}`, kind);
      for (const id of draft ? pick(draft) : []) if (!inLive.has(id)) edge(pid, `${prefix}:${id}`, kind, true);
    };
    add((d) => d.rules ?? liveRuleIds, "rule", "uses_rule");
    add((d) => d.documents, "template", "requires");
    add((d) => d.messages, "message", "sends");
    add((d) => d.systems, "connector", "calls");
  }
  extendGraph(store, nodes, edge);
  return { nodes: [...nodes.values()], edges };
}

/** A short fingerprint per node, to tell what changed between two runs. */
function signatures(store: Store): Map<string, { sig: string; label: Bilingual }> {
  const out = new Map<string, { sig: string; label: Bilingual }>();
  const h = (x: unknown) => createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 12);
  for (const p of processVersions(store)) out.set(`process:${p.catalogId}`, { sig: h([p.live?.version, p.draft]), label: same(p.current.name) });
  for (const [id, r] of Object.entries(store.rules())) out.set(`rule:${id}`, { sig: h([r.live?.rule.version, r.live?.approvedBy, r.paused, r.draft?.rule]), label: (r.draft ?? r.live)?.rule.title ?? same(id) });
  for (const [id, m] of Object.entries(store.messages())) out.set(`message:${id}`, { sig: h([m.live?.tpl.version, m.draft?.tpl]), label: same((m.draft ?? m.live)?.tpl.name ?? id) });
  for (const [id, c] of Object.entries(store.connections())) out.set(`connector:${id}`, { sig: h(c), label: CONNECTORS.find((x) => x.id === id)?.name ?? same(id) });
  const checks = store.config().templateChecks;
  for (const t of allTemplates(store)) out.set(`template:${t.id}`, { sig: h([t, checks[t.id], store.config().extraction[t.id]]), label: t.name });
  for (const p of store.proposals()) out.set(`proposal:${p.id}`, { sig: h(p.status), label: same(p.name) });
  for (const m of store.staff()) out.set(`person:${m.id}`, { sig: h(m), label: same(m.name) });
  return out;
}

// ---- The watcher ------------------------------------------------------------------------------------

type Draft = Omit<Finding, "firstSeen" | "lastSeen">;

export class Watcher {
  private findings = new Map<string, Finding>();
  private resolved: (Finding & { resolvedAt: string })[] = [];
  private runs: WatchRun[] = [];
  private last: Map<string, { sig: string; label: Bilingual }> | null = null;
  /** Results of the sample cases, kept as long as the process and what it depends on stay the same. */
  private testCache = new Map<string, { ok: boolean; failed: string[] }>();
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;

  constructor(private readonly deps: WatchDeps) {}

  /** Runs one sweep. Sweeps never overlap: a second one waits for the first. */
  run(trigger: WatchRun["trigger"], reason: Bilingual, by?: string): Promise<WatchRun> {
    const next = this.queue.then(() => this.sweep(trigger, reason, by));
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Waits for sweeps that are already running. */
  settled = () => this.queue;

  get hasRun() {
    return this.runs.length > 0;
  }

  /** Forgets everything, for a demo reset. */
  reset() {
    this.findings.clear();
    this.resolved = [];
    this.last = null;
    this.testCache.clear();
  }

  state(graph = buildGraph(this.deps.store)) {
    const sev = new Map<string, Severity>();
    for (const f of this.findings.values()) for (const s of f.subjects) if (!sev.has(s) || RANK[f.severity] > RANK[sev.get(s)!]) sev.set(s, f.severity);
    const last = this.runs.at(-1) ?? null;
    return {
      graph: { nodes: graph.nodes.map((n) => (sev.has(n.id) ? { ...n, severity: sev.get(n.id) } : n)), edges: graph.edges },
      findings: [...this.findings.values()].sort((x, y) => RANK[y.severity] - RANK[x.severity] || x.firstSeen.localeCompare(y.firstSeen)),
      resolved: [...this.resolved].reverse().slice(0, 12),
      runs: [...this.runs].reverse(),
      schedule: { intervalMs: this.deps.intervalMs, lastRunAt: last?.at ?? null, nextRunAt: last ? new Date(Date.parse(this.lastScheduled ?? last.at) + this.deps.intervalMs).toISOString() : null },
    };
  }

  private lastScheduled: string | null = null;

  /** Open findings that need this person: their own, or everything for the administrator. */
  attentionFor(m: StaffMember) {
    return [...this.findings.values()].filter((f) => f.severity !== "info" && (m.isAdmin || f.owner?.id === m.id)).length;
  }

  private async sweep(trigger: WatchRun["trigger"], reason: Bilingual, by?: string): Promise<WatchRun> {
    const started = Date.now();
    const at = this.deps.now().toISOString();
    if (trigger === "schedule" || trigger === "startup") this.lastScheduled = at;
    const sigs = signatures(this.deps.store);
    const changed: Bilingual[] = [];
    if (this.last) {
      for (const [id, s] of sigs) {
        const before = this.last.get(id);
        if (!before) changed.push({ de: `Neu: ${s.label.de}`, en: `New: ${s.label.en}` });
        else if (before.sig !== s.sig) changed.push({ de: `Geändert: ${s.label.de}`, en: `Changed: ${s.label.en}` });
      }
      for (const [id, s] of this.last) if (!sigs.has(id)) changed.push({ de: `Entfernt: ${s.label.de}`, en: `Removed: ${s.label.en}` });
    }
    this.last = sigs;

    const found = await this.detect();
    let added = 0;
    const next = new Map<string, Finding>();
    for (const f of found) {
      const prev = this.findings.get(f.id);
      if (!prev) added += 1;
      next.set(f.id, { ...f, firstSeen: prev?.firstSeen ?? at, lastSeen: at });
    }
    const gone = [...this.findings.values()].filter((f) => !next.has(f.id));
    this.resolved = [...this.resolved, ...gone.map((f) => ({ ...f, resolvedAt: at }))].slice(-40);
    this.findings = next;

    const run: WatchRun = { id: ++this.seq, at, trigger, reason, ...(by ? { by } : {}), ms: Date.now() - started, changed: changed.slice(0, 20), open: next.size, added, resolved: gone.length };
    this.runs = [...this.runs, run].slice(-30);
    return run;
  }

  /** All checks. Deterministic: the same state always gives the same findings. */
  private async detect(): Promise<Draft[]> {
    const { store } = this.deps;
    const ppl = people(store);
    const out: Draft[] = [];
    const versions = processVersions(store);
    const conns = store.connections();
    const templates = allTemplates(store);
    const confirmed = store.config().templateChecks;
    const rules = store.rules();
    const now = this.deps.now();
    const usersOf = (pred: (def: ProcessDef) => boolean, liveOnly = false) =>
      versions.filter((p) => (p.live && pred(p.live)) || (!liveOnly && p.draft && pred(p.draft))).map((p) => same(p.current.name));

    // Connectors: switched off, an action the system does not offer, cases that stopped at the call.
    for (const c of CONNECTORS) {
      const s = conns[c.id];
      const calls = (d: ProcessDef) => d.nodes.some((n) => n.kind === "connector" && n.config.system === c.id);
      const live = usersOf(calls, true);
      if (s && !s.enabled && live.length) {
        out.push({
          id: `connector-off:${c.id}`, kind: "connector", severity: "problem",
          title: b(`${c.name.de} ist ausgeschaltet, wird aber aufgerufen`, `${c.name.en} is switched off but still called`),
          detail: b(`${live.length} veröffentlichte(r) Prozess(e) rufen dieses System auf. Diese Schritte schlagen fehl.`, `${live.length} published process(es) call this system. Those steps will fail.`),
          recommendation: b("Verbindung wieder einschalten oder den Schritt aus dem Prozess nehmen.", "Switch the connection back on, or take the step out of the process."),
          subjects: [`connector:${c.id}`], affects: live, owner: ppl.ref(ppl.admin), href: "/office/settings",
        });
      }
      if (s?.lastTest && !s.lastTest.ok && (live.length || usersOf(calls).length)) {
        out.push({
          id: `connector-test:${c.id}`, kind: "connector", severity: "warning",
          title: b(`Letzter Test von ${c.name.de} ist fehlgeschlagen`, `Last test of ${c.name.en} failed`),
          detail: b(`Getestet von ${s.lastTest.by}.`, `Tested by ${s.lastTest.by}.`),
          recommendation: b("Verbindung prüfen und erneut testen.", "Check the connection and test again."),
          subjects: [`connector:${c.id}`], affects: usersOf(calls), owner: ppl.ref(ppl.admin), href: "/office/settings",
        });
      }
      const failed = store.list().filter((a) => {
        if (!a.flow?.failed || !a.flow.error) return false;
        // Cases run on the process the portal feeds.
        const def = store.process(DEFAULT_CATEGORY)?.live;
        return def?.nodes.some((n) => n.id === a.flow!.error!.nodeId && n.kind === "connector" && n.config.system === c.id);
      });
      if (failed.length) {
        out.push({
          id: `connector-failures:${c.id}`, kind: "connector", severity: "problem",
          title: b(`${failed.length} Fall/Fälle bei ${c.name.de} hängen geblieben`, `${failed.length} case(s) stopped at ${c.name.en}`),
          detail: b(`Letzter Fehler: ${failed.at(-1)!.flow!.error!.message}`, `Last error: ${failed.at(-1)!.flow!.error!.message}`),
          recommendation: b("Ursache bei der Verbindung beheben, dann die Fälle im Eingang neu starten.", "Fix the cause at the connection, then restart the cases from the inbox."),
          subjects: [`connector:${c.id}`], affects: live, owner: ppl.ref(ppl.admin), href: "/office",
        });
      }
    }

    for (const p of versions) {
      for (const [def, isDraft] of [[p.live, false], [p.draft, true]] as const) {
        if (!def) continue;
        for (const n of def.nodes.filter((x) => x.kind === "connector")) {
          const c = CONNECTORS.find((x) => x.id === n.config.system);
          const action = String(n.config.action ?? "");
          if (!c || c.actions.some((a) => a.id === action)) continue;
          out.push({
            id: `connector-action:${p.catalogId}:${isDraft ? "draft" : "live"}:${n.id}`, kind: "connector", severity: isDraft ? "warning" : "problem",
            title: b(`Diese Verbindung braucht eine Anpassung: ${c.name.de}`, `This connector needs a modification: ${c.name.en}`),
            detail: b(`Der Schritt „${n.name ?? n.id}“ ruft „${action || "(keine Aktion)"}“ auf. ${c.name.de} bietet: ${c.actions.map((a) => a.label.de).join(", ")}.`, `Step “${n.name ?? n.id}” calls “${action || "(no action)"}”. ${c.name.en} offers: ${c.actions.map((a) => a.label.en).join(", ")}.`),
            recommendation: b("Eine angebotene Aktion wählen oder die Verbindung beim Systembetreiber erweitern lassen.", "Pick an action the system offers, or have the connector extended by the system's operator."),
            subjects: [`connector:${c.id}`, `process:${p.catalogId}`], affects: [same(def.name)], owner: ppl.ref(ppl.processOwner(def)), href: `/office/builder?category=${encodeURIComponent(p.catalogId)}`,
          });
        }
      }
    }

    // Lineage: every item a connector step needs must be provided earlier in the process.
    for (const p of versions) {
      for (const [def, isDraft] of [[p.live, false], [p.draft, true]] as const) {
        if (!def) continue;
        for (const n of def.nodes.filter((x) => x.kind === "connector")) {
          const missing = missingInputs(def, n.id, templates);
          if (!missing.length) continue;
          const c = CONNECTORS.find((x) => x.id === n.config.system);
          const name = c?.name ?? same(String(n.config.system));
          const collected = missing.some((m) => m.source === "collected");
          out.push({
            id: `lineage:${p.catalogId}:${isDraft ? "draft" : "live"}:${n.id}`, kind: "lineage", severity: isDraft ? "warning" : "problem",
            title: b(`Diese Verbindung braucht eine Anpassung: ${name.de} bekommt nicht alle Daten`, `This connector needs a modification: ${name.en} does not get all its data`),
            detail: b(
              `Der Schritt „${n.name ?? n.id}“ in „${def.name}“${isDraft ? " (Entwurf)" : ""} braucht ${missing.map((m) => m.label.de).join(", ")}, aber nichts davor im Prozess liefert das.`,
              `Step “${n.name ?? n.id}” in “${def.name}”${isDraft ? " (draft)" : ""} needs ${missing.map((m) => m.label.en).join(", ")}, but nothing earlier in the process provides it.`,
            ),
            recommendation: collected
              ? b(`Im Prozess eine Pflichtfrage „${missing.find((m) => m.source === "collected")!.label.de}“ ergänzen oder das Feld über einen Vorlagenvorschlag in ein Formular aufnehmen.`, `Add a required question “${missing.find((m) => m.source === "collected")!.label.en}” to the process, or add the field to a form through a template proposal.`)
              : b("Einen Schritt „Sachbearbeitung entscheidet“ vor diesen Schritt setzen.", "Put a “caseworker decides” step before this step."),
            subjects: [`process:${p.catalogId}`, `connector:${String(n.config.system)}`, `step:${p.catalogId}:${n.id}`, ...missing.map((m) => `data:${m.id}`)],
            affects: [same(def.name)], owner: ppl.ref(ppl.processOwner(def)), href: `/office/builder?category=${encodeURIComponent(p.catalogId)}`,
          });
        }
      }
    }
    // Rules that read a field no template has (any more).
    const knownFacts = new Set(factCatalog(templates).map((f) => f.path));
    for (const [id, r] of Object.entries(rules)) {
      const rule = (r.draft ?? r.live)?.rule;
      if (!rule) continue;
      const unknown = [...new Set([...refsOf(rule.when), ...refsOf(rule.pass)])].filter((x) => !knownFacts.has(x));
      if (!unknown.length) continue;
      out.push({
        id: `rule-field:${id}`, kind: "rule", severity: r.live && !r.paused ? "problem" : "warning",
        title: b(`Regel „${rule.title.de}“ liest ein Feld, das es nicht gibt`, `Rule “${rule.title.en}” reads a field that does not exist`),
        detail: b(`Unbekannt: ${unknown.join(", ")}. Wahrscheinlich wurde eine Vorlage geändert.`, `Unknown: ${unknown.join(", ")}. A template was probably changed.`),
        recommendation: b("Die Bedingung auf ein vorhandenes Feld umstellen oder das Feld in der Vorlage wieder aufnehmen.", "Point the condition at an existing field, or bring the field back into the template."),
        subjects: [`rule:${id}`, ...unknown.map(factNodeId)], affects: usersOf((d) => (processDependencies(d).rules ?? Object.keys(rules)).includes(id)), owner: ppl.ref(ppl.admin), href: `/office/rules?open=${encodeURIComponent(id)}`,
      });
    }

    // Templates a process requires but nobody tested and confirmed.
    for (const t of templates) {
      if (confirmed[t.id]) continue;
      const req = (d: ProcessDef) => d.inputs.some((i) => i.type === "document" && i.ref === t.id);
      const users = usersOf(req);
      if (!users.length) continue;
      out.push({
        id: `template-unconfirmed:${t.id}`, kind: "template", severity: usersOf(req, true).length ? "problem" : "warning",
        title: b(`Vorlage „${t.name.de}“ ist nicht bestätigt`, `Template “${t.name.en}” is not confirmed`),
        detail: b("Ein Prozess verlangt diese Vorlage, aber niemand hat sie mit einem Beispiel getestet und bestätigt.", "A process requires this template, but nobody has tested it with a sample and confirmed it."),
        recommendation: b("Mit einem Beispiel testen und bestätigen (Vorlagen › Test & bestätigen).", "Test it with a sample and confirm it (Templates › Test & confirm)."),
        subjects: [`template:${t.id}`], affects: users, owner: ppl.ref(ppl.extractorOwner), href: `/office/templates?open=${encodeURIComponent(t.id)}`,
      });
    }
    for (const pr of store.proposals().filter((x) => x.status === "submitted")) {
      out.push({
        id: `proposal:${pr.id}`, kind: "template", severity: "info",
        title: b(`Vorschlag „${pr.name}“ wartet auf Entscheidung`, `Proposal “${pr.name}” waits for a decision`),
        detail: b(`Eingereicht von ${pr.proposedBy}.`, `Submitted by ${pr.proposedBy}.`),
        recommendation: b("Annehmen und Lesemethode festlegen, oder mit Kommentar zurückgeben.", "Accept it and choose how it is read, or send it back with a comment."),
        subjects: [`proposal:${pr.id}`], affects: [], owner: ppl.ref(ppl.extractorOwner), href: "/office/templates",
      });
    }

    // Rules: changes waiting for the second person, failing sample cases, paused rules a process relies on.
    for (const [id, r] of Object.entries(rules)) {
      const rule = (r.draft ?? r.live)?.rule;
      if (!rule) continue;
      if (r.draft) {
        const days = Math.floor((now.getTime() - Date.parse(r.draft.createdAt)) / 86_400_000);
        const stale = days >= RULE_STALE_DAYS;
        out.push({
          id: `rule-approval:${id}`, kind: "rule", severity: stale ? "warning" : "info",
          title: b(`Regel „${rule.title.de}“ wartet ${stale ? `seit ${days} Tagen ` : ""}auf Freigabe`, `Rule “${rule.title.en}” has waited ${stale ? `${days} days ` : ""}for approval`),
          detail: b(`Geschrieben von ${r.draft.author}. Eine zweite Person muss sie freigeben.`, `Written by ${r.draft.author}. A second person has to approve it.`),
          recommendation: b("Änderung prüfen und freigeben oder verwerfen.", "Review the change and approve or discard it."),
          subjects: [`rule:${id}`], affects: [], owner: ppl.ref(ppl.approverFor(r.draft.author)), href: `/office/rules?open=${encodeURIComponent(id)}`,
        });
      }
      if (r.paused) {
        const users = usersOf((d) => (processDependencies(d).rules ?? []).includes(id), true);
        if (users.length) {
          out.push({
            id: `rule-paused:${id}`, kind: "rule", severity: "problem",
            title: b(`Ausgeschaltete Regel wird von einem Prozess verlangt: ${rule.title.de}`, `A process asks for a switched-off rule: ${rule.title.en}`),
            detail: b("Der Prozess wählt diese Regel ausdrücklich, sie läuft aber nicht. Anträge werden ohne diese Prüfung bearbeitet.", "The process picks this rule explicitly but it does not run. Applications are handled without this check."),
            recommendation: b("Regel wieder einschalten oder aus dem Prüfschritt nehmen.", "Switch the rule back on, or remove it from the check step."),
            subjects: [`rule:${id}`], affects: users, owner: ppl.ref(ppl.admin), href: `/office/rules?open=${encodeURIComponent(id)}`,
          });
        }
      }
    }

    // Processes: the live version must keep passing; a draft is a proposal that gets a recommendation.
    for (const p of versions) {
      if (p.live) {
        const issues = this.deps.validate(p.live);
        const tests = await this.tests(p.live);
        if (issues.length || !tests.ok) {
          out.push({
            id: `process-live:${p.catalogId}`, kind: "process", severity: "problem",
            title: b(`Veröffentlichter Prozess „${p.live.name}“ ist nicht mehr in Ordnung`, `Published process “${p.live.name}” is no longer sound`),
            detail: b(
              [...issues.map((i) => i.message.de), ...tests.failed.map((n) => `Testfall fehlgeschlagen: ${n}`)].slice(0, 4).join(" · "),
              [...issues.map((i) => i.message.en), ...tests.failed.map((n) => `Sample case failed: ${n}`)].slice(0, 4).join(" · "),
            ),
            recommendation: b("Etwas, wovon der Prozess abhängt, hat sich geändert. Im Builder prüfen und eine korrigierte Version veröffentlichen.", "Something the process depends on has changed. Check it in the builder and publish a corrected version."),
            subjects: [`process:${p.catalogId}`], affects: [same(p.live.name)], owner: ppl.ref(ppl.processOwner(p.live)), href: `/office/builder?category=${encodeURIComponent(p.catalogId)}`,
          });
        }
      }
      if (p.draft) out.push(await this.review(p.catalogId, p.live, p.draft));
    }
    return out;
  }

  /** The recommendation for a proposed process (a draft): validate, run its tests, check what it depends on. */
  private async review(catalogId: string, live: ProcessDef | null, draft: ProcessDef): Promise<Draft> {
    const { store } = this.deps;
    const ppl = people(store);
    const issues = this.deps.validate(draft);
    const tests = await this.tests(draft);
    const deps = processDependencies(draft);
    const changes = diffProcess(live, draft);
    const conns = store.connections();
    const blockers: Bilingual[] = issues.map((i) => i.message);
    for (const n of tests.failed) blockers.push(b(`Testfall fehlgeschlagen: ${n}`, `Sample case failed: ${n}`));
    for (const sys of deps.systems) {
      const c = CONNECTORS.find((x) => x.id === sys);
      if (c && conns[sys]?.enabled === false) blockers.push(b(`${c.name.de} ist ausgeschaltet`, `${c.name.en} is switched off`));
    }
    for (const n of draft.nodes.filter((x) => x.kind === "connector")) {
      const missing = missingInputs(draft, n.id, allTemplates(store));
      if (missing.length) blockers.push(b(`„${n.name ?? n.id}“ fehlt: ${missing.map((m) => m.label.de).join(", ")}`, `“${n.name ?? n.id}” is missing: ${missing.map((m) => m.label.en).join(", ")}`));
    }
    for (const id of deps.rules ?? []) {
      const r = store.rules()[id];
      if (r && (!r.live || r.paused)) blockers.push(b(`Regel ${id} läuft nicht (nicht freigegeben oder ausgeschaltet)`, `Rule ${id} does not run (not approved or switched off)`));
    }
    const noTests = (draft.tests ?? []).length === 0;
    const ready = blockers.length === 0;
    const summary = b(
      `${changes.length} Änderung(en) gegenüber ${live ? `v${live.version}` : "nichts Veröffentlichtem"} · ${(draft.tests ?? []).length} Testfall/-fälle · hängt ab von ${deps.documents.length} Vorlage(n), ${deps.systems.length} System(en), ${deps.rules === null ? "allen Regeln" : `${deps.rules.length} Regel(n)`}.`,
      `${changes.length} change(s) against ${live ? `v${live.version}` : "nothing published"} · ${(draft.tests ?? []).length} sample case(s) · depends on ${deps.documents.length} template(s), ${deps.systems.length} system(s), ${deps.rules === null ? "all rules" : `${deps.rules.length} rule(s)`}.`,
    );
    return {
      id: `process-review:${catalogId}`, kind: "review", severity: ready ? "info" : "warning",
      title: ready ? b(`Entwurf „${draft.name}“ ist bereit zur Veröffentlichung`, `Draft “${draft.name}” is ready to publish`) : b(`Entwurf „${draft.name}“ ist noch nicht bereit`, `Draft “${draft.name}” is not ready yet`),
      detail: ready ? summary : { de: `${summary.de} Offen: ${blockers.slice(0, 4).map((x) => x.de).join(" · ")}${blockers.length > 4 ? ` (+${blockers.length - 4})` : ""}`, en: `${summary.en} Open: ${blockers.slice(0, 4).map((x) => x.en).join(" · ")}${blockers.length > 4 ? ` (+${blockers.length - 4})` : ""}` },
      recommendation: ready
        ? noTests
          ? b("Prüfen und veröffentlichen. Tipp: Testfälle anlegen, damit spätere Änderungen automatisch geprüft werden.", "Review and publish. Tip: add sample cases so later changes are checked automatically.")
          : b("Prüfen und veröffentlichen.", "Review and publish.")
        : b(`Erst beheben: ${blockers[0]!.de}`, `Fix first: ${blockers[0]!.en}`),
      subjects: [`process:${catalogId}`, ...deps.systems.map((s) => `connector:${s}`).filter(() => !ready)],
      affects: [same(draft.name)],
      owner: ppl.ref(ppl.admin),
      href: `/office/builder?category=${encodeURIComponent(catalogId)}`,
    };
  }

  /** Runs the sample cases only when the process or something it depends on changed since the last run. */
  private async tests(def: ProcessDef) {
    if (!(def.tests ?? []).length) return { ok: true, failed: [] as string[] };
    const { store } = this.deps;
    const deps = processDependencies(def);
    const key = createHash("sha1")
      .update(JSON.stringify([def, store.ruleStates(), deps.messages.map((m) => store.liveMessage(m)?.version ?? null), store.connections(), store.config().templateChecks]))
      .digest("hex");
    const hit = this.testCache.get(key);
    if (hit) return hit;
    let result: { ok: boolean; failed: string[] };
    try {
      const r = await this.deps.runTests(def);
      result = { ok: r.every((x) => x.ok), failed: r.filter((x) => !x.ok).map((x) => x.name) };
    } catch (e) {
      result = { ok: false, failed: [e instanceof Error ? e.message : "error"] };
    }
    if (this.testCache.size > 200) this.testCache.clear();
    this.testCache.set(key, result);
    return result;
  }
}

/** Which changes in the office wake the watcher, and how they read in its log. */
const EVENTS: [RegExp, Bilingual][] = [
  [/^POST \/office\/processes\/publish/, b("Prozess veröffentlicht", "Process published")],
  [/^(PUT \/office\/processes\/draft|POST \/office\/processes\/(create|duplicate|restore))/, b("Prozessentwurf geändert", "Process draft changed")],
  [/^POST \/office\/processes\/delete/, b("Prozess gelöscht", "Process deleted")],
  [/^POST \/office\/rules\/[^/]+\/approve/, b("Regel freigegeben", "Rule approved")],
  [/^POST \/office\/rules\/[^/]+\/revoke/, b("Regel ausgeschaltet", "Rule switched off")],
  [/^(POST \/office\/rules$|PUT \/office\/rules\/[^/]+\/draft)/, b("Regeländerung vorgeschlagen", "Rule change proposed")],
  [/^POST \/office\/rules\/[^/]+\/discard/, b("Regeländerung verworfen", "Rule change discarded")],
  [/^POST \/office\/templates\/proposals(?!\/suggest)/, b("Vorlagenvorschlag geändert", "Template proposal changed")],
  [/^PUT \/office\/templates\/proposals/, b("Vorlagenvorschlag geändert", "Template proposal changed")],
  [/^POST \/office\/templates\/[^/]+\/confirm/, b("Vorlage bestätigt", "Template confirmed")],
  [/^(PUT|POST) \/office\/messages/, b("Nachrichtenvorlage geändert", "Message template changed")],
  [/^(PUT|POST) \/office\/connections/, b("Verbindung geändert", "Connection changed")],
  [/^(PUT|POST) \/office\/staff/, b("Zugriffe geändert", "Access changed")],
  [/^PUT \/office\/extraction/, b("Lesemethode geändert", "Reading method changed")],
  [/^POST \/office\/cases\/[^/]+\/(actions|restart)/, b("Fall bearbeitet", "Case worked on")],
];

export function eventFor(method: string, url: string): Bilingual | null {
  const key = `${method} ${url.split("?")[0]}`;
  return EVENTS.find(([re]) => re.test(key))?.[1] ?? null;
}
