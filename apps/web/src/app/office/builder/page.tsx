"use client";

import {
  CONNECTORS,
  NODE_CATALOG,
  defaultConfig,
  outputsOf,
  validateProcess,
  type Category,
  type ConfigValue,
  type FlowEdge,
  type FlowNode,
  type NodeKind,
  type ProcessDef,
  type ProcessIssue,
} from "@digieurope/shared";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/ui";
import { ApiError, api, type TestRunResult } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { useStaff } from "@/lib/staff";

type StepData = { kind: NodeKind; config: Record<string, ConfigValue>; state?: "visited" | "issue" };
type StepNode = Node<StepData, "step">;

const CATEGORIES: Category[] = ["start", "check", "decide", "message", "route", "connector", "finish"];

function summary(d: StepData, bi: (b: { de: string; en: string }) => string): string {
  const c = d.config;
  switch (d.kind) {
    case "condition": return `${c.field} ${c.op === "gte" ? "≥" : c.op === "lte" ? "≤" : c.op === "eq" ? "=" : "≠"} ${c.value}`;
    case "assign_team": return String(c.team);
    case "wait": return `${c.days} d`;
    case "ai_draft_mail": return String(c.tone);
    case "send_notification": return `→ ${c.to}: ${c.subject}`;
    case "human_task": return String(c.instruction || "");
    case "trigger": return String(c.source);
    case "connector": {
      const sys = CONNECTORS.find((x) => x.id === c.system);
      const act = sys?.actions.find((a) => a.id === c.action);
      return `${sys ? bi(sys.name) : c.system} · ${act ? bi(act.label) : c.action}`;
    }
    default: return "";
  }
}

function StepView({ data, selected }: NodeProps<StepNode>) {
  const { bi, t } = useI18n();
  const spec = NODE_CATALOG[data.kind];
  return (
    <div className={`flow-node cat-${spec.category}${selected ? " sel" : ""}${data.state ? ` ${data.state}` : ""}`}>
      {data.kind !== "trigger" && <Handle type="target" position={Position.Top} />}
      <div className="flow-head">
        <span>{bi(spec.title)}</span>
        {spec.ai && <span className="flow-badge">{t("builder.ai")}</span>}
      </div>
      <div className="flow-body">{summary(data, bi) || bi(spec.description).slice(0, 58) + "…"}</div>
      {spec.outputs.length > 0 && (
        <div className="flow-outs">
          {spec.outputs.map((o) => (
            <div className="flow-out" key={o.id}>
              {spec.outputs.length > 1 ? bi(o.label) : ""}
              <Handle type="source" position={Position.Bottom} id={o.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const nodeTypes = { step: StepView };

const toRfNode = (n: FlowNode): StepNode => ({ id: n.id, type: "step", position: n.position, data: { kind: n.kind, config: n.config } });
const edgeStyle = { markerEnd: { type: MarkerType.ArrowClosed }, type: "smoothstep" as const };

function Builder() {
  const { t, bi, lang, tk, dateTime } = useI18n();
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [live, setLive] = useState<ProcessDef | null>(null);
  const [history, setHistory] = useState<{ version: number; updatedAt: string; updatedBy: string; name: string }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<ProcessIssue[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sample, setSample] = useState("incomplete");
  const [decision, setDecision] = useState("");
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  const edgeLabel = useCallback((source: string, handle: string, all: Node<StepData>[]) => {
    const kind = (all.find((n) => n.id === source)?.data as StepData | undefined)?.kind;
    const outs = kind ? outputsOf(kind) : [];
    return outs.length > 1 ? bi(outs.find((o) => o.id === handle)?.label ?? { de: handle, en: handle }) : undefined;
  }, [bi]);

  const load = useCallback((def: ProcessDef, isDraft: boolean) => {
    const rfNodes = def.nodes.map(toRfNode);
    setNodes(rfNodes);
    setEdges(def.edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, label: edgeLabel(e.source, e.sourceHandle, rfNodes), ...edgeStyle })));
    setName(def.name);
    setDirty(isDraft);
    setResult(null);
    setIssues([]);
    setSelected(null);
  }, [setNodes, setEdges, edgeLabel]);

  const refresh = useCallback(async () => {
    const p = await api.processes();
    setLive(p.live);
    setHistory(p.history);
    load(p.draft ?? p.live, Boolean(p.draft));
    loaded.current = true;
  }, [load]);
  useEffect(() => void refresh(), [refresh]);

  // Edge labels follow the UI language.
  useEffect(() => {
    setEdges((es) => es.map((e) => ({ ...e, label: edgeLabel(e.source, e.sourceHandle ?? "out", nodes) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const touch = () => loaded.current && setDirty(true);

  const toDef = useCallback((): ProcessDef => ({
    id: live?.id ?? "process",
    name,
    version: (live?.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: "",
    nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, position: n.position, config: n.data.config })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? "out", target: e.target }) satisfies FlowEdge),
  }), [live, name, nodes, edges]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target) return;
    setEdges((es) => {
      const rest = es.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle));
      return addEdge({ ...c, id: `${c.source}:${c.sourceHandle}`, label: edgeLabel(c.source!, c.sourceHandle ?? "out", nodes), ...edgeStyle }, rest);
    });
    touch();
  }, [setEdges, edgeLabel, nodes]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/x-step");
    if (!raw) return;
    const { kind, preset } = JSON.parse(raw) as { kind: NodeKind; preset?: Record<string, ConfigValue> };
    const position = screenToFlowPosition({ x: e.clientX - 105, y: e.clientY - 20 });
    const id = `${kind}-${Date.now().toString(36)}`;
    setNodes((ns) => [...ns, { id, type: "step", position, data: { kind, config: defaultConfig(kind, preset) } }]);
    touch();
  }, [screenToFlowPosition, setNodes]);

  const mark = (state: Record<string, "visited" | "issue" | undefined>) =>
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, state: state[n.id] } })));

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setMessage(null);
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.issues) {
        setIssues(e.issues);
        mark(Object.fromEntries(e.issues.filter((i) => i.nodeId).map((i) => [i.nodeId!, "issue" as const])));
      }
      setMessage(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const validate = () => {
    const found = validateProcess(toDef());
    setIssues(found);
    mark(Object.fromEntries(found.filter((i) => i.nodeId).map((i) => [i.nodeId!, "issue" as const])));
    setMessage(found.length ? null : t("builder.valid"));
    return found;
  };

  const sel = useMemo(() => nodes.find((n) => n.id === selected) ?? null, [nodes, selected]);
  const setConfig = (key: string, value: ConfigValue) => {
    setNodes((ns) => ns.map((n) => (n.id === selected ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } } : n)));
    touch();
  };

  if (!live) return <Spinner label={t("common.loading")} />;

  return (
    <div className="stack builder-wide">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>{t("builder.title")}</h1>
          <p className="lead" style={{ maxWidth: "70ch", marginBottom: 0 }}>{t("builder.lead")}</p>
        </div>
        <div className="row">
          <span className="pill pill-ok">{t("builder.live", { v: live.version })}</span>
          {dirty && <span className="pill pill-warn">{t("builder.draft")} · {t("builder.unsaved")}</span>}
        </div>
      </div>

      <div className="card row" style={{ justifyContent: "space-between" }}>
        <label className="field" style={{ minWidth: 260, flex: 1 }}>
          <span className="visually-hidden">{t("builder.name")}</span>
          <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} aria-label={t("builder.name")} />
        </label>
        <div className="row">
          <button className="button button-ghost" type="button" disabled={busy} onClick={async () => { const r = await run(() => api.saveDraft(toDef())); if (r) { setDirty(false); setMessage(t("builder.saved")); } }}>{t("builder.save")}</button>
          <button className="button button-ghost" type="button" onClick={validate}>{t("builder.validate")}</button>
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={async () => {
              const found = validate();
              if (found.length) return;
              const r = await run(() => api.publish(toDef()));
              if (r) {
                setMessage(t("builder.published", { v: r.version }));
                await refresh();
              }
            }}
          >
            {t("builder.publish")}
          </button>
        </div>
      </div>
      {message && <p className={`banner ${issues.length ? "banner-warn" : "banner-ok"}`} role="status" style={{ margin: 0 }}>{message}</p>}
      {issues.length > 0 && (
        <div className="banner banner-warn">
          <h3>{t("builder.issues")}</h3>
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>{issues.map((i, k) => <li key={k}>{bi(i.message)}</li>)}</ul>
        </div>
      )}

      <div className="builder">
        <aside className="card palette" aria-label={t("builder.palette")}>
          <strong>{t("builder.palette")}</strong>
          <span className="small muted">{t("builder.palette.hint")}</span>
          {CATEGORIES.map((cat) => {
            const items: { key: string; kind: NodeKind; label: string; preset?: Record<string, ConfigValue> }[] =
              cat === "connector"
                ? CONNECTORS.map((c) => ({ key: c.id, kind: "connector" as const, label: bi(c.name), preset: { system: c.id, action: c.actions[0]!.id } }))
                : (Object.values(NODE_CATALOG).filter((s) => s.category === cat).map((s) => ({ key: s.kind, kind: s.kind, label: bi(s.title) })));
            return (
              <div key={cat} className={`cat-${cat}`}>
                <h3>{t(`builder.cat.${cat}` as MessageKey)}</h3>
                {items.map((it) => (
                  <div
                    key={it.key}
                    className="palette-item"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-step", JSON.stringify({ kind: it.kind, preset: it.preset }));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    style={{ marginBottom: "0.3rem" }}
                  >
                    <span className="dot" aria-hidden />
                    {it.label}
                  </div>
                ))}
              </div>
            );
          })}
        </aside>

        <div className="canvas-wrap" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type !== "select" && x.type !== "dimensions")) touch(); }}
            onEdgesChange={(c) => { onEdgesChange(c); if (c.some((x) => x.type !== "select")) touch(); }}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sn }) => setSelected(sn[0]?.id ?? null)}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            colorMode="system"
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable style={{ width: 110, height: 70 }} />
          </ReactFlow>
        </div>

        <aside className="stack">
          <section className="card">
            <h2>{t("builder.config")}</h2>
            {!sel ? <p className="muted small">{t("builder.select")}</p> : (
              <div className="stack" style={{ gap: "0.75rem" }}>
                <div>
                  <strong>{bi(NODE_CATALOG[sel.data.kind].title)}</strong>
                  <p className="small muted" style={{ margin: "0.2rem 0 0" }}>{bi(NODE_CATALOG[sel.data.kind].description)}</p>
                </div>
                {NODE_CATALOG[sel.data.kind].ai && <p className="banner banner-info small" style={{ margin: 0 }}>{t("builder.aiNote")}</p>}
                {sel.data.kind === "connector" && <p className="small muted" style={{ margin: 0 }}>{t("builder.connectorNote")}</p>}
                {NODE_CATALOG[sel.data.kind].fields.map((f) => {
                  let options = f.options;
                  if (sel.data.kind === "connector" && f.key === "action") {
                    options = CONNECTORS.find((c) => c.id === sel.data.config.system)?.actions.map((a) => ({ value: a.id, label: a.label }));
                  }
                  const val = sel.data.config[f.key] ?? f.default;
                  return (
                    <label className="field" key={f.key}>
                      {bi(f.label)}
                      {f.type === "select" ? (
                        <select
                          value={String(val)}
                          onChange={(e) => {
                            setConfig(f.key, e.target.value);
                            if (sel.data.kind === "connector" && f.key === "system") setConfig("action", CONNECTORS.find((c) => c.id === e.target.value)!.actions[0]!.id);
                          }}
                        >
                          {options?.map((o) => <option key={o.value} value={o.value}>{bi(o.label)}</option>)}
                        </select>
                      ) : f.type === "textarea" ? (
                        <textarea rows={4} value={String(val)} onChange={(e) => setConfig(f.key, e.target.value)} />
                      ) : f.type === "number" ? (
                        <input type="number" min={1} value={Number(val)} onChange={(e) => setConfig(f.key, Number(e.target.value))} />
                      ) : (
                        <input value={String(val)} onChange={(e) => setConfig(f.key, e.target.value)} />
                      )}
                    </label>
                  );
                })}
                <button className="button button-ghost button-small" type="button" onClick={() => { setNodes((ns) => ns.filter((n) => n.id !== sel.id)); setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id)); setSelected(null); touch(); }}>{t("builder.delete")}</button>
              </div>
            )}
          </section>

          <section className="card stack" style={{ gap: "0.75rem" }}>
            <h2>{t("builder.test")}</h2>
            <p className="small muted" style={{ margin: 0 }}>{t("builder.test.note")}</p>
            <label className="field">{t("builder.test.sample")}
              <select value={sample} onChange={(e) => setSample(e.target.value)}>
                {(["incomplete", "complete", "internship"] as const).map((s) => <option key={s} value={s}>{t(`builder.test.sample.${s}` as MessageKey)}</option>)}
              </select>
            </label>
            <label className="field">{t("builder.test.decision")}
              <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option value="">{t("builder.test.decision.none")}</option>
                {(["approved", "rejected", "info"] as const).map((d) => <option key={d} value={d}>{t(`builder.test.decision.${d}` as MessageKey)}</option>)}
              </select>
            </label>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={async () => {
                const found = validate();
                if (found.length) return;
                const r = await run(() => api.testRun(toDef(), sample, decision || undefined));
                if (r) {
                  setResult(r);
                  mark(Object.fromEntries(r.log.map((l) => [l.nodeId, "visited" as const])));
                }
              }}
            >
              {t("builder.test.run")}
            </button>
            {result && (
              <div className="stack" style={{ gap: "0.6rem" }} aria-live="polite">
                <h3 style={{ margin: 0 }}>{t("builder.test.result")}</h3>
                <p className="small" style={{ margin: 0 }}>{t("builder.test.status", { s: tk(`status.${result.status}`) })}{result.waiting ? ` · ${t("builder.test.waiting")}` : ""}{result.team ? ` · ${t("builder.test.team", { t: result.team })}` : ""}</p>
                <div>
                  {result.log.map((l, i) => (
                    <div className="log-line" key={i}><span aria-hidden>✓</span><span><strong>{bi(NODE_CATALOG[l.kind as NodeKind]?.title ?? { de: l.kind, en: l.kind })}</strong><br /><span className="muted">{l.note}</span></span></div>
                  ))}
                </div>
                {result.mails.length > 0 && (
                  <>
                    <h3 style={{ margin: 0 }}>{t("builder.test.mails")}</h3>
                    {result.mails.map((m) => (
                      <div className="mail" key={m.id}>
                        <strong className="small">{m.subject}</strong> {m.aiDraft && <span className="pill">{t("flow.aiDraft")}</span>}
                        <pre>{m.body}</pre>
                      </div>
                    ))}
                  </>
                )}
                {result.integrations.length > 0 && (
                  <>
                    <h3 style={{ margin: 0 }}>{t("builder.test.calls")}</h3>
                    {result.integrations.map((c, i) => <p key={i} className="small" style={{ margin: 0 }}><code>{c.system}.{c.action}</code> → {String((c.response as { externalId?: string }).externalId)}</p>)}
                  </>
                )}
              </div>
            )}
          </section>

          {history.length > 0 && (
            <section className="card">
              <h3>{t("builder.versions")}</h3>
              {[...history].reverse().map((h) => (
                <div key={h.version} className="row small" style={{ justifyContent: "space-between", borderTop: "1px solid var(--line)", padding: "0.3rem 0" }}>
                  <span>v{h.version} · {h.updatedBy} · {dateTime(h.updatedAt)}</span>
                  <button className="link-button" type="button" onClick={async () => { const r = await run(() => api.restore(h.version)); if (r) await refresh(); }}>{t("builder.restore")}</button>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function BuilderPage() {
  const { t } = useI18n();
  const { canBuild } = useStaff();
  if (!canBuild) return <p className="banner banner-warn">{t("builder.noAccess")}</p>;
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  );
}
