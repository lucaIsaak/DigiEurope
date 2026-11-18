"use client";

import type { CaseView, DocumentRef } from "@digieurope/shared";
import { ArrowLeft, ArrowRight, CheckCircle2, Send, UserCheck, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { DecisionExplain } from "@/components/DecisionExplain";
import { EstimateCard, FindingList, FlowPanel, ReviewPanel, Timeline, useDocName } from "@/components/CaseParts";
import { Spinner, StatusDot, useAsyncError } from "@/components/ui";
import { api, documentUrl, type CaseSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";

type Mode = "approve" | "request" | "reject" | null;

export default function OfficeCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // A fresh component per case, so "Next case" never carries over the selection or the amount.
  return <OfficeCase key={id} id={id} />;
}

function OfficeCase({ id }: { id: string }) {
  const { t, tk, eur, date, country } = useI18n();
  const router = useRouter();
  const [c, setC] = useState<CaseView | null>(null);
  const [queue, setQueue] = useState<CaseSummary[]>([]);
  const { staff } = useStaff();
  const [caseworkers, setCaseworkers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api.assignment().then((a) => setCaseworkers(a.caseworkers)).catch(() => undefined);
  }, []);
  const [docKey, setDocKey] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const { error, setError, run } = useAsyncError();

  const load = useCallback(async () => {
    const [v, q] = await Promise.all([api.officeCase(id), api.queue()]);
    setC(v);
    setQueue(q);
    setAmount((a) => (a === "" ? v.estimate.monthly : a));
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const docName = useDocName(c ?? ({ report: { requirements: [] } } as unknown as CaseView));

  // Every document the case needs or has, for the document viewer on the left.
  const docRows = useMemo(() => {
    if (!c) return [];
    const reqs = (c.report.requirements ?? []).filter((r) => r.type === "document" && r.applies);
    const rows: { key: string; kind: string; doc?: DocumentRef; required: boolean }[] = reqs.map((r) => {
      const ds = c.documents.filter((d) => d.kind === r.ref);
      return { key: r.ref, kind: r.ref, doc: ds[ds.length - 1], required: r.required };
    });
    for (const d of c.documents) if (!rows.some((r) => r.doc?.id === d.id) && !reqs.some((r) => r.ref === d.kind)) rows.push({ key: d.id, kind: d.kind, doc: d, required: false });
    return rows;
  }, [c]);
  useEffect(() => {
    if (!docKey && docRows.length) setDocKey((docRows.find((r) => r.doc?.extraction.needsReview) ?? docRows.find((r) => r.doc) ?? docRows[0]!).key);
  }, [docRows, docKey]);

  if (!c) return <Spinner label={t("common.loading")} />;

  const decided = c.status === "approved" || c.status === "rejected";
  const blockers = c.report.findings.filter((f) => f.severity === "blocker");
  const awaitingReview = c.documents.some((d) => d.extraction.needsReview);
  const sel = docRows.find((r) => r.key === docKey);
  const needs = queue.filter((r) => r.status === "submitted" || r.status === "in_review").sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
  const nextCase = needs.find((r) => r.id !== id && (r.submittedAt ?? "") >= (c.submittedAt ?? "")) ?? needs.find((r) => r.id !== id);

  const act = async (action: "request_info" | "approve" | "reject") => {
    const res = await run(() => api.act(id, action, { message, amount: typeof amount === "number" ? amount : undefined }));
    if (res) {
      setC(res);
      setMode(null);
      setMessage("");
    }
  };
  const draft = async (outcome: "approved" | "rejected") => {
    const r = await run(() => api.explanation(id, outcome, outcome === "approved" && typeof amount === "number" ? amount : 0, c.language));
    if (r) setMessage(r.text);
  };
  const prefill = async () => {
    const r = await run(() => api.questionDraft(id));
    if (r) setMessage(r.message);
  };
  const fieldLabel = (k: string) => (tk(`field.${k}`).startsWith("field.") ? k.replace(/_/g, " ") : tk(`field.${k}`));
  const statusText = decided ? t("cd.decided") : c.status === "info_requested" ? t("cd.waiting") : blockers.length ? t("cd.blocked", { n: blockers.length }) : t("cd.ready");

  const openItems = c.report.findings.length;
  return (
    <div className="cp">
      <header className="cp-head">
        <Link href="/office" className="cp-back"><ArrowLeft size={14} />{t("office.inbox.title")}</Link>
        <div className="cp-title">
          <h1>{c.student.firstName} {c.student.lastName}</h1>
          <StatusDot status={c.status} />
        </div>
        <p className="cp-sub num">{c.reference} · {c.source === "portal" ? t("wl.portal") : t("wl.direct")} · {c.student.university} · {c.student.course} · {date(c.student.birthDate)}</p>
        <p className="cp-facts">
          <span>{tk(`stay.${c.stay.type}`)}</span>
          <span>{c.stay.city}, {country(c.stay.country)}</span>
          <span>{c.stay.institution}</span>
          <span className="num">{date(c.stay.startDate)} – {date(c.stay.endDate)}</span>
          {c.assignedTeam && <span>{c.assignedTeam}</span>}
          {c.assignedTo && <span className="cp-assigned"><UserCheck size={13} />{t("cd.assignedTo", { name: c.assignedTo.name })}{c.assignedTo.via === "substitute" ? ` · ${t("cd.via.substitute")}` : c.assignedTo.via === "manual" ? ` · ${t("cd.via.manual")}` : ""}</span>}
          {caseworkers.length > 0 && !decided && (staff?.isAdmin || staff?.isCaseworker) && (
            <label className="cp-reassign"><span className="sr-only">{t("cd.reassign")}</span>
              <select value={c.assignedTo?.id ?? ""} onChange={async (e) => { const r = await run(() => api.assignCase(id, e.target.value)); if (r) setC(r); }}>
                {!c.assignedTo && <option value="">{t("cd.unassigned")}</option>}
                {caseworkers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          )}
        </p>
      </header>

      {c.flow?.failed && (
        <aside className="cp-fail" role="alert">
          <div>
            <strong>{t("cd.stopped")}</strong>
            <p>{c.flow.error?.message}</p>
            <small>{t("cd.stopped.lead")}</small>
          </div>
          {(staff?.isAdmin || staff?.isCaseworker) && (
            <button className="button button-small" type="button" onClick={async () => { const r = await run(() => api.restartCase(id)); if (r) setC(r); }}>{t("cd.restart")}</button>
          )}
        </aside>
      )}
      {c.flow?.waitUntil && c.flow.waiting && !c.flow.failed && (
        <aside className="cp-brief">
          <strong>{t("cd.timer")}</strong>
          <p>{t("cd.timer.until", { d: date(c.flow.waitUntil) })}</p>
        </aside>
      )}
      {c.flow?.briefing && c.flow.waiting && !decided && (
        <aside className="cp-brief" aria-label={t("cd.briefing")}>
          <strong>{t("cd.briefing")}</strong>
          <p>{c.flow.briefing}</p>
        </aside>
      )}

      <div className="cp-grid">
        <div className="cp-main">
          {c.decision && <DecisionExplain c={c} />}
          <ReviewPanel c={c} onConfirm={async (docId, fields) => { const r = await run(() => api.reviewFields(id, docId, fields)); if (r) { setC(r); setAmount(r.estimate.monthly); } }} />

          <section className="cp-sec">
            <h2>{t("cd.openItems")} <span className="n">{openItems}</span></h2>
            {openItems === 0 ? <p className="q-ok"><CheckCircle2 size={14} />{t("office.case.noItems")}</p> : <FindingList findings={c.report.findings} showRule />}
          </section>

          <section className="cp-sec">
            <h2>{t("cd.documents")} <span className="n">{c.documents.length}</span></h2>
            <div className="dv">
              <nav className="dv-tabs" aria-label={t("cd.selectDoc")}>
                {docRows.map((r) => {
                  const tone = !r.doc ? (r.required ? "bad hollow" : "mute hollow") : c.report.findings.some((f) => f.documentKind === r.kind && f.severity === "blocker") ? "bad" : r.doc.extraction.needsReview || !r.doc.extraction.readable ? "warn" : "ok";
                  return (
                    <button key={r.key} type="button" aria-current={r.key === docKey} onClick={() => setDocKey(r.key)}>
                      <i className={`dv-dot ${tone}`} />
                      {docName(r.kind)}
                    </button>
                  );
                })}
              </nav>
              {!sel?.doc ? (
                <div className="q-empty">{sel ? t("cd.notUploaded") : t("cd.selectDoc")}</div>
              ) : (
                <div className="doc-body">
                  <div className="doc-frame"><iframe title={sel.doc.filename} src={`${documentUrl(sel.doc.id)}#toolbar=0&view=FitH`} /></div>
                  <div className="fields">
                    <div className="small muted" style={{ marginBottom: "0.4rem" }}>{sel.doc.filename} · {t("cd.readWith", { engine: tk(`read.engine.${sel.doc.extraction.engine ?? "builtin"}`) })}</div>
                    <h3>{t("cd.fields")}</h3>
                    {Object.entries(sel.doc.extraction.fields).map(([k, v]) => {
                      const conf = sel.doc!.extraction.confidence?.[k];
                      return (
                        <div className="f" key={k}>
                          <span className="l">{fieldLabel(k)}{sel.doc!.extraction.pages?.[k] ? ` · ${t("read.page", { p: sel.doc!.extraction.pages[k]! })}` : ""}</span>
                          <span className="v">{v || "–"}</span>
                          {conf !== undefined && <span className={`conf${conf < 0.8 ? " low" : ""}`}>{Math.round(conf * 100)} %</span>}
                        </div>
                      );
                    })}
                    {Object.keys(sel.doc.extraction.signatures).length > 0 && (
                      <>
                        <h3 style={{ marginTop: "0.9rem" }}>{t("cd.signatures")}</h3>
                        {Object.entries(sel.doc.extraction.signatures).map(([k, ok]) => (
                          <div className="f" key={k}>
                            <span className="v">{tk(`sig.${k}`).startsWith("sig.") ? k : tk(`sig.${k}`)}</span>
                            <span className={`conf${ok ? "" : " low"}`}>{ok ? "✓" : "✗"}</span>
                          </div>
                        ))}
                      </>
                    )}
                    {sel.doc.extraction.note && <p className="small muted" style={{ marginTop: "0.6rem" }}>{sel.doc.extraction.note}</p>}
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="cp-two">
            <section className="cp-sec"><h2>{t("cd.process")}</h2><FlowPanel c={c} /></section>
            <section className="cp-sec"><h2>{t("case.timeline")}</h2><Timeline c={c} /></section>
          </div>
        </div>

        <aside className="cp-side">
          {!decided && <EstimateCard c={c} compact />}
          {decided && (
            <dl className="q-dl cp-dl">
              <dt>{t("case.estimate.monthly")}</dt>
              <dd className="num"><strong>{eur(c.decision?.monthlyAmount ?? 0)}</strong> {t("common.perMonth")}</dd>
              <dt>{t("xp.m.by")}</dt>
              <dd>{c.decision?.decidedBy}</dd>
            </dl>
          )}
          {c.parentLink && <div className="cp-link"><strong>{t("office.case.parentLink")}</strong><span>{c.parentLink}</span></div>}
        </aside>
      </div>

      {mode && (
        <div className="decision-panel" role="dialog" aria-label={mode}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: "0.6rem" }}>
            <strong>{mode === "approve" ? t("office.case.approve") : mode === "request" ? t("office.case.request") : t("office.case.reject")}</strong>
            <button type="button" className="icon-button" aria-label={t("builder.close")} onClick={() => setMode(null)}><X size={16} /></button>
          </div>
          {mode === "approve" && (
            <div className="stack" style={{ gap: "0.7rem" }}>
              <label className="field">{t("office.case.amount")}<input type="number" min={0} max={5000} value={amount} onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))} /></label>
              <label className="field">{t("xp.explain")}<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} placeholder={t("xp.explainHint")} /></label>
              <button className="button button-ghost button-small" type="button" style={{ justifySelf: "start" }} onClick={() => void draft("approved")}>{t("xp.draft")}</button>
              <p className="small muted" style={{ margin: 0 }}>{t("office.case.principle")}</p>
              <button className="button" type="button" disabled={amount === ""} onClick={() => void act("approve")}><CheckCircle2 size={16} />{t("office.case.approve")}</button>
            </div>
          )}
          {mode === "request" && (
            <div className="stack" style={{ gap: "0.7rem" }}>
              <label className="field">{t("office.case.requestHint")}<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={9} /></label>
              <p className="small muted" style={{ margin: 0 }}>{t("office.case.requestNote")}</p>
              <div className="row">
                <button className="button button-ghost button-small" type="button" onClick={() => void prefill()}>{t("office.case.prefill")}</button>
                <button className="button" type="button" disabled={!message.trim()} onClick={() => void act("request_info")}><Send size={15} />{t("office.case.sendRequest")}</button>
              </div>
            </div>
          )}
          {mode === "reject" && (
            <div className="stack" style={{ gap: "0.7rem" }}>
              <label className="field">{t("office.case.reason")}<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} /></label>
              <button className="button button-ghost button-small" type="button" style={{ justifySelf: "start" }} onClick={() => void draft("rejected")}>{t("xp.draft")}</button>
              <button className="button button-danger" type="button" disabled={!message.trim()} onClick={() => void act("reject")}><XCircle size={16} />{t("office.case.reject")}</button>
            </div>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
        </div>
      )}

      <div className="decision-bar">
        <span className={`badge ${decided ? "muted" : blockers.length || awaitingReview ? "bad" : c.status === "info_requested" ? "warn" : "ok"}`}>{statusText}</span>
        <span className="small muted grow">{awaitingReview ? t("read.review.blocked") : blockers.length && !decided ? t("office.case.blocked") : ""}</span>
        {!decided && c.status !== "draft" && (
          <>
            {c.status === "submitted" && <button className="button button-ghost button-small" type="button" onClick={async () => { const r = await run(() => api.openCase(id)); if (r) setC(r); }}>{t("office.case.open")}</button>}
            <button className="button button-ghost button-small" type="button" onClick={() => { setMode(mode === "request" ? null : "request"); setError(null); setMessage(""); if (mode !== "request") void prefill(); }}><Send size={14} />{t("office.case.request")}</button>
            <button className="button button-ghost button-small" type="button" disabled={awaitingReview} onClick={() => { setMode(mode === "reject" ? null : "reject"); setMessage(""); setError(null); }}><XCircle size={14} />{t("office.case.reject")}</button>
            <button className="button button-small" type="button" disabled={blockers.length > 0 || awaitingReview} onClick={() => { setMode(mode === "approve" ? null : "approve"); setMessage(""); setError(null); }}><CheckCircle2 size={14} />{t("cd.approveAmount", { amount: eur(typeof amount === "number" ? amount : c.estimate.monthly) })}</button>
          </>
        )}
        {nextCase && <button className="button button-ghost button-small" type="button" onClick={() => router.push(`/office/cases/${nextCase.id}`)}>{t("cd.next")} <ArrowRight size={14} /></button>}
      </div>
    </div>
  );
}
