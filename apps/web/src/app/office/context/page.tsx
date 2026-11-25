"use client";

import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertOctagon, ArrowLeft, ArrowRight, BadgeCheck, Building2, Cable, CheckCircle2, ChevronRight, Compass, Database, FilePlus2, FileText, FolderTree, Footprints, Landmark, Mail, RefreshCw, Scale, ShieldCheck, TextCursorInput, UserRound, Users, Workflow, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { refreshTodo } from "@/components/TodoBar";
import { api, type ContextEdge, type ContextFinding, type ContextNode, type ContextNodeType, type ContextState, type Severity } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { useStaff } from "@/lib/staff";

const ICON: Record<ContextNodeType, LucideIcon> = {
  office: Building2, person: UserRound, process: Workflow, rule: ShieldCheck, template: FileText, proposal: FilePlus2, message: Mail, connector: Cable,
  catalog: FolderTree, peer: Landmark, reference: Compass, step: Footprints, action: Zap, field: TextCursorInput, data: Database, role: BadgeCheck, team: Users, source: Scale,
};
/** Order around the ring, starting at the top. */
const RING: ContextNodeType[] = ["person", "rule", "template", "proposal", "message", "connector", "catalog", "reference", "peer"];
/** Finer entities: drawn next to what they belong to, when that is in focus or the layer is switched on. */
const DETAIL: ContextNodeType[] = ["step", "action", "data", "field", "source", "role", "team"];
/** Where a detail node sits: next to the first neighbour of this type. */
const PARENT: Partial<Record<ContextNodeType, ContextNodeType[]>> = {
  step: ["process"], action: ["connector"], field: ["template", "rule", "process"], source: ["rule"], role: ["person"], team: ["step"], data: ["action"],
};
/** Edges about people are many (one person approved every rule); they show only when one end is in focus. */
const QUIET = new Set<ContextEdge["kind"]>(["wrote", "approved", "owns", "administers", "proposed", "has_role"]);

/** Office in the middle, processes around it, what they use (and the people) on an outer ring by type, finer entities next to their parent. */
function layout(nodes: ContextNode[], edges: ContextEdge[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  pos.set("office", { x: 0, y: 0 });
  const processes = nodes.filter((n) => n.type === "process");
  const r1 = Math.max(150, (processes.length * 140) / (2 * Math.PI));
  processes.forEach((n, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, processes.length)) * 2 * Math.PI + (processes.length > 1 ? Math.PI / processes.length : 0);
    pos.set(n.id, { x: r1 * Math.cos(a), y: r1 * Math.sin(a) });
  });
  // Slots on the outer ring with one empty slot between groups.
  const slots: (ContextNode | null)[] = [];
  for (const t of RING) {
    const group = nodes.filter((n) => n.type === t);
    if (!group.length) continue;
    slots.push(...group, null);
  }
  const people = nodes.filter((n) => n.type === "person").length;
  const step = (2 * Math.PI) / Math.max(1, slots.length);
  const R = Math.max(380, (slots.length * 58) / (2 * Math.PI));
  slots.forEach((n, i) => {
    if (!n) return;
    const a = -Math.PI / 2 - ((people - 1) / 2) * step + i * step;
    const r = R + (i % 2 ? 95 : 0);
    pos.set(n.id, { x: r * Math.cos(a), y: r * Math.sin(a) });
  });
  // Detail nodes: rows fanning outward from their parent, in order (steps of a process, then actions, then data items, ...).
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  const nb = new Map<string, string[]>();
  for (const e of edges) {
    nb.set(e.source, [...(nb.get(e.source) ?? []), e.target]);
    nb.set(e.target, [...(nb.get(e.target) ?? []), e.source]);
  }
  const groups = new Map<string, string[]>();
  for (const t of DETAIL) {
    for (const n of nodes.filter((x) => x.type === t)) {
      const parent = (PARENT[t] ?? []).map((pt) => (nb.get(n.id) ?? []).find((o) => type.get(o) === pt && pos.has(o))).find(Boolean) ?? "office";
      groups.set(parent, [...(groups.get(parent) ?? []), n.id]);
    }
    // Place this layer before the next one looks for its parents among it.
    for (const [parent, kids] of groups) {
      const P = pos.get(parent)!;
      const len = Math.hypot(P.x, P.y) || 1;
      const u = parent === "office" ? { x: 0, y: 1 } : { x: P.x / len, y: P.y / len };
      const v = { x: -u.y, y: u.x };
      kids.forEach((k, idx) => {
        const per = 6;
        const row = Math.floor(idx / per);
        const inRow = Math.min(per, kids.length - row * per);
        const col = (idx % per) - (inRow - 1) / 2;
        const d = 120 + row * 70;
        pos.set(k, { x: P.x + u.x * d + v.x * col * 110, y: P.y + u.y * d + v.y * col * 110 });
      });
    }
    groups.clear();
  }
  return pos;
}

type NodeData = { node: ContextNode; label: string; sub: string; dim: boolean; focus: boolean; draft: boolean };

const CtxNode = memo(function CtxNode({ data }: NodeProps<Node<NodeData>>) {
  const { node, label, dim, focus, draft } = data;
  const Icon = ICON[node.type];
  return (
    <div className={`ctx-node t-${node.type}${dim ? " dim" : ""}${focus ? " focus" : ""}${draft ? " draft" : ""}`} title={data.sub ? `${label} · ${data.sub}` : label}>
      <Handle type="target" position={Position.Top} className="ctx-handle" />
      <span className="ctx-tile">
        <Icon size={node.type === "office" ? 24 : 18} strokeWidth={2} />
        {node.severity && <span className={`ctx-sev ${node.severity}`} aria-label={node.severity} />}
      </span>
      <span className="ctx-label">{label}</span>
      <Handle type="source" position={Position.Top} className="ctx-handle" />
    </div>
  );
});
const nodeTypes = { ctx: CtxNode };

function useCountdown(target: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!target) return null;
  const s = Math.max(0, Math.round((Date.parse(target) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function SevBadge({ s }: { s: Severity }) {
  const { t } = useI18n();
  return <span className={`badge ${s === "problem" ? "bad" : s === "warning" ? "warn" : "muted"}`}>{t(`ctx.sev.${s}` as MessageKey)}</span>;
}

function FindingCard({ f, onShow }: { f: ContextFinding; onShow: () => void }) {
  const { t, bi, dateTime } = useI18n();
  return (
    <li className={`ctx-finding s-${f.severity}`}>
      <div className="ctx-finding-head">
        <SevBadge s={f.severity} />
        <span className="muted small">{t("ctx.since", { t: dateTime(f.firstSeen) })}</span>
      </div>
      <strong>{bi(f.title)}</strong>
      <p className="small muted">{bi(f.detail)}</p>
      <p className="ctx-reco small"><span>{t("ctx.reco")}</span>{bi(f.recommendation)}</p>
      <dl className="ctx-meta small">
        {f.owner && (<><dt>{t("ctx.owner")}</dt><dd>{f.owner.name}</dd></>)}
        {f.affects.length > 0 && (<><dt>{t("ctx.affects")}</dt><dd>{f.affects.map(bi).join(", ")}</dd></>)}
      </dl>
      <div className="ctx-actions">
        <button type="button" className="button button-ghost button-small" onClick={onShow}>{t("ctx.showInGraph")}</button>
        {f.href && <Link className="button button-small" href={f.href}>{t("ctx.open")}<ArrowRight size={14} /></Link>}
      </div>
    </li>
  );
}

function Graph({ state, focus, selected, onSelect, hidden, zoomTo }: { state: ContextState; focus: Set<string> | null; selected: string | null; onSelect: (id: string | null) => void; hidden: Set<ContextNodeType>; zoomTo: string[] | null }) {
  const { bi } = useI18n();
  const flow = useReactFlow();
  // Positions are computed for everything once, so showing a layer never moves what is already there.
  const pos = useMemo(() => layout(state.graph.nodes.filter((n) => n.type === "office" || !hidden.has(n.type) || DETAIL.includes(n.type)), state.graph.edges), [state, hidden]);
  const visible = useMemo(() => state.graph.nodes.filter((n) => pos.has(n.id) && (!hidden.has(n.type) || focus?.has(n.id))), [state, hidden, focus, pos]);
  const ids = useMemo(() => new Set(visible.map((n) => n.id)), [visible]);
  const nodes: Node<NodeData>[] = useMemo(
    () =>
      visible.map((n) => ({
        id: n.id,
        type: "ctx",
        position: { x: pos.get(n.id)!.x - 50, y: pos.get(n.id)!.y - 28 },
        data: { node: n, label: bi(n.label), sub: n.sub ? bi(n.sub) : "", dim: Boolean(focus && !focus.has(n.id)), focus: n.id === selected, draft: n.state === "draft" || n.state === "unconfirmed" || n.state === "off" },
        draggable: true,
      })),
    [visible, pos, focus, selected, bi],
  );
  const edges: Edge[] = useMemo(
    () =>
      state.graph.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .filter((e) => !QUIET.has(e.kind) || (focus && selected && (e.source === selected || e.target === selected)))
        .map((e) => {
          const on = Boolean(focus && focus.has(e.source) && focus.has(e.target) && (!selected || e.source === selected || e.target === selected || e.kind === "next"));
          return { id: e.id, source: e.source, target: e.target, type: "straight", className: `ctx-edge k-${e.kind}${on ? " on" : ""}${focus && !on ? " off" : ""}${e.draftOnly || e.derived ? " draft" : ""}`, animated: on && e.kind === "calls" };
        }),
    [state, ids, focus, selected],
  );
  useEffect(() => {
    const id = setTimeout(() => void flow.fitView({ padding: 0.08, duration: 300 }), 30);
    return () => clearTimeout(id);
  }, [hidden, flow]);
  // "Show in model": zoom to the finding's chain once its nodes are drawn.
  useEffect(() => {
    if (!zoomTo || !focus) return;
    // Bounds from the layout itself, so nodes that just appeared need not be measured first.
    const pts = [...focus].map((x) => pos.get(x)).filter((p): p is { x: number; y: number } => Boolean(p));
    if (!pts.length) return;
    const x0 = Math.min(...pts.map((p) => p.x)) - 60, x1 = Math.max(...pts.map((p) => p.x)) + 60;
    const y0 = Math.min(...pts.map((p) => p.y)) - 40, y1 = Math.max(...pts.map((p) => p.y)) + 50;
    const id = setTimeout(() => void flow.fitBounds({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, { padding: 0.25, duration: 400 }), 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomTo, flow]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelect(n.id)}
      onPaneClick={() => onSelect(null)}
      nodesConnectable={false}
      fitView
      fitViewOptions={{ padding: 0.08 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Lines} gap={48} className="ctx-bg" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export default function ContextPage() {
  const { t, bi, dateTime } = useI18n();
  const { staff } = useStaff();
  const [state, setState] = useState<ContextState | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[] | null>(null);
  const [mine, setMine] = useState(false);
  const [hidden, setHidden] = useState<Set<ContextNodeType>>(() => new Set(DETAIL));

  const load = useCallback(() => api.context().then(setState).catch(() => undefined), []);
  useEffect(() => {
    void load();
    const id = setInterval(load, 10_000);
    window.addEventListener("ms:todo", load);
    return () => {
      clearInterval(id);
      window.removeEventListener("ms:todo", load);
    };
  }, [load]);
  const countdown = useCountdown(state?.schedule.nextRunAt ?? null);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of state?.graph.edges ?? []) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [state]);
  const focus = useMemo(() => {
    if (selected) return new Set([selected, ...(neighbours.get(selected) ?? [])]);
    if (!pinned) return null;
    // A finding shows its own chain: the items it names, plus what connects them through a data item or a single connector or rule.
    const out = new Set(pinned);
    const types = new Map(state?.graph.nodes.map((n) => [n.id, n.type]) ?? []);
    for (const r of pinned) {
      const t = types.get(r);
      if (t === "data" || (pinned.length === 1 && t !== "process")) for (const n of neighbours.get(r) ?? []) out.add(n);
    }
    return out;
  }, [selected, pinned, neighbours, state]);

  if (!state || !staff) return <Spinner label={t("common.loading")} />;
  const findings = state.findings.filter((f) => !mine || f.owner?.id === staff.id);
  const urgent = state.findings.filter((f) => f.severity !== "info" && (staff.isAdmin || f.owner?.id === staff.id));
  const node = selected ? state.graph.nodes.find((n) => n.id === selected) ?? null : null;
  const counts = new Map<ContextNodeType, number>();
  for (const n of state.graph.nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  const last = state.runs[0];

  const runNow = async () => {
    setBusy(true);
    const s = await api.runContext().catch(() => null);
    setBusy(false);
    if (s) setState(s);
    refreshTodo();
  };

  return (
    <div className="ctx">
      <header className="ctx-head">
        <div>
          <h1>{t("ctx.title")}</h1>
          <p className="muted">{t("ctx.lead")}</p>
        </div>
        <div className="ctx-pulse">
          <span className="ctx-live"><span className="ctx-dot" aria-hidden />{t("ctx.alwaysOn")} · {t("ctx.every", { n: Math.round(state.schedule.intervalMs / 60000) })}</span>
          <span className="muted small">
            {last && t("ctx.lastRun", { t: dateTime(last.at) })}
            {countdown && <> · {t("ctx.nextRun", { t: countdown })}</>}
          </span>
          <button type="button" className="button button-ghost button-small" onClick={runNow} disabled={busy}>
            <RefreshCw size={14} className={busy ? "spin" : undefined} />{t("ctx.runNow")}
          </button>
        </div>
      </header>

      <div className="ctx-body">
        <section className="ctx-canvas" aria-label={t("ctx.title")}>
          <button type="button" className={`ctx-alert${urgent.length ? "" : " ok"}`} onClick={() => { setSelected(null); setPinned(null); setMine(!staff.isAdmin); }}>
            <span className="ctx-alert-icon">{urgent.length ? <AlertOctagon size={20} /> : <CheckCircle2 size={20} />}</span>
            <span>
              <strong>{urgent.length ? (urgent.length === 1 ? t("ctx.problem1") : t("ctx.problems", { n: urgent.length })) : t("ctx.allClear")}</strong>
              <small>{urgent.length ? t("ctx.needAttention") : t("ctx.allClearSub")}</small>
            </span>
            <ChevronRight size={16} className="muted" />
          </button>
          <div className="ctx-flow">
            <ReactFlowProvider>
              <Graph state={state} focus={focus} selected={selected} onSelect={(id) => { setSelected(id); if (id) setPinned(null); }} hidden={hidden} zoomTo={pinned} />
            </ReactFlowProvider>
          </div>
          <div className="ctx-legend" role="group" aria-label={t("ctx.legend")}>
            {(["process", ...RING, ...DETAIL] as ContextNodeType[]).filter((x) => counts.get(x)).map((x) => {
              const Icon = ICON[x];
              const off = hidden.has(x);
              return (
                <button key={x} type="button" aria-pressed={!off} title={DETAIL.includes(x) ? t("ctx.detailHint") : undefined} className={`ctx-chip t-${x}${DETAIL.includes(x) ? " detail" : ""}`} onClick={() => setHidden((h) => { const n = new Set(h); if (off) n.delete(x); else n.add(x); return n; })}>
                  <Icon size={13} />{t(`ctx.type.${x}` as MessageKey)}<span className="num muted">{counts.get(x)}</span>
                </button>
              );
            })}
          </div>
          {!focus && <p className="ctx-hint small muted">{t("ctx.hint")}</p>}
        </section>

        <aside className="ctx-panel">
          {node ? (
            <NodeDetail node={node} state={state} onBack={() => setSelected(null)} onSelect={setSelected} />
          ) : (
            <>
              <div className="ctx-panel-head">
                <h2>{t("ctx.findings")} <span className="muted num">{findings.length}</span></h2>
                <div className="seg" role="group">
                  <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>{t("ctx.all")}</button>
                  <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>{t("ctx.mine")}</button>
                </div>
              </div>
              {findings.length === 0 ? <p className="muted">{t("ctx.none")}</p> : (
                <ul className="ctx-findings">
                  {findings.map((f) => <FindingCard key={f.id} f={f} onShow={() => { setSelected(null); setPinned(f.subjects); }} />)}
                </ul>
              )}
              {state.resolved.length > 0 && (
                <details className="ctx-more">
                  <summary>{t("ctx.resolved")} <span className="muted num">{state.resolved.length}</span></summary>
                  <ul>
                    {state.resolved.map((f) => <li key={`${f.id}-${f.resolvedAt}`}><CheckCircle2 size={14} className="ok" /><span>{bi(f.title)}<small className="muted"> · {dateTime(f.resolvedAt!)}</small></span></li>)}
                  </ul>
                </details>
              )}
              <details className="ctx-more" open>
                <summary>{t("ctx.runs")}</summary>
                <ol className="ctx-runs">
                  {state.runs.slice(0, 10).map((r) => (
                    <li key={r.id}>
                      <span className={`ctx-trig ${r.trigger}`}>{t(`ctx.trigger.${r.trigger}` as MessageKey)}</span>
                      <span>
                        <strong>{bi(r.reason)}</strong>{r.by ? <span className="muted"> · {r.by}</span> : null}
                        <small className="muted">
                          {dateTime(r.at)} · {r.ms} ms
                          {r.changed.length > 0 && <> · {t("ctx.runChanged", { n: r.changed.length })}</>}
                          {r.added > 0 && <> · {t("ctx.runNew", { n: r.added })}</>}
                          {r.resolved > 0 && <> · {t("ctx.runResolved", { n: r.resolved })}</>}
                        </small>
                        {r.changed.length > 0 && <small className="muted ctx-changed">{r.changed.slice(0, 3).map(bi).join(" · ")}</small>}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function NodeDetail({ node, state, onBack, onSelect }: { node: ContextNode; state: ContextState; onBack: () => void; onSelect: (id: string) => void }) {
  const { t, bi } = useI18n();
  const Icon = ICON[node.type];
  const byId = new Map(state.graph.nodes.map((n) => [n.id, n]));
  const links = state.graph.edges.filter((e) => e.source === node.id || e.target === node.id);
  const groups = new Map<string, { other: ContextNode; draft?: boolean }[]>();
  for (const e of links) {
    const out = e.source === node.id;
    const other = byId.get(out ? e.target : e.source);
    if (!other) continue;
    const key = `${out ? "" : "← "}${t(`ctx.edge.${e.kind}` as MessageKey)}`;
    groups.set(key, [...(groups.get(key) ?? []), { other, draft: e.draftOnly }]);
  }
  const findings = state.findings.filter((f) => f.subjects.includes(node.id));
  return (
    <div className="ctx-detail">
      <button type="button" className="ctx-back small" onClick={onBack}><ArrowLeft size={14} />{t("ctx.back")}</button>
      <div className="ctx-detail-head">
        <span className={`ctx-tile big t-${node.type}`}><Icon size={20} /></span>
        <div>
          <h2>{bi(node.label)}</h2>
          <p className="muted small">{t(`ctx.type.${node.type}` as MessageKey)}{node.sub ? ` · ${bi(node.sub)}` : ""}{node.state ? ` · ${node.state}` : ""}</p>
        </div>
      </div>
      {findings.length === 0 ? <p className="muted small">{t("ctx.noFindingsNode")}</p> : (
        <ul className="ctx-findings">{findings.map((f) => <FindingCard key={f.id} f={f} onShow={() => onSelect(f.subjects[0]!)} />)}</ul>
      )}
      <h3>{t("ctx.connections")} <span className="muted num">{links.length}</span></h3>
      <dl className="ctx-links">
        {[...groups].map(([k, xs]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              {xs.map(({ other, draft }) => (
                <button key={other.id} type="button" className={`ctx-chip t-${other.type}`} onClick={() => onSelect(other.id)}>
                  {bi(other.label)}{draft && <em className="muted"> ({t("ctx.draftOnly")})</em>}
                </button>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
