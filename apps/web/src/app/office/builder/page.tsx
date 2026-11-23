"use client";

import {
  type DocumentTemplate,
  type ProcessInput,
  DEFAULT_CATEGORY,
  CONNECTORS,
  NODE_CATALOG,
  TOKEN_KEYS,
  uniqueStepName,
  applyMentions,
  canMerge,
  decideSuggestion,
  renameImpact,
  renameOutputTokens,
  defaultConfig,
  outputsOf,
  validateProcess,
  type Category,
  type ConfigValue,
  type FlowEdge,
  type FlowNode,
  type Mention,
  type NodeKind,
  type SuggestionChoice,
  type ProcessDef,
  type ProcessIssue,
  type ProcessTest,
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
  ArrowLeft,
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
import { ExpressionEditor, FunctionTiles, previewResult } from "@/components/Expressions";
import { JsonPicker } from "@/components/JsonPicker";
import { OutputTiles, ProvidesList, useTokenResolver } from "@/components/StepOutputs";
import { ProcessTestsPanel } from "@/components/ProcessTestsPanel";
import { PublishDialog } from "@/components/PublishDialog";
import { TemplateParams } from "@/components/TemplateParams";
import { TokenField, type TokenFieldHandle } from "@/components/TokenField";
import { RulePicker } from "@/components/RulePicker";
import { InputsEditor } from "@/components/InputsEditor";
import { CATEGORIES, ICONS, NODE_W, edgeBase, layout, ARROW, nodeTypes, toRfNode, type StepData, type StepNode } from "@/components/FlowKit";
import Link from "next/link";
import { Spinner } from "@/components/ui";
import { ApiError, api, type MessageEntry, type ProcessImpact, type ProcessTestResult, type TestRunResult } from "@/lib/api";
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
  const [history, setHistory] = useState<{ version: number; updatedAt: string; updatedBy: string; name: string }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [issues, setIssues] = useState<ProcessIssue[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<string | null>(null);
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
  const [owner, setOwner] = useState("");
  const [tests, setTests] = useState<ProcessTest[]>([]);
  const [showTests, setShowTests] = useState(false);
  const [testResults, setTestResults] = useState<ProcessTestResult[] | null>(null);
  const [messages, setMessages] = useState<MessageEntry[]>([]);
  const [publishDlg, setPublishDlg] = useState<{ impact: ProcessImpact; tests: ProcessTestResult[] } | null>(null);
  const [changeNote, setChangeNote] = useState("");
  /** The tiles with the outputs of earlier steps open beside the panel while a text field is in use. */
  const [tilesOpen, setTilesOpen] = useState(false);
  const [paneTab, setPaneTab] = useState<"outputs" | "functions">("outputs");
  /** The functions being edited, outermost first. Each has the text it stands for and a way to put a new text into its tile. */
  const [exprStack, setExprStack] = useState<{ raw: string; apply: (next: string) => void }[]>([]);
  useEffect(() => {
    setTilesOpen(false);
    setExprStack([]);
  }, [selected]);
  const openExprAt = (depth: number, raw: string, apply: (next: string) => void) => {
    setExprStack((st) => [...st.slice(0, depth), { raw, apply }]);
    setTilesOpen(true);
    setPaneTab("functions");
  };
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
    nodes: nodesRef.current.map((n) => ({ id: n.id, kind: n.data.kind, name: n.data.name, purpose: n.data.purpose, ...(n.data.comment ? { comment: n.data.comment } : {}), ...(n.data.suggestion ? { suggestion: n.data.suggestion } : {}), position: n.position, config: n.data.config })),
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
    // A process just made from a description has rough positions: arrange it once, then forget the hint.
    const params = new URLSearchParams(window.location.search);
    const arrange = params.get("tidy") === "1";
    if (arrange) { params.delete("tidy"); window.history.replaceState(null, "", `${window.location.pathname}?${params}`); }
    if (!isDraft || arrange) ns = layout(ns, es);
    // Once the steps are drawn their real heights are known; arrange again so tall ones do not touch.
    if (arrange) setTimeout(() => { setNodes((cur) => layout(cur, es)); setTimeout(() => rf.fitView({ padding: 0.12, duration: 250 }), 150); }, 700);
    setNodes(ns);
    setEdges(es);
    setName(def.name);
    setInputs(def.inputs ?? []);
    setOwner(def.owner ?? "");
    setTests(def.tests ?? []);
    setTestResults(null);
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
    const [p, lib, msgs] = await Promise.all([api.processes(target), api.templates().catch(() => null), api.messages().catch(() => [] as MessageEntry[])]);
    if (lib) setTemplates(lib.templates);
    setMessages(msgs);
    setCategory(target);
    setLive(p.live);
    setHistory(p.history);
    const def = p.draft ?? p.live;
    if (def) load(def, Boolean(p.draft));
    loaded.current = true;
    setReady(true);
  }, [load, category]);
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("category");
    void refresh(wanted || undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setEdges((es) => es.map((e) => ({ ...e, label: edgeLabel(e.source, e.sourceHandle ?? "out", nodesRef.current) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const touch = () => loaded.current && setDirty(true);

  const toDef = useCallback((): ProcessDef => {
    const s = snapshot();
    return { id: live?.id ?? category, catalogId: category, name, version: (live?.version ?? 0) + 1, updatedAt: new Date().toISOString(), updatedBy: "", owner, tests, inputs, nodes: s.nodes, edges: s.edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, name, inputs, owner, tests]);

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

  /** The connection under a screen point, if any: dropping a step there puts it in between. */
  const edgeAtPoint = (x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const id = el.closest(".react-flow__edge")?.getAttribute("data-id");
      if (id) return id;
    }
    return null;
  };

  /** Puts a step into a connection: source → step → target. The step's first output carries on to the old target. */
  const insertIntoEdge = (edgeId: string, nodeId: string, kind: NodeKind): boolean => {
    const e = edgesRef.current.find((x) => x.id === edgeId);
    const outs = outputsOf(kind);
    if (!e || !outs.length || kind === "trigger" || e.source === nodeId || e.target === nodeId) return false;
    const first = outs[0]!;
    setEdges((es) => [
      ...es.filter((x) => x.id !== edgeId),
      { id: edgeId, source: e.source, sourceHandle: e.sourceHandle, target: nodeId, label: e.label, ...edgeBase },
      { id: `${nodeId}:${first.id}`, source: nodeId, sourceHandle: first.id, target: e.target, label: outs.length > 1 ? bi(first.label) : undefined, ...edgeBase },
    ]);
    return true;
  };

  const addNode = (kind: NodeKind, preset: Record<string, ConfigValue> | undefined, position: { x: number; y: number }, into?: string | null) => {
    checkpoint();
    const id = `${kind}-${Date.now().toString(36)}`;
    const stepName = uniqueStepName(bi(NODE_CATALOG[kind].title), nodesRef.current.map((n) => n.data.name ?? ""));
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: "step", position, selected: true, data: { kind, name: stepName, config: defaultConfig(kind, preset) } }]);
    setSelected(id);
    if (into && insertIntoEdge(into, id, kind)) setTimeout(() => { setNodes((ns) => layout(ns, edgesRef.current)); rf.fitView({ padding: 0.12, duration: 300 }); }, 80);
    touch();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const into = edgeAtPoint(e.clientX, e.clientY);
    setDropEdge(null);
    const raw = e.dataTransfer.getData("application/x-step");
    if (!raw) return;
    const { kind, preset } = JSON.parse(raw) as { kind: NodeKind; preset?: Record<string, ConfigValue> };
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(kind, preset, { x: Math.round((p.x - NODE_W / 2) / 16) * 16, y: Math.round((p.y - 30) / 16) * 16 }, into);
  };

  /** A step that is dragged by hand and has no connections yet is put into the connection it is let go on. */
  const onNodeDragStop = (ev: React.MouseEvent, node: Node) => {
    setDropEdge(null);
    const kind = (node.data as StepData).kind;
    if (edgesRef.current.some((x) => x.source === node.id || x.target === node.id)) return;
    const into = edgeAtPoint(ev.clientX, ev.clientY);
    if (into && insertIntoEdge(into, node.id, kind)) {
      touch();
      setTimeout(() => { setNodes((ns) => layout(ns, edgesRef.current)); rf.fitView({ padding: 0.12, duration: 300 }); }, 80);
    }
  };

  const deleteEdge = () => {
    if (!selEdge) return;
    checkpoint();
    setEdges((es) => es.filter((x) => x.id !== selEdge));
    setSelEdge(null);
    touch();
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
  /** Texts a message template replaces. */
  const TEMPLATE_TEXTS = ["subject", "subject_en", "body", "body_en", "fallback", "fallback_en"];
  const setMeta = (key: "name" | "purpose" | "comment", value: string) => {
    setNodes((ns) => ns.map((n) => (n.id === selected ? { ...n, data: { ...n.data, [key]: value } } : n)));
    touch();
  };
  /** The fields where outputs of earlier steps can be put in as tiles. */
  const tokenRefs = useRef<Record<string, TokenFieldHandle | null>>({});
  const activeToken = useRef<string | null>(null);
  const graph = useMemo(() => ({ nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, name: n.data.name, config: n.data.config, x: n.position.x, y: n.position.y })), edges: edges.map((e) => ({ source: e.source, target: e.target })) }), [nodes, edges]);
  const tokens = useTokenResolver(graph, selected ?? "");
  /** What a rename touches besides the step itself, for a person to accept or leave. */
  const [notice, setNotice] = useState<{ title: string; lines: string[]; count: number; applyLabel: string; apply: () => void } | null>(null);
  useEffect(() => setNotice(null), [selected]);
  const nameAtFocus = useRef("");
  /** Puts the accepted changes of a rename into the steps they belong to. */
  const applyDef = (next: ProcessDef, ids: string[]) => {
    checkpoint();
    setNodes((ns) => ns.map((n) => {
      const m = ids.includes(n.id) ? next.nodes.find((x) => x.id === n.id) : undefined;
      return m ? { ...n, data: { ...n.data, name: m.name, purpose: m.purpose, comment: m.comment, suggestion: m.suggestion, config: m.config } } : n;
    }));
    touch();
    setNotice(null);
  };
  const stepList = (ids: string[]) => [...new Set(ids)].map((id) => tokens.names.get(id) ?? id).join(", ");
  /** The name of a step changed: where is it used? Tiles follow by themselves; names written out as text are proposed. */
  const checkRename = (id: string, from: string, to: string) => {
    if (!from.trim() || !to.trim() || from.trim() === to.trim()) return;
    const def = toDef();
    const impact = renameImpact(def, id, from, to);
    if (impact.tiles.length === 0 && impact.mentions.length === 0) return;
    const mentions: Mention[] = impact.mentions;
    setNotice({
      title: t("rn.title", { old: from.trim(), new: to.trim() }),
      lines: [
        ...(impact.tiles.length ? [t("rn.tiles", { list: stepList(impact.tiles.map((x) => x.nodeId)) })] : []),
        ...(mentions.length ? [t("rn.mentions", { list: stepList(mentions.map((x) => x.nodeId)) })] : []),
      ],
      count: mentions.length,
      applyLabel: t("rn.apply", { n: String(mentions.length) }),
      apply: () => applyDef(applyMentions(toDef(), mentions), mentions.map((x) => x.nodeId)),
    });
  };
  /** A picked field of an HTTP step got a new name: its tiles downstream would break, so they are offered the new name. */
  const checkOutputRename = (id: string, from: string, to: string) => {
    const r = renameOutputTokens(toDef(), id, from, to);
    if (r.changed.length === 0) return;
    setNotice({
      title: t("rn.out.title", { old: from, new: to }),
      lines: [t("rn.out.body", { n: String(r.changed.length), list: stepList(r.changed.map((x) => x.nodeId)) })],
      count: r.changed.length,
      applyLabel: t("rn.out.apply"),
      apply: () => applyDef(r.def, r.changed.map((x) => x.nodeId)),
    });
  };
  const flowOf = (n: StepNode): FlowNode => ({ id: n.id, kind: n.data.kind, name: n.data.name, purpose: n.data.purpose, comment: n.data.comment, suggestion: n.data.suggestion, position: n.position, config: n.data.config });
  const decide = (choice: SuggestionChoice) => {
    if (!sel) return;
    const before = flowOf(sel);
    const after = decideSuggestion(before, choice);
    checkpoint();
    setNodes((ns) => ns.map((n) => (n.id === sel.id ? { ...n, data: { ...n.data, name: after.name, comment: after.comment, suggestion: undefined } } : n)));
    touch();
    if (before.name && after.name && before.name !== after.name) checkRename(sel.id, before.name, after.name);
  };
  const documentWithAi = async () => {
    const r = await run(() => api.documentProcess(toDef()));
    if (!r) return;
    const n = Object.keys(r.suggestions).length;
    setNodes((ns) => ns.map((x) => ({ ...x, data: { ...x.data, suggestion: r.suggestions[x.id] } })));
    touch();
    setToast({ text: n ? t("doc.done", { n: String(n) }) : t("doc.none"), tone: "ok" });
  };
  const pendingSuggestions = nodes.filter((n) => n.data.suggestion).length;
  /** The request of an HTTP step as the JSON picker sends it for a test: tiles are filled with example values. */
  const httpRequestOf = (c: Record<string, ConfigValue>) => {
    const fill = (v: unknown) => { const r = previewResult(String(v ?? ""), lang); return r.ok ? r.text : String(v ?? ""); };
    const headers: Record<string, string> = {};
    for (const line of fill(c.headers).split("\n")) { const i = line.indexOf(":"); if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    return { method: String(c.method ?? "GET"), url: fill(c.url).trim(), headers, ...(c.body ? { body: fill(c.body) } : {}) };
  };
  const hasTokenFields = sel ? NODE_CATALOG[sel.data.kind].fields.some((f) => ((f.type === "text" || f.type === "textarea") && TOKEN_KEYS.includes(f.key)) || f.type === "params") : false;
  const insertToken = (raw: string) => {
    if (!sel) return;
    const withTemplate = Boolean(sel.data.config.template);
    const keys = NODE_CATALOG[sel.data.kind].fields.filter((f) => (f.type === "text" || f.type === "textarea") && TOKEN_KEYS.includes(f.key) && !(withTemplate && TEMPLATE_TEXTS.includes(f.key))).map((f) => f.key);
    const base = keys.includes("body") ? "body" : keys.includes("fallback") ? "fallback" : keys.includes("payload") ? "payload" : keys.includes("instruction") ? "instruction" : keys[0];
    const preferred = base && lang === "en" && keys.includes(`${base}_en`) ? `${base}_en` : base;
    // The field the person is in; otherwise the first value of the chosen template; otherwise the main text.
    const paramKey = Object.keys(tokenRefs.current).find((k) => k.startsWith("params:") && tokenRefs.current[k]);
    const slotActive = exprStack.length > 0 && activeToken.current?.startsWith("expr:") && tokenRefs.current[activeToken.current];
    const key = slotActive ? activeToken.current! : activeToken.current && !activeToken.current.startsWith("expr:") && tokenRefs.current[activeToken.current] ? activeToken.current : withTemplate && paramKey ? paramKey : preferred;
    if (key) tokenRefs.current[key]?.insert(raw);
  };
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
      return { ...e, interactionWidth: 28, className: [on ? "visited" : "", e.id === dropEdge ? "drop-target" : ""].filter(Boolean).join(" ") || undefined, animated: on, markerEnd: { ...ARROW, color: on ? "#17a06a" : ARROW.color } };
    }),
    [edges, result, visitedHandles, dropEdge],
  );

  if (!ready) return <div className="container page"><Spinner label={t("common.loading")} /></div>;

  const q = query.trim().toLowerCase();
  const items = (cat: Category) =>
    (cat === "connector"
      ? [
          ...CONNECTORS.map((c) => ({ key: c.id, kind: "connector" as NodeKind, label: bi(c.name), preset: { system: c.id, action: c.actions[0]!.id } as Record<string, ConfigValue> })),
          { key: "http_request", kind: "http_request" as NodeKind, label: bi(NODE_CATALOG.http_request.title), preset: undefined as Record<string, ConfigValue> | undefined },
        ]
      : Object.values(NODE_CATALOG).filter((s) => s.category === cat).map((s) => ({ key: s.kind, kind: s.kind, label: bi(s.title), preset: undefined as Record<string, ConfigValue> | undefined }))
    ).filter((it) => !q || it.label.toLowerCase().includes(q));

  return (
    <div className="ws">
      <div className="ws-toolbar">
        <Link href="/office/processes" className="button button-ghost button-small" onClick={(e) => { if (dirty && !window.confirm(t("builder.switchConfirm"))) e.preventDefault(); }}><ArrowLeft size={15} />{t("builder.back")}</Link>
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
        <button className="button button-ghost button-small" type="button" disabled={busy} title={t("doc.simulated")} onClick={documentWithAi}><Sparkles size={15} />{t("doc.run")}{pendingSuggestions > 0 ? ` (${pendingSuggestions})` : ""}</button>
        {pendingSuggestions > 0 && <button className="link-button small" type="button" onClick={() => { checkpoint(); setNodes((ns) => ns.map((x) => ({ ...x, data: { ...x.data, suggestion: undefined } }))); touch(); }}>{t("doc.rejectAll")}</button>}
        <button className="button button-ghost button-small" type="button" onClick={validate}><CheckCircle2 size={15} />{t("builder.validate")}</button>
        <button className={`button button-small ${drawer ? "" : "button-ghost"}`} type="button" onClick={() => { setDrawer((d) => !d); setShowTests(false); }}><Play size={14} />{t("builder.testRun")}</button>
        <button className={`button button-small ${showTests ? "" : "button-ghost"}`} type="button" onClick={() => { setShowTests((d) => !d); setDrawer(false); }}><CheckCircle2 size={14} />{t("builder.testsBtn")} ({tests.length})</button>
        <button className="button button-ghost button-small" type="button" disabled={busy} onClick={async () => { const r = await run(() => api.saveDraft(toDef())); if (r) { setDirty(false); setToast({ text: t("builder.saved"), tone: "ok" }); } }}>{t("builder.save")}</button>
        <button
          className="button button-small"
          type="button"
          disabled={busy}
          onClick={async () => {
            const found = validate();
            if (found.length) return;
            const [impact, tr] = await Promise.all([run(() => api.processImpact(toDef())), run(() => api.processTests(toDef()))]);
            if (impact && tr) {
              setChangeNote("");
              setPublishDlg({ impact, tests: tr.results });
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

        <div className="ws-canvas" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (e.dataTransfer.types.includes("application/x-step")) { const id = edgeAtPoint(e.clientX, e.clientY); setDropEdge((cur) => (cur === id ? cur : id)); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDropEdge(null); }}>
          <ReactFlow
            nodes={nodes}
            edges={shownEdges}
            nodeTypes={nodeTypes}
            onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === "remove" || (x.type === "position" && x.dragging === false))) touch(); }}
            onEdgesChange={(c) => { onEdgesChange(c); if (c.some((x) => x.type === "remove")) touch(); }}
            onNodeDragStart={checkpoint}
            onNodeDrag={(ev, node) => { if (!edgesRef.current.some((x) => x.source === node.id || x.target === node.id)) { const id = edgeAtPoint(ev.clientX, ev.clientY); setDropEdge((cur) => (cur === id ? cur : id)); } }}
            onNodeDragStop={onNodeDragStop}
            onBeforeDelete={async () => { checkpoint(); return true; }}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sn, edges: se }) => { setSelected(sn[0]?.id ?? null); setSelEdge(sn.length === 0 ? se[0]?.id ?? null : null); }}
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

          {selEdge && (
            <div className="ws-edgebar" role="status">
              <span>{t("builder.edge.selected")}</span>
              <button type="button" className="button button-small" onClick={deleteEdge}>{t("builder.edge.delete")}</button>
            </div>
          )}

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
                {sel.data.suggestion && (
                  <div className="doc-card" role="group" aria-label={t("doc.title")}>
                    <div className="doc-head"><Sparkles size={14} /><strong>{t("doc.title")}</strong></div>
                    {sel.data.suggestion.name && (
                      <div className="doc-row"><span className="small muted">{t("doc.name")}</span><span><del>{sel.data.name || "–"}</del> → <b>{sel.data.suggestion.name}</b></span></div>
                    )}
                    {sel.data.suggestion.comment && (
                      <div className="doc-row stack">
                        <span className="small muted">{t("doc.comment")}</span>
                        {sel.data.comment?.trim() && <span className="doc-mine"><span className="small muted">{t("doc.yours")}: </span>{sel.data.comment}</span>}
                        <span className="doc-ai"><span className="small muted">{t("doc.proposed")}: </span>{sel.data.suggestion.comment}</span>
                      </div>
                    )}
                    <div className="row" style={{ gap: "0.4rem" }}>
                      <button type="button" className="button button-small" onClick={() => decide("use")}>{t("doc.use")}</button>
                      <button type="button" className="button button-ghost button-small" disabled={!canMerge(flowOf(sel))} title={canMerge(flowOf(sel)) ? undefined : t("doc.mergeOff")} onClick={() => decide("merge")}>{t("doc.merge")}</button>
                      <button type="button" className="button button-ghost button-small" onClick={() => decide("reject")}>{t("doc.reject")}</button>
                    </div>
                    {!canMerge(flowOf(sel)) && <p className="small muted" style={{ margin: 0 }}>{t("doc.mergeOff")}</p>}
                  </div>
                )}
                <label className="field">{t("builder.stepName")}<input value={sel.data.name ?? ""} onFocus={() => { checkpoint(); nameAtFocus.current = sel.data.name ?? ""; }} onChange={(e) => setMeta("name", e.target.value)} onBlur={() => checkRename(sel.id, nameAtFocus.current, sel.data.name ?? "")} /></label>
                {notice && (
                  <div className="banner banner-info small rn-notice" role="status" style={{ display: "grid", gap: "0.45rem" }}>
                    <strong>{notice.title}</strong>
                    {notice.lines.map((l) => <span key={l}>{l}</span>)}
                    <span className="row" style={{ gap: "0.4rem" }}>
                      {notice.count > 0 && <button type="button" className="button button-small" onClick={notice.apply}>{notice.applyLabel}</button>}
                      <button type="button" className="button button-ghost button-small" onClick={() => setNotice(null)}>{t("rn.leave")}</button>
                    </span>
                  </div>
                )}
                <label className="field">{t("builder.purpose")}<input value={sel.data.purpose ?? ""} onFocus={checkpoint} onChange={(e) => setMeta("purpose", e.target.value)} /></label>
                <label className="field">{t("builder.comment")}<textarea rows={3} value={sel.data.comment ?? ""} placeholder={t("builder.commentPh")} onFocus={checkpoint} onChange={(e) => setMeta("comment", e.target.value)} /></label>
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
                <ProvidesList kind={sel.data.kind} config={sel.data.config} stepId={sel.id} names={tokens.names} />
                {hasTokenFields && <p className="small muted tiles-hint" style={{ margin: 0 }}>{t("builder.tilesHint")}</p>}
                {sel.data.kind === "assign_caseworker" && <AssignmentTable embedded />}
                {NODE_CATALOG[sel.data.kind].fields.filter((f) => !f.hidden && !(sel.data.config.template && TEMPLATE_TEXTS.includes(f.key)) && (!f.showIf || String(sel.data.config[f.showIf.key] ?? NODE_CATALOG[sel.data.kind].fields.find((x) => x.key === f.showIf!.key)?.default) === f.showIf.value)).map((f) => {
                  if (f.type === "picks") {
                    return (
                      <JsonPicker
                        key={`${sel.id}:picks`}
                        value={String(sel.data.config.picks ?? "[]")}
                        sample={String(sel.data.config.sample ?? "")}
                        request={() => httpRequestOf(sel.data.config)}
                        onChange={(v) => { checkpoint(); setConfig("picks", v); }}
                        onSample={(v) => setConfig("sample", v)}
                        onRename={(from, to) => checkOutputRename(sel.id, from, to)}
                      />
                    );
                  }
                  if (f.type === "rules") return <RulePicker key={f.key} value={sel.data.config.rules === undefined ? undefined : String(sel.data.config.rules)} onChange={(v) => { checkpoint(); setConfig("rules", v); }} />;
                  if (f.type === "template") {
                    return (
                      <TemplateParams
                        key={f.key}
                        templates={messages}
                        template={String(sel.data.config.template ?? "")}
                        params={String(sel.data.config.params ?? "")}
                        onTemplate={(id) => { checkpoint(); setConfig("template", id); setConfig("params", ""); }}
                        onParams={(json) => setConfig("params", json)}
                        resolve={tokens.resolve}
                        sig={tokens.sig}
                        register={(key, h) => { tokenRefs.current[key] = h; }}
                        onFocusKey={(key) => { checkpoint(); activeToken.current = key; setTilesOpen(true); }}
                        onEditFn={(raw, apply) => openExprAt(0, raw, apply)}
                      />
                    );
                  }
                  if (f.type === "params") return null;
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
                      ) : (f.type === "text" || f.type === "textarea") && TOKEN_KEYS.includes(f.key) ? (
                        <TokenField
                          key={`${sel.id}:${f.key}`}
                          ref={(h) => { tokenRefs.current[f.key] = h; }}
                          value={String(val)}
                          multiline={f.type === "textarea"}
                          rows={f.key.startsWith("fallback") || f.key.startsWith("body") ? 7 : f.key === "payload" ? 3 : 4}
                          resolve={tokens.resolve}
                          sig={tokens.sig}
                          label={bi(f.label)}
                          onFocus={() => { checkpoint(); activeToken.current = f.key; setTilesOpen(true); }}
                          onEditFn={(raw, apply) => openExprAt(0, raw, apply)}
                          onChange={(v) => setConfig(f.key, v)}
                        />
                      ) : f.type === "textarea" ? (
                        <textarea rows={f.key.startsWith("fallback") || f.key.startsWith("body") ? 7 : 4} value={String(val)} onFocus={checkpoint} onChange={(e) => setConfig(f.key, e.target.value)} />
                      ) : f.type === "number" ? (
                        <input type="number" min={1} value={Number(val)} onFocus={checkpoint} onChange={(e) => setConfig(f.key, Number(e.target.value))} />
                      ) : (
                        <input value={String(val)} onFocus={checkpoint} onChange={(e) => setConfig(f.key, e.target.value)} />
                      )}
                    </label>
                  );
                })}
                <button className="button button-ghost button-small" type="button" onClick={() => {
                  const usedBy = nodes.some((n) => n.id !== sel.id && Object.values(n.data.config).some((v) => typeof v === "string" && v.includes(`{${sel.id}.`)));
                  if (usedBy && !window.confirm(t("builder.deleteRefs", { name: tokens.names.get(sel.id) ?? sel.id }))) return;
                  checkpoint(); setNodes((ns) => ns.filter((n) => n.id !== sel.id)); setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id)); setSelected(null); touch(); }}>{t("builder.delete")}</button>
              </div>
            </aside>
          )}
          {sel && !showInputs && hasTokenFields && tilesOpen && (
            <aside className="ws-tiles" aria-label={t("builder.tilesTitle")}>
              <button className="icon-button ws-tiles-x" type="button" aria-label={t("builder.close")} onClick={() => setTilesOpen(false)}><X size={15} /></button>
              {exprStack.map((e, i) => (
                <div key={i} hidden={i !== exprStack.length - 1}>
                  <ExpressionEditor
                    raw={e.raw}
                    depth={i}
                    resolve={tokens.resolve}
                    sig={tokens.sig}
                    register={(key, h) => { tokenRefs.current[key] = h; }}
                    onFocusSlot={(key) => { activeToken.current = key; }}
                    onEditNested={(raw, apply) => openExprAt(i + 1, raw, apply)}
                    onClose={() => setExprStack((st) => (i === 0 ? [] : st.slice(0, i)))}
                    onChange={(next) => { e.apply(next); setExprStack((st) => st.map((x, k) => (k === i ? { ...x, raw: next } : x))); }}
                  />
                </div>
              ))}
              <div className="pane-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={paneTab === "outputs"} onClick={() => setPaneTab("outputs")}>{t("builder.pane.outputs")}</button>
                <button type="button" role="tab" aria-selected={paneTab === "functions"} onClick={() => setPaneTab("functions")}>{t("builder.pane.functions")}</button>
              </div>
              {paneTab === "outputs" ? <OutputTiles upstream={tokens.upstream} names={tokens.names} onInsert={insertToken} /> : <FunctionTiles onInsert={insertToken} />}
            </aside>
          )}
        </div>
      </div>

      {publishDlg && (
        <PublishDialog
          impact={publishDlg.impact}
          tests={publishDlg.tests}
          owner={owner}
          setOwner={setOwner}
          note={changeNote}
          setNote={setChangeNote}
          busy={busy}
          onCancel={() => setPublishDlg(null)}
          onConfirm={async () => {
            try {
              setBusy(true);
              const r = await api.publish({ ...toDef(), owner, changeNote });
              setPublishDlg(null);
              setToast({ text: `${t("builder.published", { v: r.version })} ${t("builder.publish.note")}`, tone: "ok" });
              await refresh();
            } catch (e) {
              if (e instanceof ApiError && e.tests) setPublishDlg((d) => (d ? { ...d, tests: e.tests! } : d));
              else if (e instanceof ApiError && e.issues) { markIssues(e.issues); setPublishDlg(null); }
              setToast({ text: e instanceof Error ? e.message : String(e), tone: "warn" });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {showTests && (
        <section className="ws-drawer" aria-label={t("builder.testsBtn")}>
          <ProcessTestsPanel
            tests={tests}
            setTests={(next) => { setTests(next); setTestResults(null); touch(); }}
            last={result}
            lastSample={sample}
            lastDecision={decision}
            results={testResults}
            busy={busy}
            stepName={(id) => tokens.names.get(id) ?? id}
            onRun={async () => {
              const found = validate();
              if (found.length) return;
              const r = await run(() => api.processTests(toDef()));
              if (r) setTestResults(r.results);
            }}
          />
        </section>
      )}

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
                {result.failed && <p className="banner banner-warn small" role="alert">{t("builder.test.stopped", { m: result.error?.message ?? "" })}</p>}
                {result.log.map((l, i) => (
                  <div className={`log-line${l.note.startsWith("Stopped") ? " stopped" : ""}`} key={i}>
                    <span aria-hidden style={{ color: l.note.startsWith("Stopped") ? "var(--bad)" : "var(--ok)" }}>{l.note.startsWith("Stopped") ? <AlertTriangle size={14} /> : <Check size={14} />}</span>
                    <span>
                      <strong>{tokens.names.get(l.nodeId) ?? bi(NODE_CATALOG[l.kind as NodeKind]?.title ?? { de: l.kind, en: l.kind })}</strong><br />
                      <span className="muted">{l.note}</span>
                      {l.outputs && Object.keys(l.outputs).length > 0 && (
                        <details>
                          <summary className="small muted">{t("builder.step.data")} ({Object.keys(l.outputs).length})</summary>
                          <div className="data-box">
                            {Object.entries(l.outputs).map(([k, v]) => <div key={k}><code>{k}</code><pre>{v || "–"}</pre></div>)}
                          </div>
                        </details>
                      )}
                    </span>
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
