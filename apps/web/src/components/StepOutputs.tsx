"use client";

import { GLOBAL_PLACEHOLDERS, STEP_OUTPUTS, upstreamOutputs, type NodeKind } from "@digieurope/shared";
import { useI18n } from "@/lib/i18n";

/** What a step hands on to the steps after it. */
export function ProvidesList({ kind }: { kind: NodeKind }) {
  const { t, bi } = useI18n();
  const outs = STEP_OUTPUTS[kind];
  if (outs.length === 0) return null;
  return (
    <div className="outs">
      <strong className="outs-h">{t("builder.provides")}</strong>
      <ul>
        {outs.map((o) => (
          <li key={o.name}>
            <code>{`{${o.name}}`}</code>
            <span>{bi(o.label)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What can be put into this step's texts: the basics, and what the steps before it produced. Click to insert at the cursor. */
export function InsertChips({ nodes, edges, nodeId, onInsert }: { nodes: { id: string; kind: NodeKind }[]; edges: { source: string; target: string }[]; nodeId: string; onInsert: (token: string) => void }) {
  const { t, bi } = useI18n();
  const upstream = upstreamOutputs({ nodes, edges }, nodeId);
  const chip = (name: string, label: string, example: string) => (
    <button key={name} type="button" className="chip-insert" title={`${label} · ${example}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(`{${name}}`)}>
      {`{${name}}`}
    </button>
  );
  return (
    <div className="inserts">
      <strong className="outs-h">{t("builder.insertFrom")}</strong>
      <div className="inserts-row">{GLOBAL_PLACEHOLDERS.map((g) => chip(g.name, bi(g.label), g.example))}</div>
      {upstream.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>{t("builder.noUpstream")}</p>
      ) : (
        <div className="inserts-row">{upstream.map((u) => chip(u.output.name, bi(u.output.label), u.output.example))}</div>
      )}
    </div>
  );
}
