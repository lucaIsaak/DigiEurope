"use client";

import { CONNECTORS, NODE_CATALOG, outputsOf, type Category, type ConfigValue, type FlowNode, type NodeKind, type ProcessDef } from "@digieurope/shared";
import dagre from "@dagrejs/dagre";
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useStore, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { useTheme } from "@/lib/theme";
import { AlertTriangle, Check, ClipboardCheck, Clock, FilePlus2, Flag, GitBranch, ListChecks, Plug, ScanText, Send, ShieldCheck, Sparkles, UserCheck, Users, Zap, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

export type StepData = { kind: NodeKind; name?: string; purpose?: string; config: Record<string, ConfigValue>; state?: "visited" | "issue" | "only"; issue?: string };
export type StepNode = Node<StepData, "step">;

export const ICONS: Record<NodeKind, LucideIcon> = {
  trigger: Zap,
  run_rules: ShieldCheck,
  check_inputs: ClipboardCheck,
  read_documents: ScanText,
  review_fields: ListChecks,
  condition: GitBranch,
  human_task: UserCheck,
  assign_team: Users,
  assign_caseworker: UserCheck,
  wait: Clock,
  ai_draft_mail: Sparkles,
  request_documents: FilePlus2,
  send_notification: Send,
  connector: Plug,
  end: Flag,
};
export const CATEGORIES: Category[] = ["start", "check", "decide", "message", "route", "connector", "finish"];
export const NODE_W = 264;
export const NODE_H = 96;

export type Bi = { de: string; en: string };

export function summary(d: StepData, bi: (b: Bi) => string): string {
  const c = d.config;
  switch (d.kind) {
    case "condition": return `${c.field} ${c.op === "gte" ? "≥" : c.op === "lte" ? "≤" : c.op === "eq" ? "=" : "≠"} ${c.value}`;
    case "read_documents": return `${c.scope === "all" ? "All documents" : c.scope === "parents" ? "Parents' documents" : "Student's documents"} · ${!c.method || c.method === "default" ? "per type" : c.method}`;
    case "review_fields": return bi({ de: String(c.instruction || ""), en: String(c.instruction_en || c.instruction || "") });
    case "assign_team": return String(c.team);
    case "assign_caseworker": return "By family name";
    case "wait": return `${c.days} d`;
    case "ai_draft_mail": return c.tone === "formal" ? "Formal tone" : "Friendly tone";
    case "send_notification": return `${c.to}: ${c.subject}`;
    case "human_task": return bi({ de: String(c.instruction || ""), en: String(c.instruction_en || c.instruction || "") });
    case "trigger": return c.source === "any" ? "Portal + direct" : String(c.source);
    case "connector": {
      const sys = CONNECTORS.find((x) => x.id === c.system);
      const act = sys?.actions.find((a) => a.id === c.action);
      return `${sys ? bi(sys.name) : c.system} · ${act ? bi(act.label) : c.action}`;
    }
    default: return bi(NODE_CATALOG[d.kind].description);
  }
}

function StepView({ id, data, selected }: NodeProps<StepNode>) {
  const { bi, t } = useI18n();
  const spec = NODE_CATALOG[data.kind];
  const Icon = ICONS[data.kind];
  const multi = spec.outputs.length > 1;
  // Ports are shown left to right in the order of the steps they lead to, so connections never cross at the source.
  const portOrder = useStore((s) => {
    if (spec.outputs.length < 2) return "";
    return spec.outputs
      .map((o, i) => {
        const e = s.edges.find((x) => x.source === id && x.sourceHandle === o.id);
        const x = e ? s.nodeLookup.get(e.target)?.internals.positionAbsolute.x : undefined;
        return { id: o.id, x: x ?? 1e6 + i };
      })
      .sort((a, b) => a.x - b.x)
      .map((p) => p.id)
      .join(",");
  });
  const ports = portOrder ? portOrder.split(",").map((pid) => spec.outputs.find((o) => o.id === pid)!) : spec.outputs;
  return (
    <div className={`nd cat-${spec.category}${multi ? " multi" : ""}${selected ? " sel" : ""}${data.state ? ` ${data.state}` : ""}`} title={data.issue}>
      {data.kind !== "trigger" && <Handle type="target" position={Position.Top} />}
      <div className="nd-head">
        <span className="ico"><Icon size={16} strokeWidth={2.2} /></span>
        <span>
          <div className="nd-title">{data.name?.trim() || bi(spec.title)}</div>
          <div className="nd-cat">{data.name?.trim() ? bi(spec.title) : t(`builder.cat.${spec.category}` as MessageKey)}</div>
        </span>
        {spec.ai && <span className="nd-ai"><Sparkles size={11} />{t("builder.ai")}</span>}
      </div>
      <div className="nd-sum">{summary(data, bi)}</div>
      {data.state === "visited" && <span className="nd-flag ok"><Check size={13} strokeWidth={3} /></span>}
      {data.state === "issue" && <span className="nd-flag bad"><AlertTriangle size={12} /></span>}
      {data.state === "only" && <span className="nd-flag diff"><GitBranch size={12} /></span>}
      {spec.outputs.length > 0 && !multi && <Handle type="source" position={Position.Bottom} id={spec.outputs[0]!.id} />}
      {multi && (
        <div className="nd-ports">
          {ports.map((o) => (
            <span className="nd-port" key={o.id}>
              {bi(o.label)}
              <Handle type="source" position={Position.Bottom} id={o.id} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
export const nodeTypes = { step: StepView };

export const toRfNode = (n: FlowNode): StepNode => ({ id: n.id, type: "step", position: n.position, data: { kind: n.kind, name: n.name, purpose: n.purpose, config: n.config } });
export const ARROW = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#8892a6" } as const;
export const edgeBase = { type: "smoothstep" as const, pathOptions: { borderRadius: 14 }, markerEnd: ARROW, labelBgPadding: [8, 4] as [number, number], labelBgBorderRadius: 10 };

/** Top-to-bottom layout. Branches keep the order of their output ports (left to right). */
export function layout(nodes: StepNode[], edges: Edge[]): StepNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 56, ranksep: 96, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  const order = (e: Edge) => {
    const src = nodes.find((n) => n.id === e.source);
    return src ? outputsOf(src.data.kind).findIndex((o) => o.id === e.sourceHandle) : 0;
  };
  [...edges].sort((a, b) => order(a) - order(b)).forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return p ? { ...n, position: { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - NODE_H / 2) } } : n;
  });
}


/** Read-only picture of a process. Steps without a counterpart in the process it is compared with are marked. */
export function ProcessViewer({ def, only = [], height = 680 }: { def: Pick<ProcessDef, "id" | "nodes" | "edges">; only?: string[]; height?: number }) {
  const { bi } = useI18n();
  const { theme } = useTheme();
  const { nodes, edges } = useMemo(() => {
    const base = def.nodes.map((n) => ({ ...toRfNode(n), data: { kind: n.kind, name: n.name, purpose: n.purpose, config: n.config, state: only.includes(n.id) ? ("only" as const) : undefined } }));
    const label = (source: string, handle: string) => {
      const kind = def.nodes.find((n) => n.id === source)?.kind;
      const outs = kind ? outputsOf(kind) : [];
      return outs.length > 1 ? bi(outs.find((o) => o.id === handle)?.label ?? { de: handle, en: handle }) : undefined;
    };
    const es: Edge[] = def.edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, label: label(e.source, e.sourceHandle), ...edgeBase }));
    return { nodes: layout(base, es), edges: es };
  }, [def, only, bi]);
  return (
    <div className="viewer" style={{ height }}>
      <ReactFlowProvider>
        <ReactFlow
          key={`${def.id}-${only.length}-${nodes.length}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          preventScrolling={false}
          fitView
          fitViewOptions={{ padding: 0.04 }}
          minZoom={0.2}
          maxZoom={1.2}
          colorMode={theme}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="var(--grid)" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
