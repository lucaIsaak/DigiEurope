"use client";

import { paramsOf } from "@digieurope/shared";
import { Check, Lock, MessageSquareText, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Spinner, useAsyncError } from "@/components/ui";
import { api, type MessageBody, type MessageEntry } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";

const EMPTY: MessageBody = { name: "", purpose: "", subject: { de: "", en: "" }, body: { de: "", en: "" } };

/** Messages to applicants: written, translated and approved once; steps of processes point to them. */
export function MessagesTab() {
  const { t, date } = useI18n();
  const { staff, canBuild } = useStaff();
  const [list, setList] = useState<MessageEntry[] | null>(null);
  const [open, setOpen] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<MessageBody>(EMPTY);
  const { error, setError, run } = useAsyncError();

  const load = useCallback(async () => setList(await api.messages()), []);
  useEffect(() => {
    void load();
  }, [load]);

  const cur = list?.find((m) => m.id === open) ?? null;
  const select = (m: MessageEntry) => {
    const v = (m.draft ?? m.live)!.tpl;
    setForm({ name: v.name, purpose: v.purpose, subject: v.subject, body: v.body });
    setOpen(m.id);
    setError(null);
  };
  if (!list) return <Spinner label={t("common.loading")} />;
  const params = paramsOf({ subject: form.subject, body: form.body });
  const mine = cur?.draft?.author === staff?.name;

  return (
    <>
      <div className="msg-head">
        <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("msg.lead")}</p>
        {canBuild && <button type="button" className="button" onClick={() => { setForm(EMPTY); setOpen("new"); setError(null); }}><Plus size={16} />{t("msg.new")}</button>}
      </div>
      <div className="tl" role="listbox">
        {list.map((m) => (
          <button key={m.id} type="button" role="option" className="tl-row msg-row" aria-selected={open === m.id} onClick={() => select(m)}>
            <span className="tl-ico"><MessageSquareText size={15} /></span>
            <span className="tl-name">{m.name}</span>
            <span className="tl-meta">{m.purpose}</span>
            <span className="tl-n">{m.params.length ? `${m.params.length} ${t("msg.params")}` : "–"}</span>
            <span className="tl-use">{m.usedIn.length === 0 ? t("r.usedIn0") : m.usedIn.length === 1 ? t("r.usedIn1") : t("r.usedIn", { n: m.usedIn.length })}</span>
            <span className={`chip ${m.status === "live" ? "ok" : "warn"}`}>{m.status === "live" ? `${t("r.status.live")} v${m.live!.tpl.version}` : m.status === "draft" ? t("msg.status.draft") : t("r.status.changed")}</span>
          </button>
        ))}
      </div>

      {open && (
        <>
          <div className="drawer-bg" onClick={() => setOpen(null)} />
          <aside className="drawer wide" role="dialog" aria-label={t("msg.title")}>
            <button type="button" className="drawer-x icon-button" aria-label={t("r.close")} onClick={() => setOpen(null)}><X size={18} /></button>
            <div className="drawer-scroll msg-editor">
              <h2>{open === "new" ? t("msg.new") : form.name}</h2>
              {cur && (
                <p className="small muted">
                  {cur.live ? t("msg.liveBy", { v: cur.live.tpl.version, by: cur.live.approvedBy ?? "", d: date(cur.live.approvedAt) }) : t("msg.notLive")}
                  {cur.draft ? ` · ${t("msg.draftBy", { by: cur.draft.author })}` : ""}
                </p>
              )}
              {!canBuild && <p className="reason"><Lock size={13} />{t("msg.noRights")}</p>}
              <fieldset disabled={!canBuild} className="msg-fs">
                <label className="field">{t("msg.name")}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label className="field">{t("msg.purpose")}<input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label>
                <div className="msg-cols">
                  <div>
                    <label className="field">{t("msg.subject")} (DE)<input value={form.subject.de} onChange={(e) => setForm({ ...form, subject: { ...form.subject, de: e.target.value } })} /></label>
                    <label className="field">{t("msg.body")} (DE)<textarea rows={9} value={form.body.de} onChange={(e) => setForm({ ...form, body: { ...form.body, de: e.target.value } })} /></label>
                  </div>
                  <div>
                    <label className="field">{t("msg.subject")} (EN)<input value={form.subject.en} onChange={(e) => setForm({ ...form, subject: { ...form.subject, en: e.target.value } })} /></label>
                    <label className="field">{t("msg.body")} (EN)<textarea rows={9} value={form.body.en} onChange={(e) => setForm({ ...form, body: { ...form.body, en: e.target.value } })} /></label>
                  </div>
                </div>
                <div className="msg-params">
                  <strong className="small">{t("msg.paramsTitle")}</strong>
                  <p className="small muted" style={{ margin: "0.15rem 0 0.4rem" }}>{t("msg.paramsLead")}</p>
                  {params.length === 0 ? <span className="small muted">–</span> : params.map((p) => <code key={p} className="chip-insert">{`{${p}}`}</code>)}
                </div>
              </fieldset>
              {error && <p className="error-text" role="alert">{error}</p>}
              {canBuild && (
                <div className="row" style={{ gap: "0.6rem", flexWrap: "wrap" }}>
                  <button type="button" className="button" onClick={async () => {
                    const r = await run(() => (open === "new" ? api.createMessage(form) : api.saveMessageDraft(open, form)));
                    if (r) { await load(); setOpen(r.id); }
                  }}>{t("msg.saveDraft")}</button>
                  {cur?.draft && (
                    <button type="button" className="button button-ghost" disabled={mine} title={mine ? t("msg.mine") : ""} onClick={async () => {
                      const r = await run(() => api.approveMessage(cur.id));
                      if (r) await load();
                    }}><Check size={15} />{t("msg.approve")}</button>
                  )}
                  {cur?.draft && <button type="button" className="button button-ghost" onClick={async () => { const r = await run(() => api.discardMessage(cur.id)); if (r) { await load(); setOpen(null); } }}>{t("msg.discard")}</button>}
                  {cur?.draft && mine && <span className="reason"><Lock size={13} />{t("msg.mine")}</span>}
                </div>
              )}
              {cur && cur.usedIn.length > 0 && <p className="small muted">{t("msg.usedBy")}: {cur.usedIn.map((u) => u.name).join(", ")}</p>}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
