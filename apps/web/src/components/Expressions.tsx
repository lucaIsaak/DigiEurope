"use client";

import { FN_CATEGORIES, FUNCTIONS, GLOBAL_PLACEHOLDERS, STEP_OUTPUTS, asList, asNumber, buildCall, callOf, fnByName, previewRandom, renderText, type Env, type FnSpec } from "@digieurope/shared";
import { ArrowLeft, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { TokenField, type TokenFieldHandle, type TokenInfo } from "@/components/TokenField";
import { useI18n } from "@/lib/i18n";

/** What a function gives with the example values of the outputs, so a person sees the effect while building it. */
function previewEnv(lang: "de" | "en"): Env {
  return {
    now: new Date(),
    lang,
    random: (kind, shape) => previewRandom(kind, shape),
    ref: (p) => {
      if (!p.step) return GLOBAL_PLACEHOLDERS.find((g) => g.name === p.name)?.example;
      const out = Object.values(STEP_OUTPUTS).flat().find((o) => o.name === p.name);
      if (!out) return undefined;
      if (out.type === "list") {
        const items = asList(out.example);
        return p.format === "count" ? items.length : p.format === "comma" ? items.join(", ") : p.format === "first" ? (items[0] ?? "") : items;
      }
      if (out.type === "number") {
        try {
          return asNumber(out.example);
        } catch {
          return out.example;
        }
      }
      return out.example;
    },
  };
}

export function previewResult(raw: string, lang: "de" | "en"): { ok: true; text: string } | { ok: false; error: string } {
  try {
    return { ok: true, text: renderText(raw, previewEnv(lang)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Cannot be calculated." };
  }
}

/** The functions as tiles, by category. Click one to put it into the field; its slots open for editing. */
export function FunctionTiles({ onInsert }: { onInsert: (raw: string) => void }) {
  const { t, bi } = useI18n();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return FUNCTIONS.filter((f) => !term || f.name.toLowerCase().includes(term) || f.label.de.toLowerCase().includes(term) || f.label.en.toLowerCase().includes(term) || f.help.en.toLowerCase().includes(term));
  }, [q]);
  return (
    <div className="fn-list">
      <label className="ws-search">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("builder.fn.search")} aria-label={t("builder.fn.search")} />
      </label>
      {FN_CATEGORIES.map((c) => {
        const items = list.filter((f) => f.category === c.id);
        if (items.length === 0) return null;
        return (
          <div key={c.id} className="fn-cat">
            <div className="fn-cat-h">{bi(c.label)}</div>
            {items.map((f) => (
              <button key={f.name} type="button" className="fn-tile" onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(buildCall(f.name, f.params.map(() => "")))} title={bi(f.help)}>
                <span className="fn-tile-top"><small>ƒ</small><b>{bi(f.label)}</b><i className="otype">{f.returns === "yesno" ? "yes/no" : f.returns}</i></span>
                <span className="fn-help">{bi(f.help)}</span>
                <code className="fn-ex">{f.example}</code>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** One function with a slot for each of its parameters. A slot takes text, tiles of outputs and other functions. */
export function ExpressionEditor({
  raw, onChange, onClose, depth, resolve, sig, register, onFocusSlot, onEditNested,
}: {
  raw: string;
  onChange: (raw: string) => void;
  onClose: () => void;
  depth: number;
  resolve: (raw: string) => TokenInfo | null;
  sig: string;
  register: (key: string, h: TokenFieldHandle | null) => void;
  onFocusSlot: (key: string) => void;
  onEditNested: (raw: string, apply: (next: string) => void) => void;
}) {
  const { t, bi, lang } = useI18n();
  const call = callOf(raw);
  const spec: FnSpec | undefined = call ? fnByName(call.name) : undefined;
  const result = useMemo(() => previewResult(raw, lang), [raw, lang]);
  if (!call || !spec) {
    return (
      <div className="fn-edit">
        <p className="banner banner-warn small">{t("builder.fn.unknown")}</p>
        <button type="button" className="button button-ghost button-small" onClick={onClose}>{t("builder.fn.close")}</button>
      </div>
    );
  }
  const slots = spec.params.map((_, i) => call.slots[i] ?? "");
  const set = (i: number, v: string) => onChange(buildCall(spec.name, slots.map((s, k) => (k === i ? v : s))));
  return (
    <div className="fn-edit">
      <div className="fn-edit-head">
        {depth > 0 && <button type="button" className="icon-button" aria-label={t("builder.fn.back")} onClick={onClose}><ArrowLeft size={15} /></button>}
        <span className="fn-edit-title"><small>ƒ</small><b>{bi(spec.label)}</b></span>
        {depth === 0 && <button type="button" className="icon-button" aria-label={t("builder.fn.close")} onClick={onClose}><X size={15} /></button>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{bi(spec.help)}</p>
      {spec.params.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t("builder.fn.noSlots")}</p>}
      {spec.params.map((p, i) => (
        <label className="field" key={`${depth}:${spec.name}:${p.name}`}>
          <span>{bi(p.label)}{p.required ? "" : ` (${t("builder.fn.optional")})`}{p.hint ? <em className="fn-hint"> · {p.hint}</em> : null}</span>
          {p.type === "choice" ? (
            <select value={slots[i]} onChange={(e) => set(i, e.target.value)}>
              {p.options?.map((o) => <option key={o.value} value={o.value}>{bi(o.label)}</option>)}
            </select>
          ) : (
            <TokenField
              ref={(h) => register(`expr:${depth}:${i}`, h)}
              value={slots[i]!}
              slot
              resolve={resolve}
              sig={sig}
              label={bi(p.label)}
              onFocus={() => onFocusSlot(`expr:${depth}:${i}`)}
              onEditFn={onEditNested}
              onChange={(v) => set(i, v)}
            />
          )}
        </label>
      ))}
      <div className={`fn-result${result.ok ? "" : " bad"}`}>
        <strong className="small">{t("builder.fn.result")}</strong>
        <pre>{result.ok ? result.text || "–" : result.error}</pre>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t("builder.fn.hint")}</p>
    </div>
  );
}
