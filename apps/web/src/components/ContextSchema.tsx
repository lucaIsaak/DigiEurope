"use client";

import { BaseEdge, Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useMemo } from "react";
import type { ContextNodeType, ContextSchema as Schema, SchemaCard } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

/** Fixed places, by area: federal level on the left, organisation on top, process design in the middle, documents and data on the right. */
const POS: Record<ContextNodeType, { x: number; y: number }> = {
  peer: { x: 0, y: 0 }, office: { x: 320, y: 0 }, person: { x: 660, y: 0 }, role: { x: 1000, y: -40 }, proposal: { x: 1340, y: 60 },
  catalog: { x: 0, y: 290 }, process: { x: 320, y: 290 }, template: { x: 660, y: 290 }, rule: { x: 1000, y: 290 }, source: { x: 1340, y: 330 },
  reference: { x: 0, y: 580 }, step: { x: 320, y: 580 }, data: { x: 660, y: 600 }, field: { x: 1000, y: 600 },
  message: { x: 0, y: 880 }, team: { x: 320, y: 900 }, action: { x: 660, y: 900 }, connector: { x: 1000, y: 880 },
};
const W = 230;
const height = (n: number) => 40 + n * 24;
const MARK: Record<SchemaCard, string> = { "1": "cf-1", "0..1": "cf-01", "0..*": "cf-0n", "1..*": "cf-1n" };

type BoxData = { label: string; group: string; count: number; attributes: { name: string; type: string }[]; onOpen: () => void };

const Box = memo(function Box({ data }: NodeProps<Node<BoxData>>) {
  const sides = [Position.Top, Position.Right, Position.Bottom, Position.Left];
  const id = (p: Position) => p[0]!;
  return (
    <div className={`sch-box g-${data.group}`} style={{ width: W }}>
      {sides.map((p) => <Handle key={`s${p}`} id={`s-${id(p)}`} type="source" position={p} className="sch-handle" />)}
      {sides.map((p) => <Handle key={`t${p}`} id={`t-${id(p)}`} type="target" position={p} className="sch-handle" />)}
      <button type="button" className="sch-head" onClick={data.onOpen} title={data.label}>
        <span>{data.label}</span>
        <span className="sch-count num">{data.count}</span>
      </button>
      <ul>
        {data.attributes.map((a) => (
          <li key={a.name}><em>{a.name}</em><span>{a.type}</span></li>
        ))}
      </ul>
    </div>
  );
});

/** A relation from a type to itself: a loop on the right side of the box. */
function LoopEdge({ sourceX, sourceY, label, markerStart, markerEnd, style }: EdgeProps) {
  const x = sourceX;
  const y = sourceY;
  const path = `M ${x} ${y - 16} C ${x + 80} ${y - 70}, ${x + 80} ${y + 54}, ${x} ${y + 16}`;
  return <BaseEdge path={path} label={label} labelX={x + 64} labelY={y} markerStart={markerStart} markerEnd={markerEnd} style={style} labelBgPadding={[4, 2]} labelBgBorderRadius={4} />;
}

function StepEdge(props: EdgeProps) {
  const [path, lx, ly] = getSmoothStepPath({ ...props, borderRadius: 10, offset: 18 });
  return <BaseEdge path={path} label={props.label} labelX={lx} labelY={ly} markerStart={props.markerStart} markerEnd={props.markerEnd} style={props.style} labelBgPadding={[4, 2]} labelBgBorderRadius={4} />;
}

const nodeTypes = { box: Box };
const edgeTypes = { loop: LoopEdge, step: StepEdge };

/** Crow's-foot ends. The node sits at the right end of each marker; "auto-start-reverse" turns the same marker round at the start of a line. */
function Markers() {
  const common = { viewBox: "0 0 22 20", markerWidth: 22, markerHeight: 20, refX: 22, refY: 10, orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" as const };
  const foot = <path d="M8 10 L22 2 M8 10 L22 10 M8 10 L22 18" />;
  return (
    <svg className="sch-markers" aria-hidden>
      <defs>
        <marker id="cf-1" {...common}><path d="M12 3 V17 M16 3 V17" /></marker>
        <marker id="cf-01" {...common}><circle cx="5" cy="10" r="3.5" /><path d="M14 3 V17" /></marker>
        <marker id="cf-0n" {...common}><circle cx="4" cy="10" r="3.5" />{foot}</marker>
        <marker id="cf-1n" {...common}><path d="M4 3 V17" />{foot}</marker>
      </defs>
    </svg>
  );
}

function sides(a: { x: number; y: number; h: number }, b: { x: number; y: number; h: number }) {
  const dx = b.x + W / 2 - (a.x + W / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) > Math.abs(dy) * 1.2) return dx > 0 ? ["s-r", "t-l"] : ["s-l", "t-r"];
  return dy > 0 ? ["s-b", "t-t"] : ["s-t", "t-b"];
}

function Diagram({ schema, onOpen }: { schema: Schema; onOpen: (type: ContextNodeType) => void }) {
  const { t, bi } = useI18n();
  const box = useMemo(() => new Map(schema.types.map((x) => [x.type, { ...POS[x.type], h: height(x.attributes.length) }])), [schema]);
  const nodes: Node<BoxData>[] = useMemo(
    () =>
      schema.types.map((x) => ({
        id: x.type,
        type: "box",
        position: POS[x.type],
        data: { label: bi(x.label), group: x.group, count: x.count, attributes: x.attributes, onOpen: () => onOpen(x.type) },
      })),
    [schema, bi, onOpen],
  );
  const edges: Edge[] = useMemo(() => {
    // One line per pair of types; several relations between the same pair share it.
    const pairs = new Map<string, { from: ContextNodeType; to: ContextNodeType; kinds: string[]; fromCard: SchemaCard; toCard: SchemaCard; empty: boolean }>();
    for (const r of schema.relations.filter((x) => !x.shortcut)) {
      const k = `${r.from}>${r.to}`;
      const p = pairs.get(k);
      if (p) {
        p.kinds.push(r.kind);
        p.empty = p.empty && r.count === 0;
      } else pairs.set(k, { from: r.from, to: r.to, kinds: [r.kind], fromCard: r.fromCard, toCard: r.toCard, empty: r.count === 0 });
    }
    return [...pairs.values()].map((p) => {
      const self = p.from === p.to;
      const [sh, th] = self ? ["s-r", "t-r"] : sides(box.get(p.from)!, box.get(p.to)!);
      return {
        id: `${p.from}>${p.to}`,
        source: p.from,
        target: p.to,
        sourceHandle: sh,
        targetHandle: th,
        type: self ? "loop" : "step",
        label: p.kinds.map((k) => t(`ctx.edge.${k}` as MessageKey)).join(" · "),
        markerStart: MARK[p.fromCard],
        markerEnd: MARK[p.toCard],
        className: `sch-edge${p.empty ? " empty" : ""}`,
      };
    });
  }, [schema, box, t]);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesConnectable={false} fitView fitViewOptions={{ padding: 0.06 }} minZoom={0.2} proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} gap={22} className="ctx-bg" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function ContextSchemaView({ schema, onOpen }: { schema: Schema; onOpen: (type: ContextNodeType) => void }) {
  const { t } = useI18n();
  const groups = ["organisation", "process", "rules", "documents", "systems", "federal"] as const;
  return (
    <>
      <Markers />
      <div className="ctx-flow">
        <ReactFlowProvider>
          <Diagram schema={schema} onOpen={onOpen} />
        </ReactFlowProvider>
      </div>
      <div className="ctx-legend sch-legend">
        {groups.map((g) => <span key={g} className={`sch-key g-${g}`}><i aria-hidden />{t(`sch.group.${g}` as MessageKey)}</span>)}
        <span className="sch-sep" aria-hidden />
        {(["1", "0..1", "0..*", "1..*"] as SchemaCard[]).map((c) => (
          <span key={c} className="sch-key cardinality">
            <svg width="34" height="14" aria-hidden><line x1="0" y1="7" x2="34" y2="7" markerEnd={`url(#${MARK[c]})`} /></svg>
            {t(`sch.card.${c}` as MessageKey)}
          </span>
        ))}
        <span className="muted small sch-note">{t("sch.note")}</span>
      </div>
    </>
  );
}
