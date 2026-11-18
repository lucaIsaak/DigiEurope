"use client";

import { GLOBAL_PLACEHOLDERS, NODE_CATALOG, STEP_OUTPUTS, tokensIn, upstreamOutputs, type NodeKind, type StepOutput } from "@digieurope/shared";
import { useCallback, useMemo } from "react";
import { ICONS } from "@/components/FlowKit";
import type { TokenInfo } from "@/components/TokenField";
import { useI18n } from "@/lib/i18n";

const HUES = [212, 152, 28, 282, 340, 176, 48, 242];
/** Every step keeps its colour wherever its outputs are shown. */
export const hueOf = (stepId: string): number => {
  let h = 0;
  for (const c of stepId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
};

/** Short names for the tiles inside a text. */
const SHORT: Record<string, { de: string; en: string }> = {
  caseworker: { de: "Sachbearbeitung", en: "Caseworker" }, team: { de: "Team", en: "Team" },
  documents_read: { de: "Gelesene Dokumente", en: "Documents read" }, unreadable_documents: { de: "Nicht lesbare Dokumente", en: "Unreadable documents" },
  review_list: { de: "Unklare Felder", en: "Unclear fields" }, review_details: { de: "Gründe", en: "Reasons" },
  open_items: { de: "Offene Punkte", en: "Open items" }, missing_documents: { de: "Fehlende Dokumente", en: "Missing documents" }, warnings: { de: "Hinweise", en: "Notes" }, open_count: { de: "Anzahl offen", en: "Open count" },
  condition_result: { de: "Ergebnis", en: "Result" },
  decision: { de: "Entscheidung", en: "Decision" }, decision_note: { de: "Begründung", en: "Explanation" }, decision_amount: { de: "Betrag", en: "Amount" },
  reminder_date: { de: "Datum", en: "Date" },
  draft_subject: { de: "Betreff Entwurf", en: "Draft subject" }, draft_body: { de: "Text Entwurf", en: "Draft text" },
  request_subject: { de: "Betreff Nachfrage", en: "Question subject" }, request_text: { de: "Text Nachfrage", en: "Question text" },
  message_subject: { de: "Betreff Nachricht", en: "Message subject" }, message_body: { de: "Text Nachricht", en: "Message text" },
  connector_id: { de: "Kennung", en: "System ID" }, connector_system: { de: "System", en: "System" }, connector_action: { de: "Aktion", en: "Action" },
  name: { de: "Name", en: "Student name" }, reference: { de: "Aktenzeichen", en: "Reference" }, amount: { de: "Betrag", en: "Amount" },
};
const short = (name: string, lang: "de" | "en") => SHORT[name]?.[lang] ?? name.replace(/_/g, " ");

type Graph = { nodes: { id: string; kind: NodeKind; y?: number; x?: number }[]; edges: { source: string; target: string }[] };

/** Names of the steps as shown on the tiles: "Review fields", or "Review fields #2" when a kind appears twice. */
export function useStepNames(graph: Graph): Map<string, string> {
  const { bi } = useI18n();
  return useMemo(() => {
    const byKind = new Map<NodeKind, Graph["nodes"]>();
    for (const n of graph.nodes) byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n]);
    const out = new Map<string, string>();
    for (const [kind, list] of byKind) {
      const sorted = [...list].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
      sorted.forEach((n, i) => out.set(n.id, `${bi(NODE_CATALOG[kind].title)}${sorted.length > 1 ? ` #${i + 1}` : ""}`));
    }
    return out;
  }, [graph, bi]);
}

/** Turns {stepId.output} (or an older {output}) into what a tile shows. */
export function useTokenResolver(graph: Graph, selId: string) {
  const { bi, lang } = useI18n();
  const names = useStepNames(graph);
  const upstream = useMemo(() => upstreamOutputs(graph, selId), [graph, selId]);
  const resolve = useCallback(
    (raw: string): TokenInfo | null => {
      const tk = tokensIn(raw)[0];
      if (!tk) return null;
      const glob = GLOBAL_PLACEHOLDERS.find((g) => g.name === tk.name);
      if (!tk.step && glob) return { text: short(tk.name, lang), step: "", hue: -1, valid: true, title: bi(glob.label) };
      if (tk.step) {
        const node = graph.nodes.find((n) => n.id === tk.step);
        const out = node ? STEP_OUTPUTS[node.kind].find((o) => o.name === tk.name) : undefined;
        if (!node || !out) return null;
        return { text: short(tk.name, lang), step: names.get(node.id) ?? node.id, hue: hueOf(node.id), valid: upstream.some((u) => u.nodeId === node.id && u.output.name === tk.name), title: `${names.get(node.id)} · ${bi(out.label)}` };
      }
      // An older text with just the name: the nearest step before this one that provides it.
      const known = Object.values(STEP_OUTPUTS).some((l) => l.some((o) => o.name === tk.name));
      if (!known) return null;
      const near = upstream.find((u) => u.output.name === tk.name);
      return near
        ? { text: short(tk.name, lang), step: names.get(near.nodeId) ?? "", hue: hueOf(near.nodeId), valid: true, title: bi(near.output.label) }
        : { text: short(tk.name, lang), step: "?", hue: 0, valid: false, title: tk.name };
    },
    [graph, names, upstream, lang, bi],
  );
  return { resolve, names, upstream, sig: `${[...names.entries()].join("|")}|${upstream.length}|${lang}` };
}

/** What a step hands on, as tiles in the colour of the step. */
export function ProvidesList({ kind, stepId, names }: { kind: NodeKind; stepId: string; names: Map<string, string> }) {
  const { t, bi } = useI18n();
  const outs = STEP_OUTPUTS[kind];
  if (outs.length === 0) return null;
  return (
    <div className="outs" style={{ ["--h" as string]: hueOf(stepId) }}>
      <strong className="outs-h">{t("builder.provides")}</strong>
      <div className="outs-grid">
        {outs.map((o) => (
          <span key={o.name} className="otile" title={`${names.get(stepId) ?? ""} · ${bi(o.label)}`}>
            <b>{bi(o.label)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Tile({ stepName, hue, output, onInsert, token }: { stepName: string; hue: number; output: StepOutput; onInsert: (raw: string) => void; token: string }) {
  const { bi } = useI18n();
  return (
    <button type="button" className="otile pick" style={{ ["--h" as string]: hue }} onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(token)} title={`${stepName} · ${bi(output.label)}`}>
      <b>{bi(output.label)}</b>
      <span className="ex">{output.example}</span>
    </button>
  );
}

/** The outputs of the steps before this one, as coloured tiles, grouped by step. Click a tile to put it into the text you are typing. */
export function OutputTiles({ upstream, names, onInsert }: { upstream: ReturnType<typeof upstreamOutputs>; names: Map<string, string>; onInsert: (raw: string) => void }) {
  const { t, bi, lang } = useI18n();
  const groups: { nodeId: string; kind: NodeKind; items: StepOutput[] }[] = [];
  for (const u of upstream) {
    const g = groups.find((x) => x.nodeId === u.nodeId);
    if (g) g.items.push(u.output);
    else groups.push({ nodeId: u.nodeId, kind: u.kind, items: [u.output] });
  }
  return (
    <div className="tiles">
      <strong className="outs-h">{t("builder.tilesTitle")}</strong>
      <p className="small muted" style={{ margin: 0 }}>{t("builder.tilesHint")}</p>
      <div className="tile-group" style={{ ["--h" as string]: 0 }}>
        <div className="tile-head glob"><span>{t("builder.tilesBasics")}</span></div>
        <div className="tile-row">
          {GLOBAL_PLACEHOLDERS.map((g) => (
            <button key={g.name} type="button" className="otile pick glob" onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(`{${g.name}}`)} title={bi(g.label)}>
              <b>{short(g.name, lang)}</b>
              <span className="ex">{g.example}</span>
            </button>
          ))}
        </div>
      </div>
      {groups.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t("builder.noUpstream")}</p>}
      {groups.map((g) => {
        const Icon = ICONS[g.kind];
        return (
          <div key={g.nodeId} className="tile-group" style={{ ["--h" as string]: hueOf(g.nodeId) }}>
            <div className="tile-head"><Icon size={14} /><span>{names.get(g.nodeId)}</span></div>
            <div className="tile-row">
              {g.items.map((o) => (
                <Tile key={o.name} stepName={names.get(g.nodeId) ?? ""} hue={hueOf(g.nodeId)} output={o} token={`{${g.nodeId}.${o.name}}`} onInsert={onInsert} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
