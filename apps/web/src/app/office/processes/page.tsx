"use client";

import { catalogVariant, catalogVariants, DEFAULT_CATEGORY, type GeneratedProcess } from "@digieurope/shared";
import { AlertTriangle, CheckCircle2, Copy, Download, FolderTree, LayoutGrid, List, MessageSquareText, MoreHorizontal, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";

type Row = Awaited<ReturnType<typeof api.processList>>[number];
type Proposal = GeneratedProcess & { mode: "simulated" | "live"; fellBack?: string };
type Dialog = { kind: "new" } | { kind: "dup"; from: Row } | null;

function CategoryPick({ rows, value, onChange }: { rows: Row[]; value: string; onChange: (v: string) => void }) {
  const { t, bi } = useI18n();
  const free = catalogVariants().filter((v) => !rows.some((r) => r.catalogId === v.id));
  if (free.length === 0) return <p className="banner banner-warn small" style={{ margin: 0 }}>{t("pl.noFree")}</p>;
  return (
    <label className="field">
      <span className="small muted">{t("pl.category")}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("pl.chooseCat")}</option>
        {free.map((v) => <option key={v.id} value={v.id}>{v.path.map((x) => bi(x)).join(" › ")}</option>)}
      </select>
    </label>
  );
}

export default function ProcessesPage() {
  const { t, bi, dateTime } = useI18n();
  const { canBuild } = useStaff();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [view, setView] = useState<"list" | "tiles">("list");
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cat, setCat] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"simulated" | "live">("simulated");
  const [info, setInfo] = useState<{ live: boolean; model: string | null } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [sub, setSub] = useState<null | "blank" | "copy">(null);
  const [src, setSrc] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => api.processList().then(setRows), []);
  useEffect(() => {
    void load();
    try { const v = localStorage.getItem("processView"); if (v === "tiles" || v === "list") setView(v); } catch { /* optional */ }
  }, [load]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  const setViewKeep = (v: "list" | "tiles") => { setView(v); try { localStorage.setItem("processView", v); } catch { /* optional */ } };
  const open = (id: string, tidy = false) => router.push(`/office/builder?category=${encodeURIComponent(id)}${tidy ? "&tidy=1" : ""}`);
  const titleOf = (r: Row) => { const v = catalogVariant(r.catalogId); return { name: r.name, path: v ? v.path.map((x) => bi(x)).join(" › ") : r.catalogId }; };
  const visible = useMemo(() => (rows ?? []).filter((r) => { const x = titleOf(r); return !q.trim() || `${x.name} ${x.path}`.toLowerCase().includes(q.trim().toLowerCase()); }), [rows, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setSub(null); setSrc(""); setDialog(null); setCat(""); setName(""); setError(null); setProposal(null); };
  const attempt = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { return await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; } finally { setBusy(false); }
  };
  const openAi = () => {
    setDialog({ kind: "new" });
    if (!info) api.generateInfo().then(setInfo).catch(() => setInfo({ live: false, model: null }));
  };
  const propose = async () => {
    setProposal(null);
    const r = await attempt(() => api.generateProcess(text, mode));
    if (r) setProposal(r as Proposal);
  };
  const exportJson = async (r: Row) => {
    const p = await api.processes(r.catalogId);
    const def = p.draft ?? p.live;
    if (!def) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(def, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.catalogId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const remove = async (r: Row) => {
    if (!window.confirm(t("pl.deleteAsk", { name: r.name }))) return;
    const done = await attempt(() => api.deleteProcess(r.catalogId));
    if (done) { setToast(t("pl.deleted")); await load(); }
    else if (error) setToast(error);
  };

  if (!canBuild) return <div className="container page"><p className="banner banner-warn">{t("builder.noAccess")}</p></div>;
  if (!rows) return <div className="container page"><Spinner label={t("common.loading")} /></div>;

  const status = (r: Row) => (
    <>
      {r.liveVersion ? <span className="pill pill-ok">{t("builder.live", { v: r.liveVersion })}</span> : <span className="pill pill-muted">{t("builder.notLive")}</span>}
      {r.hasDraft && <span className="pill pill-warn">{t("builder.draft")}</span>}
    </>
  );
  const meta = (r: Row) => (
    <span className="small muted">
      {t("pl.steps", { n: r.steps })}{r.updatedAt ? ` · ${dateTime(r.updatedAt)}` : ""}{r.updatedBy ? ` · ${t("pl.by", { who: r.updatedBy })}` : ""}
    </span>
  );
  const actions = (r: Row) => (
    <div className="pl-menu" ref={menu === r.catalogId ? menuRef : undefined}>
      <button type="button" className="icon-button" aria-label={t("pl.menu", { name: r.name })} aria-haspopup="menu" aria-expanded={menu === r.catalogId} onClick={(e) => { e.stopPropagation(); setMenu(menu === r.catalogId ? null : r.catalogId); }}><MoreHorizontal size={18} /></button>
      {menu === r.catalogId && (
        <div className="pl-pop" role="menu">
          <button type="button" role="menuitem" onClick={() => open(r.catalogId)}><FolderTree size={15} />{t("pl.open")}</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); setDialog({ kind: "dup", from: r }); }}><Copy size={15} />{t("pl.duplicate")}</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); void exportJson(r); }}><Download size={15} />{t("pl.export")}</button>
          <hr />
          <button type="button" role="menuitem" className="danger" disabled={r.catalogId === DEFAULT_CATEGORY} title={r.catalogId === DEFAULT_CATEGORY ? t("pl.deleteNo") : undefined} onClick={() => { setMenu(null); void remove(r); }}><Trash2 size={15} />{t("pl.delete")}</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="pl">
      <header className="pl-head">
        <div>
          <h1>{t("pl.title")}</h1>
          <p className="muted">{t("pl.lead")}</p>
        </div>
        <div className="row" style={{ gap: "0.5rem" }}>
          <button className="button button-ghost" type="button" onClick={openAi}><Plus size={16} />{t("start.new")}</button>
          <button className="button" type="button" onClick={openAi}><Sparkles size={16} />{t("gen.open")}</button>
        </div>
      </header>

      <div className="pl-tools">
        <label className="pl-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pl.search")} aria-label={t("pl.search")} /></label>
        <div className="seg" role="group">
          <button type="button" aria-pressed={view === "list"} onClick={() => setViewKeep("list")}><List size={15} />{t("pl.list")}</button>
          <button type="button" aria-pressed={view === "tiles"} onClick={() => setViewKeep("tiles")}><LayoutGrid size={15} />{t("pl.tiles")}</button>
        </div>
      </div>

      {visible.length === 0 && <p className="muted">{t("pl.none")}</p>}

      {view === "list" ? (
        <div className="pl-list">
          {visible.map((r) => {
            const x = titleOf(r);
            return (
              <div key={r.catalogId} className="pl-row" role="button" tabIndex={0} onClick={() => open(r.catalogId)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(r.catalogId); }}>
                <span className="ico"><FolderTree size={17} /></span>
                <span className="pl-main"><strong>{x.name}</strong><span className="small muted">{x.path}</span></span>
                <span className="pl-state">{status(r)}</span>
                <span className="pl-meta">{meta(r)}</span>
                {actions(r)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="pl-tiles">
          {visible.map((r) => {
            const x = titleOf(r);
            return (
              <div key={r.catalogId} className="pl-tile card" role="button" tabIndex={0} onClick={() => open(r.catalogId)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(r.catalogId); }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <span className="ico"><FolderTree size={18} /></span>
                  {actions(r)}
                </div>
                <strong>{x.name}</strong>
                <span className="small muted">{x.path}</span>
                <div className="row" style={{ gap: "0.35rem" }}>{status(r)}</div>
                {meta(r)}
                <span className="small muted">{r.catalogId === DEFAULT_CATEGORY ? t("pl.running") : t("pl.notRunning")}</span>
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="ws-float" role="status">
          <div className="toast ok"><CheckCircle2 size={16} color="var(--ok)" /><span>{toast}</span><button className="icon-button" type="button" aria-label={t("builder.close")} onClick={() => setToast(null)}><X size={14} /></button></div>
        </div>
      )}

      {dialog && (
        <>
          <div className="drawer-bg" onClick={close} />
          <div className="modal" role="dialog" aria-label={dialog.kind === "dup" ? t("pl.dupTitle", { name: dialog.from.name }) : t("start.title")} style={{ width: "min(640px, calc(100vw - 32px))" }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <div><h2>{dialog.kind === "dup" ? t("pl.dupTitle", { name: dialog.from.name }) : t("start.title")}</h2>{dialog.kind === "new" && <p className="small muted" style={{ margin: "0.2rem 0 0" }}>{t("start.lead")}</p>}</div>
              <button className="icon-button" type="button" aria-label={t("builder.close")} onClick={close}><X size={16} /></button>
            </div>

            {dialog.kind === "new" && !sub && (
              <div className="start-opt primary" style={{ display: "grid", gap: "0.7rem" }}>
                <strong><MessageSquareText size={15} /> {t("start.describe")}</strong>
                <textarea rows={4} value={text} placeholder={t("start.placeholder")} onChange={(e) => { setText(e.target.value); setProposal(null); }} aria-label={t("gen.title")} />
                <button className="link-button small" type="button" style={{ justifySelf: "start" }} onClick={() => { setText(t("gen.example")); setProposal(null); }}>{t("gen.useExample")}</button>
                <fieldset className="gen-mode">
                  <legend className="small">{t("gen.mode")}</legend>
                  <label><input type="radio" name="gen-mode" checked={mode === "simulated"} onChange={() => setMode("simulated")} /> {t("gen.simulated")}</label>
                  <label className={info?.live ? "" : "muted"}><input type="radio" name="gen-mode" disabled={!info?.live} checked={mode === "live"} onChange={() => setMode("live")} /> {t("gen.live")}{info?.model ? ` · ${info.model}` : ""}</label>
                  {info && !info.live && <span className="small muted">{t("gen.liveOff")}</span>}
                </fieldset>
                <div><button className="button" type="button" disabled={busy || text.trim().length < 10} onClick={propose}><MessageSquareText size={15} />{busy && !proposal ? t("gen.running") : t("gen.run")}</button></div>
                {proposal && (
                  <div className="doc-card" role="group">
                    <div className="doc-head"><Sparkles size={14} /><strong>{t("gen.result", { steps: String(proposal.nodes.length), links: String(proposal.edges.length) })}</strong></div>
                    {proposal.fellBack && <p className="small" style={{ margin: 0 }}>{t("gen.fellBack", { e: proposal.fellBack })}</p>}
                    {proposal.understood.length > 0 && <div><strong className="small">{t("gen.understood")}</strong><ul className="gen-list">{proposal.understood.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                    {proposal.unmapped.length > 0 && <div><strong className="small">{t("gen.unmapped")}</strong><ul className="gen-list warn">{proposal.unmapped.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                    {proposal.issues.length > 0 && <div><strong className="small">{t("gen.issues")}</strong><ul className="gen-list warn">{proposal.issues.map((x, i) => <li key={i}>{bi(x.message)}</li>)}</ul></div>}
                    <label className="field"><span className="small muted">{t("pl.name")}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
                    <CategoryPick rows={rows} value={cat} onChange={setCat} />
                    <div><button className="button" type="button" disabled={busy || !cat} onClick={async () => { const r = await attempt(() => api.createProcess(cat, name, { nodes: proposal.nodes, edges: proposal.edges })); if (r) open(cat, true); }}>{t("pl.createFromAi")}</button></div>
                  </div>
                )}
              </div>
            )}
            {dialog.kind === "new" && !sub && !proposal && (
              <div className="start-pair">
                <button type="button" className="start-opt" onClick={() => setSub("blank")}><strong><Plus size={15} /> {t("start.blank")}</strong><span className="small muted">{t("start.blankHint")}</span></button>
                <button type="button" className="start-opt" onClick={() => setSub("copy")}><strong><Copy size={15} /> {t("start.copy")}</strong><span className="small muted">{t("start.copyHint")}</span></button>
              </div>
            )}
            {dialog.kind === "new" && sub === "blank" && (
              <div style={{ display: "grid", gap: "0.8rem" }}>
                <label className="field"><span className="small muted">{t("pl.name")}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
                <CategoryPick rows={rows} value={cat} onChange={setCat} />
                <div className="row" style={{ gap: "0.5rem" }}>
                  <button className="button" type="button" disabled={busy || !cat} onClick={async () => { const r = await attempt(() => api.createProcess(cat, name)); if (r) open(cat); }}>{t("pl.create")}</button>
                  <button className="button button-ghost" type="button" onClick={() => setSub(null)}>{t("pl.back")}</button>
                </div>
              </div>
            )}

            {dialog.kind === "new" && sub === "copy" && (
              <div style={{ display: "grid", gap: "0.8rem" }}>
                <label className="field">
                  <span className="small muted">{t("start.copyFrom")}</span>
                  <select value={src} onChange={(e) => setSrc(e.target.value)}>
                    <option value="">{t("pl.chooseCat")}</option>
                    {rows.map((r) => <option key={r.catalogId} value={r.catalogId}>{r.name}</option>)}
                  </select>
                </label>
                <label className="field"><span className="small muted">{t("pl.name")}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
                <CategoryPick rows={rows} value={cat} onChange={setCat} />
                <div className="row" style={{ gap: "0.5rem" }}>
                  <button className="button" type="button" disabled={busy || !cat || !src} onClick={async () => { const r = await attempt(() => api.duplicateProcess(src, cat, name)); if (r) open(cat); }}>{t("pl.create")}</button>
                  <button className="button button-ghost" type="button" onClick={() => setSub(null)}>{t("pl.back")}</button>
                </div>
              </div>
            )}

            {dialog.kind === "dup" && (
              <div style={{ display: "grid", gap: "0.8rem" }}>
                <label className="field"><span className="small muted">{t("pl.name")}</span><input value={name} placeholder={`${dialog.from.name} (copy)`} onChange={(e) => setName(e.target.value)} /></label>
                <CategoryPick rows={rows} value={cat} onChange={setCat} />
                <div className="row" style={{ gap: "0.5rem" }}>
                  <button className="button" type="button" disabled={busy || !cat} onClick={async () => { const r = await attempt(() => api.duplicateProcess(dialog.from.catalogId, cat, name)); if (r) { close(); setToast(t("pl.copied")); await load(); } }}>{t("pl.duplicate")}</button>
                  <button className="button button-ghost" type="button" onClick={close}>{t("pl.cancel")}</button>
                </div>
              </div>
            )}

            {error && <p className="banner banner-warn small" role="alert" style={{ margin: 0 }}><AlertTriangle size={14} /> {error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
