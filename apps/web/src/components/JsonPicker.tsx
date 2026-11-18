"use client";

import { STEP_OUTPUTS, getJsonPath, listPaths, parsePath, parsePicks, pickCode, pickTypeOf, suggestName, type JsonPick } from "@digieurope/shared";
import { Braces, Download, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const MAX_SAMPLE = 60_000;

/** The names an output of this kind of step already has; a picked field cannot use them. */
const RESERVED = STEP_OUTPUTS.http_request.map((o) => o.name);

function PickName({ value, taken, onCommit, label }: { value: string; taken: string[]; onCommit: (next: string) => void; label: string }) {
  const [text, setText] = useState(value);
  return (
    <input
      className="json-name"
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
      onBlur={() => {
        const ok = /^[a-z][a-z0-9_]*$/.test(text) && (text === value || (!taken.includes(text) && !RESERVED.includes(text)));
        if (!ok) setText(value);
        else if (text !== value) onCommit(text);
      }}
    />
  );
}

/**
 * Shows the answer of a system as a list of its fields. Tick the ones you need: each gets a name and the path that
 * reaches it, and becomes a tile for later steps. The path is what the process runs every time, so nobody writes it by hand.
 */
export function JsonPicker({
  value,
  sample,
  request,
  onChange,
  onSample,
  onRename,
}: {
  value: string;
  sample: string;
  request: () => { method: string; url: string; headers: Record<string, string>; body?: string };
  onChange: (picks: string) => void;
  onSample: (text: string) => void;
  onRename: (oldName: string, newName: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState("");
  const picks = useMemo(() => parsePicks(value), [value]);
  const json = useMemo<{ ok: true; value: unknown } | { ok: false }>(() => {
    if (!sample.trim()) return { ok: false };
    try {
      return { ok: true, value: JSON.parse(sample) as unknown };
    } catch {
      return { ok: false };
    }
  }, [sample]);
  const rows = useMemo(() => (json.ok ? listPaths(json.value).slice(0, 250) : []), [json]);
  const write = (next: JsonPick[]) => onChange(JSON.stringify(next));
  const byPath = new Map(picks.map((p) => [p.path, p]));
  const names = picks.map((p) => p.name);

  const fetchSample = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.httpTry(request());
      if (r.error) setNote({ tone: "warn", text: t("json.error", { e: r.error }) });
      else {
        let pretty = r.body ?? "";
        try {
          pretty = JSON.stringify(JSON.parse(pretty), null, 1);
        } catch {
          setNote({ tone: "warn", text: t("json.notJson") });
        }
        if (pretty.length > MAX_SAMPLE) pretty = pretty.slice(0, MAX_SAMPLE);
        onSample(pretty);
        setNote((n) => n ?? { tone: "ok", text: t("json.status", { s: String(r.status) }) });
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = (path: string) => {
    const have = byPath.get(path);
    if (have) return write(picks.filter((p) => p.path !== path));
    const v = json.ok ? getJsonPath(json.value, path) : undefined;
    write([...picks, { name: suggestName(path, [...names, ...RESERVED]), path, type: pickTypeOf(v, path) }]);
  };

  const flip = (p: JsonPick) => {
    const all = p.path.includes("[0]");
    const path = all ? p.path.replace(/\[0\]/g, "[*]") : p.path.replace(/\[\*\]/g, "[0]");
    const v = json.ok ? getJsonPath(json.value, path) : undefined;
    write(picks.map((x) => (x === p ? { ...x, path, type: pickTypeOf(v, path) } : x)));
  };

  return (
    <div className="json-picker">
      <div className="json-head">
        <span className="ico"><Braces size={14} /></span>
        <strong>{t("json.title")}</strong>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t("json.help")}</p>
      <div className="row" style={{ gap: "0.5rem" }}>
        <button type="button" className="button button-small" disabled={busy} onClick={fetchSample}><Download size={14} />{busy ? t("json.fetching") : t("json.fetch")}</button>
        <button type="button" className="button button-ghost button-small" onClick={() => setPasting((v) => !v)}>{t("json.paste")}</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t("json.urlTokens")}</p>
      {note && <p className={`banner ${note.tone === "ok" ? "banner-ok" : "banner-warn"} small`} style={{ margin: 0 }}>{note.text}</p>}
      {pasting && (
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <textarea rows={5} value={draft} placeholder={t("json.pasteHint")} onChange={(e) => setDraft(e.target.value)} />
          <button
            type="button"
            className="button button-small"
            onClick={() => {
              try {
                onSample(JSON.stringify(JSON.parse(draft), null, 1).slice(0, MAX_SAMPLE));
                setPasting(false);
                setNote(null);
              } catch {
                setNote({ tone: "warn", text: t("json.notJson") });
              }
            }}
          >
            {t("json.useSample")}
          </button>
        </div>
      )}

      {!json.ok ? (
        <p className="small muted" style={{ margin: 0 }}>{t("json.noSample")}</p>
      ) : (
        <div className="json-tree" role="group" aria-label={t("json.fields")}>
          {rows.map((r) => {
            const steps = parsePath(r.path);
            const last = steps[steps.length - 1];
            const label = last ? (last.k === "key" ? last.v : last.k === "index" ? `[${last.v}]` : "[*]") : "";
            const pickable = r.kind !== "object";
            const on = byPath.has(r.path);
            return (
              <label key={r.path} className={`json-row${on ? " on" : ""}${pickable ? "" : " group"}`} style={{ paddingLeft: `${0.4 + (steps.length - 1) * 0.9}rem` }}>
                {pickable ? <input type="checkbox" checked={on} onChange={() => toggle(r.path)} aria-label={r.path} /> : <span className="json-dot" />}
                <span className="json-key">{label}</span>
                <span className={`json-val kind-${r.kind}`}>{r.sample}</span>
              </label>
            );
          })}
        </div>
      )}

      <div className="json-picked">
        <strong className="small">{t("json.picked")}</strong>
        {picks.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t("json.none")}</p>}
        {picks.map((p) => (
          <div className="json-pick" key={p.path}>
            <div className="row" style={{ gap: "0.4rem", flexWrap: "nowrap" }}>
              <PickName
                value={p.name}
                taken={names}
                label={t("json.name")}
                onCommit={(next) => {
                  write(picks.map((x) => (x === p ? { ...x, name: next } : x)));
                  onRename(p.name, next);
                }}
              />
              <span className="pill pill-muted">{p.type}</span>
              <button type="button" className="icon-button" aria-label={t("json.remove")} onClick={() => write(picks.filter((x) => x !== p))}><X size={14} /></button>
            </div>
            <code className="json-code" title={t("json.code")}>{pickCode(p)}</code>
            {(p.path.includes("[0]") || p.path.includes("[*]")) && (
              <button type="button" className="link-button small" onClick={() => flip(p)}>{p.path.includes("[*]") ? t("json.first") : t("json.all")}</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
