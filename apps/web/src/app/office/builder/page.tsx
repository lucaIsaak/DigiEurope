"use client";

import {
  type DocumentTemplate,
  type ProcessInput,
  DEFAULT_CATEGORY,
  catalogVariant,
  catalogVariants,
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
import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
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
  useStore,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  ChevronDown,
  FolderTree,
  Check,
  CheckCircle2,
  Clock,
  FilePlus2,
  Flag,
  GitBranch,
  GripVertical,
  LayoutDashboard,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plug,
  Redo2,
  ListChecks,
  ScanText,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Undo2,
  UserCheck,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssignmentTable } from "@/components/AssignmentTable";
import { RulePicker } from "@/components/RulePicker";
import { InputsEditor } from "@/components/InputsEditor";
import { CATEGORIES, ICONS, NODE_W, edgeBase, layout, ARROW, nodeTypes, toRfNode, type StepNode } from "@/components/FlowKit";
import { Spinner } from "@/components/ui";
import { ApiError, api, type TestRunResult } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { useStaff } from "@/lib/staff";
import { useTheme } from "@/lib/theme";

interface Snapshot { nodes: FlowNode[]; edges: FlowEdge[] }

function Builder() {
  const { t, bi, lang, tk, dateTime } = useI18n();
  const rf = useReactFlow();
  const { theme } = useTheme();
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [live, setLive] = useState<ProcessDef | null>(null);
  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY);
  const [processList, setProcessList] = useState<{ catalogId: string; name: string; liveVersion: number | null; hasDraft: boolean }[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [history, setHistory] = useState<{ version: number; updatedAt: string; updatedBy: string; name: string }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [issues, setIssues] = useState<ProcessIssue[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [sample, setSample] = useState("incomplete");
  const [decision, setDecision] = useState("");
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [inputs, setInputs] = useState<ProcessInput[]>([]);
  const [showInputs, setShowInputs] = useState(false);
  const [templates, setTemplates] = useState<(DocumentTemplate & { check?: unknown })[]>([]);
  const loaded = useRef(false);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const [, bump] = useState(0);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const edgeLabel = useCallback((source: string, handle: string, all: StepNode[]) => {
    const kind = all.find((n) => n.id === source)?.data.kind;
    const outs = kind ? outputsOf(kind) : [];
    return outs.length > 1 ? bi(outs.find((o) => o.id === handle)?.label ?? { de: handle, en: handle }) : undefined;
  }, [bi]);

  const rfEdge = useCallback((e: FlowEdge, all: StepNode[]): Edge => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, label: edgeLabel(e.source, e.sourceHandle, all), ...edgeBase }), [edgeLabel]);

  const snapshot = (): Snapshot => ({
    nodes: nodesRef.current.map((n) => ({ id: n.id, kind: n.data.kind, position: n.position, config: n.data.config })),
    edges: edgesRef.current.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? "out", target: e.target })),
  });
  const checkpoint = () => {
    past.current = [...past.current.slice(-49), snapshot()];
    future.current = [];
    bump((x) => x + 1);
  };
  const restore = (s: Snapshot) => {
    const ns = s.nodes.map(toRfNode);
    setNodes(ns);
    setEdges(s.edges.map((e) => rfEdge(e, ns)));
    setDirty(true);
    setSelected(null);
    bump((x) => x + 1);
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(snapshot());
    restore(prev);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(snapshot());
    restore(next);
  };

  const load = useCallback((def: ProcessDef, isDraft: boolean) => {
    let ns = def.nodes.map(toRfNode);
    const es = def.edges.map((e) => rfEdge(e, ns));
    if (!isDraft) ns = layout(ns, es);
    setNodes(ns);
    setEdges(es);
    setName(def.name);
    setInputs(def.inputs ?? []);
    setDirty(isDraft);
    setResult(null);
    setIssues([]);
    setSelected(null);
    past.current = [];
    future.current = [];
    setTimeout(() => rf.fitView({ padding: 0.12, duration: 250 }), 120);
    setTimeout(() => rf.fitView({ padding: 0.12, duration: 250 }), 450);
  }, [setNodes, setEdges, rfEdge, rf]);

  const refresh = useCallback(async (cat?: string) => {
    const target = cat ?? category;
    const [p, list, lib] = await Promise.all([api.processes(target), api.processList(), api.templates().catch(() => null)]);
    if (lib) setTemplates(lib.templates);
    setCategory(target);
    setProcessList(list);
    setLive(p.live);
    setHistory(p.history);
    const def = p.draft ?? p.live;
    if (def) load(def, Boolean(p.draft));
    loaded.current = true;
    setReady(true);
  }, [load, category]);
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setEdges((es) => es.map((e) => ({ ...e, label: edgeLabel(e.source, e.sourceHandle ?? "out", nodesRef.current) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const touch = () => loaded.current && setDirty(true);

  const toDef = useCallback((): ProcessDef => {
    const s = snapshot();
    return { id: live?.id ?? category, catalogId: category, name, version: (live?.version ?? 0) + 1, updatedAt: new Date().toISOString(), updatedBy: "", inputs, nodes: s.nodes, edges: s.edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, name, inputs]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target) return;
    checkpoint();
    setEdges((es) => {
      const rest = es.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle));
      return addEdge({ ...c, id: `${c.source}:${c.sourceHandle}`, label: edgeLabel(c.source!, c.sourceHandle ?? "out", nodesRef.current), ...edgeBase }, rest);
    });
    touch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setEdges, edgeLabel]);

  const addNode = (kind: NodeKind, preset: Record<string, ConfigValue> | undefined, position: { x: number; y: number }) => {
    checkpoint();
    const id = `${kind}-${Date.now().toString(36)}`;
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: "step", position, selected: true, data: { kind, config: defaultConfig(kind, preset) } }]);
    setSelected(id);
    touch();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/x-step");
    if (!raw) return;
    const { kind, preset } = JSON.parse(raw) as { kind: NodeKind; preset?: Record<string, ConfigValue> };
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(kind, preset, { x: Math.round((p.x - NODE_W / 2) / 16) * 16, y: Math.round((p.y - 30) / 16) * 16 });
  };
  const addAtCenter = (kind: NodeKind, preset?: Record<string, ConfigValue>) => {
    const vp = document.querySelector(".ws-canvas")?.getBoundingClientRect();
    const p = rf.screenToFlowPosition({ x: (vp?.left ?? 0) + (vp?.width ?? 600) / 2, y: (vp?.top ?? 0) + (vp?.height ?? 400) / 2 });
    addNode(kind, preset, { x: Math.round((p.x - NODE_W / 2) / 16) * 16, y: Math.round(p.y / 16) * 16 });
  };

  const tidy = () => {
    checkpoint();
    setNodes((ns) => layout(ns, edgesRef.current));
    touch();
    setTimeout(() => rf.fitView({ padding: 0.12, duration: 300 }), 200);
  };

  const mark = (state: Record<string, { s: "visited" | "issue"; msg?: string } | undefined>) =>
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, state: state[n.id]?.s, issue: state[n.id]?.msg } })));

  const markIssues = (found: ProcessIssue[]) => {
    setIssues(found);
    mark(Object.fromEntries(found.filter((i) => i.nodeId).map((i) => [i.nodeId!, { s: "issue" as const, msg: bi(i.message) }])));
  };

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setToast(null);
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.issues) markIssues(e.issues);
      setToast({ text: e instanceof Error ? e.message : String(e), tone: "warn" });
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const validate = () => {
    const found = validateProcess(toDef());
    markIssues(found);
    setToast(found.length ? null : { text: t("builder.valid"), tone: "ok" });
    return found;
  };

  const sel = useMemo(() => nodes.find((n) => n.id === selected) ?? null, [nodes, selected]);
  const setConfig = (key: string, value: ConfigValue) => {
    setNodes((ns) => ns.map((n) => (n.id === selected ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } } : n)));
    touch();
  };

  // Keyboard: undo/redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Test results light up the path: visited steps and the connections between them.
  const visitedHandles = useMemo(() => new Map((result?.log ?? []).map((l) => [l.nodeId, l.handle ?? "out"])), [result]);
  const shownEdges = useMemo(
    () => edges.map((e) => {
      const on = Boolean(result) && visitedHandles.get(e.source) === (e.sourceHandle ?? "out") && visitedHandles.has(e.target);
      return { ...e, className: on ? "visited" : undefined, animated: on, markerEnd: { ...ARROW, color: on ? "#17a06a" : ARROW.color } };
    }),
    [edges, result, visitedHandles],
  );

  if (!ready) return <div className="container page"><Spinner label={t("common.loading")} /></div>;

  const q = query.trim().toLowerCase();
  const items = (cat: Category) =>
    (cat === "connector"
      ? CONNECTORS.map((c) => ({ key: c.id, kind: "connector" as NodeKind, label: bi(c.name), preset: { system: c.id, action: c.actions[0]!.id } as Record<string, ConfigValue> }))
      : Object.values(NODE_CATALOG).filter((s) => s.category === cat).map((s) => ({ key: s.kind, kind: s.kind, label: bi(s.title), preset: undefined as Record<string, ConfigValue> | undefined }))
    ).filter((it) => !q || it.label.toLowerCase().includes(q));

  return (
    <div className="ws">
      <div className="ws-toolbar">
        <span style={{ position: "relative" }}>
          <button className="button button-ghost button-small" type="button" onClick={() => setShowNew((v) => !v)} title={t("builder.category")}>
            <FolderTree size={15} />
            {(() => { const v = catalogVariant(category); return v ? bi(v.path.at(-1)!) : category; })()}
            <ChevronDown size={14} />
          </button>
          {showNew && (
            <div className="card" style={{ position: "absolute", top: "110%", left: 0, zIndex: 30, width: 360, padding: "0.8rem" }}>
              <div className="small muted" style={{ marginBottom: "0.4rem" }}>{t("builder.processes")}</div>
              {processList.map((p) => {
                const v = catalogVariant(p.catalogId);
                return (
                  <button key={p.catalogId} type="button" className="pal-item" onClick={async () => { setShowNew(false); if (p.catalogId !== category) { if (dirty && !window.confirm(t("builder.switchConfirm"))) return; setReady(false); await refresh(p.catalogId); } }}>
                    <span className="ico"><FolderTree size={14} /></span>
                    <span style={{ flex: 1 }}>
                      <div>{v ? bi(v.path.at(-1)!) : p.catalogId}</div>
                      <div className="small muted">{v ? v.path.slice(0, -1).map((x) => bi(x)).join(" › ") : ""} · {p.liveVersion ? `v${p.liveVersion}` : t("builder.notLive")}</div>
                    </span>
                    {p.catalogId === category && <Check size={14} />}
                  </button>
                );
              })}
              <div className="small muted" style={{ margin: "0.7rem 0 0.3rem" }}>{t("builder.newProcess")}</div>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <select value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label={t("builder.category")} style={{ fontSize: "0.85rem", padding: "0.4rem" }}>
                  <option value="">{t("builder.chooseCategory")}</option>
                  {catalogVariants().filter((v) => !processList.some((p) => p.catalogId === v.id)).map((v) => <option key={v.id} value={v.id}>{v.path.map((x) => bi(x)).join(" › ")}</option>)}
                </select>
                <button className="button button-small" type="button" disabled={!newCat} onClick={async () => { const r = await run(() => api.createProcess(newCat)); if (r) { setShowNew(false); setNewCat(""); setReady(false); await refresh(newCat); } }}>{t("builder.create")}</button>
              </div>
            </div>
          )}
        </span>
        <input className="ws-name" value={name} onChange={(e) => { setName(e.target.value); touch(); }} aria-label={t("builder.name")} />
        {live ? <span className="pill pill-ok">{t("builder.live", { v: live.version })}</span> : <span className="pill pill-muted">{t("builder.notLive")}</span>}
        {category !== DEFAULT_CATEGORY && <span className="pill pill-muted" title={t("builder.notRunning")}>{t("builder.notRunning")}</span>}
        {dirty && <span className="pill pill-warn">{t("builder.draft")} · {t("builder.unsaved")}</span>}
        <span className="ws-sep" />
        <button className="icon-button" type="button" title={`${t("builder.undo")} (⌘Z)`} aria-label={t("builder.undo")} disabled={past.current.length === 0} onClick={undo}><Undo2 size={16} /></button>
        <button className="icon-button" type="button" title={`${t("builder.redo")} (⇧⌘Z)`} aria-label={t("builder.redo")} disabled={future.current.length === 0} onClick={redo}><Redo2 size={16} /></button>
        <button className="icon-button" type="button" title={t("builder.tidy")} aria-label={t("builder.tidy")} onClick={tidy}><LayoutDashboard size={16} /></button>
        <button className="icon-button" type="button" title={t("builder.fit")} aria-label={t("builder.fit")} onClick={() => rf.fitView({ padding: 0.12, duration: 250 })}><Maximize2 size={16} /></button>
        {history.length > 0 && (
          <span style={{ position: "relative" }}>
            <button className="button button-ghost button-small" type="button" onClick={() => setShowVersions((v) => !v)}>{t("builder.versions")}</button>
            {showVersions && (
              <div className="card" style={{ position: "absolute", top: "110%", left: 0, zIndex: 20, width: 320, padding: "0.6rem 0.8rem" }}>
                {[...history].reverse().map((h) => (
                  <div key={h.version} className="row small" style={{ justifyContent: "space-between", padding: "0.3rem 0" }}>
                    <span>v{h.version} · {h.updatedBy} · {dateTime(h.updatedAt)}</span>
                    <button className="link-button" type="button" onClick={async () => { setShowVersions(false); const r = await run(() => api.restore(category, h.version)); if (r) await refresh(); }}>{t("builder.restore")}</button>
                  </div>
                ))}
              </div>
            )}
          </span>
        )}
        <span className="ws-spacer" />
        <button className={`button button-small ${showInputs ? "" : "button-ghost"}`} type="button" onClick={() => { setShowInputs((v) => !v); setSelected(null); }}><ListChecks size={15} />{t("builder.inputs")} ({inputs.length})</button>
        <button className="button button-ghost button-small" type="button" onClick={validate}><CheckCircle2 size={15} />{t("builder.validate")}</button>
        <button className={`button button-small ${drawer ? "" : "button-ghost"}`} type="button" onClick={() => setDrawer((d) => !d)}><Play size={14} />{t("builder.testRun")}</button>
        <button className="button button-ghost button-small" type="button" disabled={busy} onClick={async () => { const r = await run(() => api.saveDraft(toDef())); if (r) { setDirty(false); setToast({ text: t("builder.saved"), tone: "ok" }); } }}>{t("builder.save")}</button>
        <button
          className="button button-small"
          type="button"
          disabled={busy}
          onClick={async () => {
            const found = validate();
            if (found.length) return;
            const r = await run(() => api.publish(toDef()));
            if (r) {
              setToast({ text: `${t("builder.published", { v: r.version })} ${t("builder.publish.note")}`, tone: "ok" });
              await refresh();
            }
          }}
        >
          {t("builder.publish")}
        </button>
      </div>

      <div className="ws-body">
        <aside className={`ws-palette${collapsed ? " collapsed" : ""}`} aria-label={t("builder.palette")}>
          <div className="row" style={{ justifyContent: collapsed ? "center" : "space-between", gap: "0.4rem", flexWrap: "nowrap" }}>
            {!collapsed && (
              <label className="ws-search" style={{ flex: 1 }}>
                <Search size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("builder.search")} aria-label={t("builder.search")} />
              </label>
            )}
            <button className="icon-button" type="button" title={t("builder.collapse")} aria-label={t("builder.collapse")} onClick={() => setCollapsed((c) => !c)}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>
          </div>
          {CATEGORIES.map((cat) => {
            const list = items(cat);
            if (list.length === 0) return null;
            return (
              <div key={cat} className={`cat-${cat}`}>
                {!collapsed && <div className="pal-cat">{t(`builder.cat.${cat}` as MessageKey)}</div>}
                {list.map((it) => {
                  const Icon = it.kind === "connector" ? Plug : ICONS[it.kind];
                  return (
                    <button
                      key={it.key}
                      type="button"
                      className="pal-item"
                      draggable
                      title={collapsed ? it.label : t("builder.palette.hint")}
                      onClick={() => addAtCenter(it.kind, it.preset)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-step", JSON.stringify({ kind: it.kind, preset: it.preset }));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                    >
                      <span className="ico"><Icon size={15} strokeWidth={2.2} /></span>
                      {!collapsed && <span>{it.label}</span>}
                      {!collapsed && <GripVertical size={14} className="grip" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </aside>

        <div className="ws-canvas" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
          <ReactFlow
            nodes={nodes}
            edges={shownEdges}
            nodeTypes={nodeTypes}
            onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === "remove" || (x.type === "position" && x.dragging === false))) touch(); }}
            onEdgesChange={(c) => { onEdgesChange(c); if (c.some((x) => x.type === "remove")) touch(); }}
            onNodeDragStart={checkpoint}
            onBeforeDelete={async () => { checkpoint(); return true; }}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sn }) => setSelected(sn[0]?.id ?? null)}
            onPaneClick={() => setShowVersions(false)}
            snapToGrid
            snapGrid={[16, 16]}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            minZoom={0.3}
            maxZoom={1.6}
            colorMode={theme}
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="var(--grid)" />
            <Controls showInteractive={false} position="bottom-left" />
            {!sel && nodes.length > 0 && <MiniMap pannable zoomable position="bottom-right" style={{ width: 130, height: 84 }} maskColor="rgba(120,130,150,0.12)" nodeColor="#8892a6" />}
          </ReactFlow>

          {nodes.length === 0 && <div className="ws-empty"><p>{t("builder.empty")}</p></div>}

          {toast && (
            <div className="ws-float" role="status">
              <div className={`toast ${toast.tone}`}>
                {toast.tone === "ok" ? <CheckCircle2 size={16} color="var(--ok)" /> : <AlertTriangle size={16} color="var(--warn)" />}
                <span>{toast.text}</span>
                <button className="icon-button" type="button" aria-label={t("builder.close")} onClick={() => setToast(null)}><X size={14} /></button>
              </div>
            </div>
          )}

          {issues.length > 0 && (
            <div className="issue-list" role="alert">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.3rem" }}>
                <strong className="small">{t("builder.issuesCount", { n: issues.length })}</strong>
                <button className="icon-button" type="button" aria-label={t("builder.close")} onClick={() => { setIssues([]); mark({}); }}><X size={14} /></button>
              </div>
              {issues.map((i, k) => (
                <button key={k} type="button" onClick={() => i.nodeId && rf.fitView({ nodes: [{ id: i.nodeId }], padding: 1.2, duration: 300, maxZoom: 1 })}>
                  <AlertTriangle size={14} color="var(--warn)" style={{ flex: "none", marginTop: 3 }} />
                  <span>{bi(i.message)}</span>
                </button>
              ))}
            </div>
          )}

          {showInputs && (
            <aside className="ws-inspector" aria-label={t("inputs.title")}>
              <header>
                <span className="ico"><ListChecks size={16} strokeWidth={2.2} /></span>
                <div style={{ flex: 1 }}><strong>{t("inputs.title")}</strong></div>
                <button className="icon-button" type="button" aria-label={t("builder.close")} onClick={() => setShowInputs(false)}><X size={16} /></button>
              </header>
              <div className="body"><InputsEditor inputs={inputs} templates={templates} onChange={(next) => { setInputs(next); touch(); }} /></div>
            </aside>
          )}
          {sel && !showInputs && (
            <aside className="ws-inspector" aria-label={t("builder.config")}>
              <header className={`cat-${NODE_CATALOG[sel.data.kind].category}`}>
                <span className="ico">{(() => { const I = ICONS[sel.data.kind]; return <I size={16} strokeWidth={2.2} />; })()}</span>
                <div style={{ flex: 1 }}>
                  <strong>{bi(NODE_CATALOG[sel.data.kind].title)}</strong>
                  <div className="nd-cat">{t(`builder.cat.${NODE_CATALOG[sel.data.kind].category}` as MessageKey)}</div>
                </div>
                <button className="icon-button" type="button" aria-label={t("builder.close")} onClick={() => { setSelected(null); setNodes((ns) => ns.map((n) => ({ ...n, selected: false }))); }}><X size={16} /></button>
              </header>
              <div className="body">
                <p className="small muted" style={{ margin: 0 }}>{bi(NODE_CATALOG[sel.data.kind].description)}</p>
                {NODE_CATALOG[sel.data.kind].ai && <p className="banner banner-info small" style={{ margin: 0 }}>{t("builder.aiNote")}</p>}
                {sel.data.kind === "connector" && <p className="small muted" style={{ margin: 0 }}>{t("builder.connectorNote")}</p>}
                {sel.data.kind === "read_documents" && (
                  <p className="small muted" style={{ margin: 0 }}>{t("builder.readPerType")}</p>
                )}
                {sel.data.kind === "read_documents" && sel.data.config.method !== undefined && sel.data.config.method !== "default" && (
                  <div className="banner banner-warn small" style={{ display: "grid", gap: "0.5rem" }}>
                    <span>{t("builder.readForced", { m: String(sel.data.config.method) })}</span>
                    <button className="button button-ghost button-small" type="button" onClick={() => { checkpoint(); setNodes((ns) => ns.map((n) => (n.id === sel.id ? { ...n, data: { ...n.data, config: Object.fromEntries(Object.entries(n.data.config).filter(([k]) => k !== "method")) } } : n))); touch(); }}>{t("builder.readClear")}</button>
                  </div>
                )}
                {sel.data.kind === "assign_caseworker" && <AssignmentTable embedded />}
                {sel.data.kind === "run_rules" && <RulePicker value={sel.data.config.rules === undefined ? undefined : String(sel.data.config.rules)} onChange={(v) => { checkpoint(); setConfig("rules", v); }} />}
                {NODE_CATALOG[sel.data.kind].fields.filter((f) => !(sel.data.kind === "run_rules" && f.key === "rules")).map((f) => {
                  let options = f.options;
                  if (sel.data.kind === "connector" && f.key === "action") options = CONNECTORS.find((c) => c.id === sel.data.config.system)?.actions.map((a) => ({ value: a.id, label: a.label }));
                  const val = sel.data.config[f.key] ?? f.default;
                  return (
                    <label className="field" key={f.key}>
                      {bi(f.label)}
                      {f.type === "select" ? (
                        <select
                          value={String(val)}
                          onFocus={checkpoint}
                          onChange={(e) => {
                            setConfig(f.key, e.target.value);
                            if (sel.data.kind === "connector" && f.key === "system") setConfig("action", CONNECTORS.find((c) => c.id === e.target.value)!.actions[0]!.id);
                          }}
                        >
                          {options?.map((o) => <option key={o.value} value={o.value}>{bi(o.label)}</option>)}
                        </select>
                      ) : f.type === "textarea" ? (
                        <textarea rows={4} value={String(val)} onFocus={checkpoint} onChange={(e) => setConfig(f.key, e.target.value)} />
                      ) : f.type === "number" ? (
                        <input type="number" min={1} value={Number(val)} onFocus={checkpoint} onChange={(e) => setConfig(f.key, Number(e.target.value))} />
                      ) : (
                        <input value={String(val)} onFocus={checkpoint} onChange={(e) => setConfig(f.key, e.target.value)} />
                      )}
                    </label>
                  );
                })}
                <button className="button button-ghost button-small" type="button" onClick={() => { checkpoint(); setNodes((ns) => ns.filter((n) => n.id !== sel.id)); setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id)); setSelected(null); touch(); }}>{t("builder.delete")}</button>
              </div>
            </aside>
          )}
        </div>
      </div>

      {drawer && (
        <section className="ws-drawer" aria-label={t("builder.testRun")}>
          <div className="drawer-bar">
            <strong>{t("builder.testRun")}</strong>
            <select value={sample} onChange={(e) => setSample(e.target.value)} aria-label={t("builder.test.sample")}>
              {(["incomplete", "complete", "internship", "unclear"] as const).map((s) => <option key={s} value={s}>{t(`builder.test.sample.${s}` as MessageKey)}</option>)}
            </select>
            <select value={decision} onChange={(e) => setDecision(e.target.value)} aria-label={t("builder.test.decision")}>
              <option value="">{t("builder.test.decision.none")}</option>
              {(["approved", "rejected", "info", "confirmed"] as const).map((d) => <option key={d} value={d}>{t(`builder.test.decision.${d}` as MessageKey)}</option>)}
            </select>
            <button
              className="button button-small"
              type="button"
              disabled={busy}
              onClick={async () => {
                const found = validate();
                if (found.length) return;
                const r = await run(() => api.testRun(toDef(), sample, decision || undefined));
                if (r) {
                  setResult(r);
                  mark(Object.fromEntries(r.log.map((l) => [l.nodeId, { s: "visited" as const }])));
                }
              }}
            >
              <Play size={14} />{t("builder.test.run")}
            </button>
            {result && <span className="small muted">{t("builder.test.status", { s: tk(`status.${result.status}`) })}{result.waiting ? ` · ${t("builder.test.waiting")}` : ""}{result.team ? ` · ${t("builder.test.team", { t: result.team })}` : ""}</span>}
            <span className="ws-spacer" />
            <span className="small muted">{t("builder.test.note")}</span>
            <button className="icon-button" type="button" aria-label={t("builder.close")} onClick={() => { setDrawer(false); mark({}); setResult(null); }}><X size={16} /></button>
          </div>
          {!result ? (
            <p className="muted" style={{ padding: "1rem" }}>{t("builder.nothingYet")}</p>
          ) : (
            <div className="cols">
              <div className="col">
                <h3>{t("builder.steps")}</h3>
                {result.log.map((l, i) => (
                  <div className="log-line" key={i}>
                    <span aria-hidden style={{ color: "var(--ok)" }}><Check size={14} /></span>
                    <span><strong>{bi(NODE_CATALOG[l.kind as NodeKind]?.title ?? { de: l.kind, en: l.kind })}</strong><br /><span className="muted">{l.note}</span></span>
                  </div>
                ))}
              </div>
              <div className="col">
                <h3>{t("builder.test.mails")}</h3>
                {result.mails.length === 0 && <span className="muted small">–</span>}
                {result.mails.map((m) => (
                  <div className="mail" key={m.id} style={{ marginBottom: "0.5rem" }}>
                    <strong className="small">{m.subject}</strong> {m.aiDraft && <span className="pill">{t("flow.aiDraft")}</span>}
                    <pre>{m.body}</pre>
                  </div>
                ))}
              </div>
              <div className="col">
                <h3>{t("builder.test.calls")}</h3>
                {result.integrations.length === 0 && <span className="muted small">–</span>}
                {result.integrations.map((c, i) => <p key={i} className="small" style={{ margin: "0 0 0.3rem" }}><code>{c.system}.{c.action}</code> → {String((c.response as { externalId?: string }).externalId)}</p>)}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function BuilderPage() {
  const { t } = useI18n();
  const { canBuild } = useStaff();
  if (!canBuild) return <div className="container page"><p className="banner banner-warn">{t("builder.noAccess")}</p></div>;
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  );
}
