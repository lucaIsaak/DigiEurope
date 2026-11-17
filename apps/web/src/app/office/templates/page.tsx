"use client";

import type { TemplateField, TemplateProposal } from "@digieurope/shared";
import { useCallback, useEffect, useState } from "react";
import { DropZone, Field, Spinner, useAsyncError } from "@/components/ui";
import { api, type MethodInfo, type ProposalBody, type TemplateLibrary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { useStaff } from "@/lib/staff";

const slug = (s: string) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "feld";
const TYPES = ["text", "number", "date", "yesno"] as const;
const EMPTY: ProposalBody = { name: "", formblatt: "", title: "", purpose: "", providedBy: "student", fields: [], signatures: [] };

export default function Templates() {
  const { t, tk, bi, date } = useI18n();
  const { staff } = useStaff();
  const [lib, setLib] = useState<TemplateLibrary | null>(null);
  const [tab, setTab] = useState<"library" | "proposals">("library");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<ProposalBody>(EMPTY);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ id: string; kind: "accept" | "reject" } | null>(null);
  const [method, setMethod] = useState<MethodInfo["id"]>("builtin");
  const [minConf, setMinConf] = useState(0.8);
  const [comment, setComment] = useState("");
  const [methods, setMethods] = useState<MethodInfo[]>([]);
  const [saved, setSaved] = useState(false);
  const { error, setError, run } = useAsyncError();

  const load = useCallback(async () => {
    setLib(await api.templates());
    setMethods((await api.extraction()).methods);
  }, []);
  useEffect(() => {
    load().catch(() => setLib({ templates: [], proposals: [], canApprove: false, canPropose: false }));
  }, [load]);

  // Opened from the process builder with ?new=1.
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new")) {
      setTab("proposals");
      startNew();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lib) return <Spinner label={t("common.loading")} />;
  if (!lib.canApprove && !lib.canPropose) return <p className="banner banner-warn">{t("prop.noAccess")}</p>;

  function startNew() {
    setForm(EMPTY);
    setSuggested(null);
    setSaved(false);
    setError(null);
    setEditing("new");
  }
  function startEdit(p: TemplateProposal) {
    setForm({ name: p.name, formblatt: p.formblatt ?? "", title: p.title, purpose: p.purpose, providedBy: p.providedBy, fields: p.fields, signatures: p.signatures, sampleFilename: p.sampleFilename });
    setSuggested(null);
    setSaved(false);
    setError(null);
    setEditing(p.id);
  }
  async function suggest(files: File[]) {
    setBusy(true);
    const r = await run(() => api.suggestTemplate(files[0]!));
    if (r) {
      setForm((f) => ({ ...f, title: f.title || r.title, name: f.name || r.title.replace(/^Formblatt \d+:\s*/i, "").slice(0, 80), fields: r.fields, signatures: r.signatures, sampleFilename: r.sampleFilename }));
      setSuggested(r.sampleFilename);
    }
    setBusy(false);
  }
  async function save(submit: boolean) {
    const r = await run(() => api.saveProposal({ ...form, submit }, editing && editing !== "new" ? editing : undefined));
    if (r) {
      setEditing(null);
      setTab("proposals");
      await load();
    }
  }
  const setField = (i: number, patch: Partial<TemplateField>) => setForm((f) => ({ ...f, fields: f.fields.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));

  const statusPill = (s: TemplateProposal["status"]) => <span className={`pill ${s === "accepted" ? "pill-ok" : s === "rejected" ? "pill-bad" : s === "submitted" ? "" : "pill-muted"}`}>{t(`prop.status.${s}` as MessageKey)}</span>;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>{t("tpl.title")}</h1>
          <p className="lead" style={{ maxWidth: "78ch" }}>{t("tpl.lead")}</p>
        </div>
        {lib.canPropose && <button className="button" type="button" onClick={() => { setTab("proposals"); startNew(); }}>+ {t("tpl.new")}</button>}
      </div>

      <div className="tabs" role="tablist">
        {(["library", "proposals"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(`tpl.tab.${k}` as MessageKey)}{k === "proposals" ? ` (${lib.proposals.filter((p) => p.status === "submitted").length})` : ""}</button>)}
      </div>

      {tab === "library" && (
        <>
          <p className="small muted" style={{ margin: 0 }}>{t("tpl.exampleNote")}</p>
          <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {lib.templates.map((x) => (
              <section className="card" key={x.id}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <h3 style={{ margin: 0 }}>{bi(x.name)}</h3>
                  <span className={`pill ${x.source === "builtin" ? "pill-muted" : "pill-ok"}`}>{x.source === "builtin" ? t("tpl.builtin") : t("tpl.accepted")}</span>
                </div>
                {x.formblatt && <p className="small muted" style={{ margin: "0.2rem 0" }}>{x.formblatt}</p>}
                <p className="small" style={{ margin: "0.4rem 0" }}>{bi(x.purpose)}</p>
                <p className="small muted" style={{ margin: 0 }}>
                  {t("tpl.providedBy")}: {t(`tpl.by.${x.providedBy}` as MessageKey)} · {t("tpl.fields", { n: x.fields.length })} · {t("tpl.signatures", { n: x.signatures.length })}
                </p>
                <p className="small" style={{ margin: "0.4rem 0 0" }}>
                  {t("tpl.reading")}: <strong>{tk(`cmp.method.${x.extraction.method}`)}</strong> · {t("tpl.reviewBelow", { p: Math.round(x.extraction.minConfidence * 100) })}
                </p>
                <button className="link-button small" type="button" style={{ marginTop: "0.5rem" }} onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? "−" : "+"} {t("tpl.fields", { n: x.fields.length })}</button>
                {open === x.id && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <p className="small muted" style={{ margin: "0 0 0.3rem" }}>{t("tpl.printedTitle")}: <em>{x.title}</em></p>
                    <dl className="facts">
                      {x.fields.map((f) => <div key={f.key} style={{ display: "contents" }}><dt>{f.label}</dt><dd>{t(`prop.type.${f.type}` as MessageKey)}{f.required ? "" : ` · ${t("case.docs.optional")}`}</dd></div>)}
                      {x.signatures.map((s) => <div key={s.key} style={{ display: "contents" }}><dt>{s.label}</dt><dd>✍</dd></div>)}
                    </dl>
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      {tab === "proposals" && (
        <div className="stack">
          {editing && (
            <section className="card stack" aria-labelledby="pf-h">
              <h2 id="pf-h" style={{ margin: 0 }}>{t("prop.form.title")}</h2>
              <p className="muted small" style={{ margin: 0 }}>{t("prop.form.lead")}</p>
              <div>
                <strong style={{ fontSize: "0.92rem" }}>{t("prop.sample")}</strong>
                <DropZone label={t("prop.sample.drop")} multiple={false} accept="application/pdf" busy={busy} busyLabel={t("case.docs.reading")} onFiles={(f) => void suggest(f)} />
                {suggested && <p className="small banner banner-info" style={{ marginTop: "0.5rem", marginBottom: 0 }}>{t("prop.sample.done", { f: suggested })}</p>}
              </div>
              <div className="form-grid">
                <Field label={t("prop.name")}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label={t("prop.formblatt")}><input value={form.formblatt ?? ""} onChange={(e) => setForm({ ...form, formblatt: e.target.value })} placeholder="Formblatt 7" /></Field>
                <Field label={t("tpl.printedTitle")} className="full"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                <Field label={t("prop.purpose")} className="full"><textarea rows={2} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
                <Field label={t("tpl.providedBy")}>
                  <select value={form.providedBy} onChange={(e) => setForm({ ...form, providedBy: e.target.value as ProposalBody["providedBy"] })}>
                    {(["student", "parents", "office", "third_party"] as const).map((k) => <option key={k} value={k}>{t(`tpl.by.${k}` as MessageKey)}</option>)}
                  </select>
                </Field>
              </div>
              <div>
                <strong style={{ fontSize: "0.92rem" }}>{t("prop.fields")}</strong>
                <table className="estimate-table" style={{ marginTop: "0.4rem" }}>
                  <tbody>
                    {form.fields.map((f, i) => (
                      <tr key={i}>
                        <td style={{ width: "50%" }}><input value={f.label} aria-label={t("prop.field.label")} onChange={(e) => setField(i, { label: e.target.value, key: f.key.startsWith("feld") || f.key === slug(f.label) ? slug(e.target.value) : f.key })} /></td>
                        <td><select value={f.type} aria-label={t("prop.field.type")} onChange={(e) => setField(i, { type: e.target.value as TemplateField["type"] })}>{TYPES.map((x) => <option key={x} value={x}>{t(`prop.type.${x}` as MessageKey)}</option>)}</select></td>
                        <td><label className="row small"><input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} />{t("prop.field.required")}</label></td>
                        <td><button type="button" className="icon-button" aria-label={t("inputs.remove")} onClick={() => setForm({ ...form, fields: form.fields.filter((_, k) => k !== i) })}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="link-button small" onClick={() => setForm({ ...form, fields: [...form.fields, { key: `feld_${form.fields.length + 1}`, label: "", type: "text", required: true }] })}>+ {t("prop.field.add")}</button>
              </div>
              <div>
                <strong style={{ fontSize: "0.92rem" }}>{t("prop.signatures")}</strong>
                {form.signatures.map((s, i) => (
                  <div className="row" key={i} style={{ margin: "0.3rem 0" }}>
                    <input style={{ flex: 1 }} value={s.label} onChange={(e) => setForm({ ...form, signatures: form.signatures.map((x, k) => (k === i ? { key: slug(e.target.value) || `sig_${i + 1}`, label: e.target.value } : x)) })} />
                    <button type="button" className="icon-button" aria-label={t("inputs.remove")} onClick={() => setForm({ ...form, signatures: form.signatures.filter((_, k) => k !== i) })}>✕</button>
                  </div>
                ))}
                <button type="button" className="link-button small" onClick={() => setForm({ ...form, signatures: [...form.signatures, { key: `sig_${form.signatures.length + 1}`, label: "Unterschrift " }] })}>+ {t("prop.signature.add")}</button>
              </div>
              {error && <p className="error-text" role="alert">{error}</p>}
              <div className="row">
                <button className="button" type="button" onClick={() => void save(true)}>{t("prop.submit")}</button>
                <button className="button button-ghost" type="button" onClick={() => void save(false)}>{t("prop.saveDraft")}</button>
                <button className="link-button small" type="button" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
              </div>
            </section>
          )}

          {lib.proposals.length === 0 && !editing && <p className="muted">{t("prop.empty")}</p>}
          {lib.proposals.map((p) => (
            <section className="card" key={p.id}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h3 style={{ margin: 0 }}>{p.name} {p.formblatt && <span className="small muted">· {p.formblatt}</span>}</h3>
                  <p className="small muted" style={{ margin: "0.2rem 0" }}>{t("prop.by", { by: p.proposedBy, date: date(p.proposedAt) })} · {t("tpl.fields", { n: p.fields.length })}{p.sampleFilename ? ` · ${p.sampleFilename}` : ""}</p>
                </div>
                {statusPill(p.status)}
              </div>
              <p className="small" style={{ margin: "0.3rem 0" }}>{p.purpose} <span className="muted">· {t("tpl.printedTitle")}: <em>{p.title}</em></span></p>
              {p.decisionNote && <p className="banner banner-warn small">{p.decisionNote}</p>}
              {p.status === "accepted" && <p className="small banner banner-ok" style={{ marginBottom: 0 }}>{t("prop.available")} ({p.decidedBy})</p>}
              <div className="row" style={{ marginTop: "0.5rem" }}>
                {(p.status === "draft" || p.status === "rejected") && p.proposedBy === staff?.name && <button className="button button-small button-ghost" type="button" onClick={() => startEdit(p)}>{t("prop.edit")}</button>}
                {lib.canApprove && p.status === "submitted" && (
                  <>
                    <button className="button button-small" type="button" onClick={() => { setDecision({ id: p.id, kind: "accept" }); setError(null); }}>{t("prop.accept")}</button>
                    <button className="button button-small button-ghost" type="button" onClick={() => { setDecision({ id: p.id, kind: "reject" }); setError(null); }}>{t("prop.reject")}</button>
                  </>
                )}
              </div>
              {decision?.id === p.id && decision.kind === "accept" && (
                <div className="stack" style={{ marginTop: "0.75rem" }}>
                  <p className="small muted" style={{ margin: 0 }}>{t("prop.accept.note")}</p>
                  <div className="row">
                    <label className="field">{t("prop.method")}
                      <select value={method} onChange={(e) => setMethod(e.target.value as MethodInfo["id"])}>{methods.map((m) => <option key={m.id} value={m.id}>{bi(m.name)}</option>)}</select>
                    </label>
                    <label className="field">{t("read.minConfidence")}
                      <select value={minConf} onChange={(e) => setMinConf(Number(e.target.value))}>{[0.6, 0.7, 0.8, 0.9, 0.95].map((v) => <option key={v} value={v}>{Math.round(v * 100)} %</option>)}</select>
                    </label>
                    <button className="button button-small" type="button" onClick={async () => { const r = await run(() => api.acceptProposal(p.id, method, minConf)); if (r) { setDecision(null); await load(); } }}>{t("prop.accept")}</button>
                  </div>
                </div>
              )}
              {decision?.id === p.id && decision.kind === "reject" && (
                <div className="stack" style={{ marginTop: "0.75rem" }}>
                  <label className="field">{t("prop.comment")}<textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
                  <div><button className="button button-small button-danger" type="button" onClick={async () => { const r = await run(() => api.rejectProposal(p.id, comment)); if (r) { setDecision(null); setComment(""); await load(); } }}>{t("prop.reject")}</button></div>
                </div>
              )}
              {decision?.id === p.id && error && <p className="error-text" role="alert">{error}</p>}
            </section>
          ))}
          {saved && <p className="pill pill-ok">{t("prop.saved")}</p>}
        </div>
      )}
    </div>
  );
}
