"use client";

import { BaseEdge, Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import type { Bilingual } from "@digieurope/shared";
import type { ContextSchema as Schema, SchemaCard } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

/** Fixed places, by area: federal level on the left, organisation on top, process design in the middle, documents and data on the right. */
const POS: Record<string, { x: number; y: number }> = {
  peer: { x: 0, y: 0 }, office: { x: 320, y: 0 }, person: { x: 660, y: 0 }, role: { x: 1000, y: -40 }, proposal: { x: 1340, y: 60 },
  catalog: { x: 0, y: 290 }, process: { x: 320, y: 290 }, template: { x: 660, y: 290 }, rule: { x: 1000, y: 290 }, source: { x: 1340, y: 330 },
  reference: { x: 0, y: 580 }, step: { x: 320, y: 580 }, data: { x: 660, y: 600 }, field: { x: 1000, y: 600 },
  message: { x: 0, y: 880 }, team: { x: 320, y: 900 }, action: { x: 660, y: 900 }, connector: { x: 1000, y: 880 },
};
const W = 230;
const height = (n: number) => 40 + n * 24;
const MARK: Record<SchemaCard, string> = { "1": "cf-1", "0..1": "cf-01", "0..*": "cf-0n", "1..*": "cf-1n" };

type BoxData = { label: string; description: string; group: string; count: number; attributes: { name: string; type: string; description: string }[]; open: boolean; fieldsLabel: string; onOpen: () => void; onToggle: () => void };

const Box = memo(function Box({ data }: NodeProps<Node<BoxData>>) {
  const sides = [Position.Top, Position.Right, Position.Bottom, Position.Left];
  const id = (p: Position) => p[0]!;
  return (
    <div className={`sch-box g-${data.group}`} style={{ width: W }}>
      {sides.map((p) => <Handle key={`s${p}`} id={`s-${id(p)}`} type="source" position={p} className="sch-handle" />)}
      {sides.map((p) => <Handle key={`t${p}`} id={`t-${id(p)}`} type="target" position={p} className="sch-handle" />)}
      <div className="sch-head">
        <button type="button" className="sch-fold nodrag" onClick={data.onToggle} aria-expanded={data.open} aria-label={data.fieldsLabel} title={data.fieldsLabel}>
          {data.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button type="button" className="sch-name nodrag" onClick={data.onOpen} title={data.description || data.label}>{data.label}</button>
        <span className="sch-count num">{data.count}</span>
      </div>
      {data.open && (
        <>
          {data.description && <p className="sch-desc">{data.description}</p>}
          <ul>
            {data.attributes.map((a) => (
              <li key={a.name} title={a.description}><em>{a.name}</em><span>{a.type}</span></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
});

/** A relation from a type to itself: a loop on a side of the box where no other line starts. */
const LOOP_SIDE: Partial<Record<string, "t" | "r" | "b" | "l">> = { person: "t", step: "l", catalog: "l" };

function LoopEdge({ sourceX: x, sourceY: y, sourcePosition, label, markerStart, markerEnd, style }: EdgeProps) {
  // Two feet 36px apart on the chosen side, bulging 90px outward; the label sits beyond the loop.
  const out = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[sourcePosition] as [number, number];
  const across: [number, number] = [out[1] === 0 ? 0 : 1, out[0] === 0 ? 0 : 1];
  const f = 18;
  const d = 72;
  const a = [x - across[0] * f, y - across[1] * f];
  const b2 = [x + across[0] * f, y + across[1] * f];
  const c1 = [a[0]! + out[0] * d - across[0] * 30, a[1]! + out[1] * d - across[1] * 30];
  const c2 = [b2[0]! + out[0] * d + across[0] * 30, b2[1]! + out[1] * d + across[1] * 30];
  const path = `M ${a[0]} ${a[1]} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${b2[0]} ${b2[1]}`;
  return <BaseEdge path={path} label={label} labelX={x + out[0] * 66} labelY={y + out[1] * 66} markerStart={markerStart} markerEnd={markerEnd} style={style} labelBgPadding={[4, 2]} labelBgBorderRadius={4} />;
}

function StepEdge(props: EdgeProps) {
  const [path, lx, ly] = getSmoothStepPath({ ...props, borderRadius: 10, offset: 18 });
  return <BaseEdge path={path} label={props.label} labelX={lx} labelY={ly} markerStart={props.markerStart} markerEnd={props.markerEnd} style={props.style} labelBgPadding={[4, 2]} labelBgBorderRadius={4} />;
}

/** Invisible: makes "fit to view" include the loops, which stick out of their boxes. */
const Pad = () => <div style={{ width: 1, height: 1 }} />;
const nodeTypes = { box: Box, pad: Pad };
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

function Diagram({ schema, onOpen, open, onToggle }: { schema: Schema; onOpen: (type: string) => void; open: Set<string>; onToggle: (type: string) => void }) {
  const { t, bi } = useI18n();
  // Types added to docs/ontology.md that have no place yet go into an extra row at the bottom.
  const place = useMemo(() => {
    const extra = schema.types.filter((x) => !POS[x.type]);
    return (type: string) => POS[type] ?? { x: extra.findIndex((x) => x.type === type) * 340, y: 1180 };
  }, [schema]);
  const box = useMemo(() => new Map(schema.types.map((x) => [x.type, { ...place(x.type), h: height(open.has(x.type) ? x.attributes.length + 1.5 : 0) }])), [schema, open, place]);
  const nodes: Node<BoxData>[] = useMemo(
    () =>
      schema.types.map((x) => ({
        id: x.type,
        type: "box",
        position: place(x.type),
        data: { label: bi(x.label), description: x.description, group: x.group, count: x.count, attributes: x.attributes, open: open.has(x.type), fieldsLabel: t("sch.fields"), onOpen: () => onOpen(x.type), onToggle: () => onToggle(x.type) },
      })),
    [schema, bi, onOpen, open, onToggle, t, place],
  );
  const pads: Node[] = useMemo(
    () =>
      schema.types.filter((x) => schema.relations.some((r) => !r.shortcut && r.from === x.type && r.to === x.type)).map((x) => {
        const side = LOOP_SIDE[x.type] ?? "r";
        const p = place(x.type);
        const at = side === "t" ? { x: p.x + W / 2, y: p.y - 100 } : side === "b" ? { x: p.x + W / 2, y: p.y + 140 } : side === "l" ? { x: p.x - 110, y: p.y + 20 } : { x: p.x + W + 110, y: p.y + 20 };
        return { id: `pad-${x.type}`, type: "pad", position: at, data: {}, selectable: false, draggable: false, focusable: false };
      }),
    [schema, place],
  );
  const edges: Edge[] = useMemo(() => {
    // One line per pair of types; several relations between the same pair share it.
    const pairs = new Map<string, { from: string; to: string; kinds: Bilingual[]; fromCard: SchemaCard; toCard: SchemaCard; empty: boolean }>();
    for (const r of schema.relations.filter((x) => !x.shortcut)) {
      const k = `${r.from}>${r.to}`;
      const p = pairs.get(k);
      if (p) {
        p.kinds.push(r.label);
        p.empty = p.empty && r.count === 0;
      } else pairs.set(k, { from: r.from, to: r.to, kinds: [r.label], fromCard: r.fromCard, toCard: r.toCard, empty: r.count === 0 });
    }
    return [...pairs.values()].map((p) => {
      const self = p.from === p.to;
      const loop = LOOP_SIDE[p.from] ?? "r";
      const [sh, th] = self ? [`s-${loop}`, `t-${loop}`] : sides(box.get(p.from)!, box.get(p.to)!);
      return {
        id: `${p.from}>${p.to}`,
        source: p.from,
        target: p.to,
        sourceHandle: sh,
        targetHandle: th,
        type: self ? "loop" : "step",
        label: p.kinds.map(bi).join(" · "),
        markerStart: MARK[p.fromCard],
        markerEnd: MARK[p.toCard],
        className: `sch-edge${p.empty ? " empty" : ""}`,
      };
    });
  }, [schema, box, bi]);
  return (
    <ReactFlow nodes={[...nodes, ...pads] as Node[]} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesConnectable={false} fitView fitViewOptions={{ padding: 0.06 }} minZoom={0.2} proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} gap={22} className="ctx-bg" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function ContextSchemaView({ schema, onOpen }: { schema: Schema; onOpen: (type: string) => void }) {
  const { t } = useI18n();
  // Fields are folded away by default; each box opens on its own, or all at once.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const all = open.size === schema.types.length;
  const toggle = useCallback((type: string) => setOpen((o) => { const n = new Set(o); if (n.has(type)) n.delete(type); else n.add(type); return n; }), []);
  const groups = ["organisation", "process", "rules", "documents", "systems", "federal"] as const;
  return (
    <>
      <Markers />
      {schema.source.error && (
        <div className="sch-error" role="alert">
          <strong>{t("sch.error", { file: schema.source.file })}</strong>
          <ul>{schema.source.error.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div className="ctx-flow">
        <ReactFlowProvider>
          <Diagram schema={schema} onOpen={onOpen} open={open} onToggle={toggle} />
        </ReactFlowProvider>
      </div>
      <div className="ctx-legend sch-legend">
        <button type="button" className="ctx-chip sch-all" aria-pressed={all} onClick={() => setOpen(all ? new Set() : new Set(schema.types.map((x) => x.type)))}>
          {all ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{all ? t("sch.hideFields") : t("sch.showFields")}
        </button>
        <span className="sch-sep" aria-hidden />
        {groups.map((g) => <span key={g} className={`sch-key g-${g}`}><i aria-hidden />{t(`sch.group.${g}` as MessageKey)}</span>)}
        <span className="sch-sep" aria-hidden />
        {(["1", "0..1", "0..*", "1..*"] as SchemaCard[]).map((c) => (
          <span key={c} className="sch-key cardinality">
            <svg width="34" height="14" aria-hidden><line x1="0" y1="7" x2="34" y2="7" markerEnd={`url(#${MARK[c]})`} /></svg>
            {t(`sch.card.${c}` as MessageKey)}
          </span>
        ))}
        <span className="muted small sch-note">{t("sch.note")} {t("sch.source", { file: schema.source.file })}</span>
      </div>
    </>
  );
}
