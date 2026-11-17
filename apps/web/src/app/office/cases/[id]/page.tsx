"use client";

import type { CaseView, DocumentRef } from "@digieurope/shared";
import { AlertCircle, ArrowLeft, ArrowRight, Building2, Calendar, CheckCircle2, Circle, FileText, Globe, MapPin, Send, Users, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { EstimateCard, FindingList, FlowPanel, ReviewPanel, Timeline, useDocName } from "@/components/CaseParts";
import { Spinner, StatusPill, useAsyncError } from "@/components/ui";
import { api, documentUrl, type CaseSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Mode = "approve" | "request" | "reject" | null;

export default function OfficeCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // A fresh component per case, so "Next case" never carries over the selection or the amount.
  return <OfficeCase key={id} id={id} />;
}

function OfficeCase({ id }: { id: string }) {
  const { t, tk, eur, date, dateTime, country } = useI18n();
  const router = useRouter();
  const [c, setC] = useState<CaseView | null>(null);
  const [queue, setQueue] = useState<CaseSummary[]>([]);
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
  const prefill = () => setMessage(blockers.map((f) => `• ${f.fix[c.language]}`).join("\n"));
  const fieldLabel = (k: string) => (tk(`field.${k}`).startsWith("field.") ? k.replace(/_/g, " ") : tk(`field.${k}`));
  const statusText = decided ? t("cd.decided") : c.status === "info_requested" ? t("cd.waiting") : blockers.length ? t("cd.blocked", { n: blockers.length }) : t("cd.ready");

  return (
    <div>
      <div className="cd-head">
        <div>
          <Link href="/office" className="small" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ArrowLeft size={14} />{t("office.inbox.title")}</Link>
          <div className="row" style={{ marginTop: "0.6rem", gap: "0.5rem" }}>
            <span className="small muted num">{c.reference}</span>
            <span className="badge muted">{c.source === "portal" ? t("wl.portal") : t("wl.direct")}</span>
            <StatusPill status={c.status} />
          </div>
          <h1>{c.student.firstName} {c.student.lastName}</h1>
          <div className="small muted">{c.student.university} · {c.student.course} · {date(c.student.birthDate)}</div>
          <div className="cd-facts">
            <span><Globe size={13} />{tk(`stay.${c.stay.type}`)}</span>
            <span><MapPin size={13} />{c.stay.city}, {country(c.stay.country)}</span>
            <span><Building2 size={13} />{c.stay.institution}</span>
            <span><Calendar size={13} />{date(c.stay.startDate)} – {date(c.stay.endDate)}</span>
            {c.assignedTeam && <span><Users size={13} />{c.assignedTeam}</span>}
          </div>
        </div>
      </div>

      <div className="cd-grid">
        <div className="stack" style={{ gap: "1.25rem" }}>
          <ReviewPanel c={c} onConfirm={async (docId, fields) => { const r = await run(() => api.reviewFields(id, docId, fields)); if (r) { setC(r); setAmount(r.estimate.monthly); } }} />

          <section className="panel">
            <div className="panel-head"><h2>{t("cd.openItems")} · {c.report.findings.length}</h2></div>
            <div style={{ padding: "0 1.4rem 1rem" }}>
              {c.report.findings.length === 0 ? <p className="banner banner-ok" style={{ margin: "0.5rem 0 0" }}><CheckCircle2 size={16} style={{ verticalAlign: "-3px" }} /> {t("office.case.noItems")}</p> : <FindingList findings={c.report.findings} showRule />}
            </div>
          </section>

          <section className="panel" style={{ overflow: "hidden" }}>
            <div className="panel-head" style={{ paddingBottom: "0.9rem", borderBottom: "1px solid var(--line)" }}><h2>{t("cd.documents")} · {c.documents.length}</h2></div>
            <div className="viewer2">
              <nav className="doc-nav" aria-label={t("cd.selectDoc")}>
                {docRows.map((r) => (
                  <button key={r.key} type="button" aria-current={r.key === docKey} onClick={() => setDocKey(r.key)}>
                    {!r.doc ? <Circle size={15} color={r.required ? "var(--bad)" : "var(--line-strong)"} /> : c.report.findings.some((f) => f.documentKind === r.kind && f.severity === "blocker") ? <AlertCircle size={15} color="var(--bad)" /> : r.doc.extraction.needsReview || !r.doc.extraction.readable ? <AlertCircle size={15} color="var(--warn)" /> : <CheckCircle2 size={15} color="var(--ok)" />}
                    <span>{docName(r.kind)}</span>
                  </button>
                ))}
              </nav>
              {!sel?.doc ? (
                <div className="preview-empty"><FileText size={28} /><p>{sel ? t("cd.notUploaded") : t("cd.selectDoc")}</p></div>
              ) : (
                <div className="doc-body">
                  <div className="doc-frame"><iframe title={sel.doc.filename} src={`${documentUrl(sel.doc.id)}#toolbar=0&view=FitH`} /></div>
                  <div className="fields">
                    <div className="small muted" style={{ marginBottom: "0.4rem" }}>{sel.doc.filename} · {t("cd.readWith", { engine: tk(`read.engine.${sel.doc.extraction.engine ?? "builtin"}`) })}</div>
                    <h3 style={{ fontSize: "0.85rem", margin: "0.6rem 0 0.2rem" }}>{t("cd.fields")}</h3>
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
                        <h3 style={{ fontSize: "0.85rem", margin: "0.9rem 0 0.2rem" }}>{t("cd.signatures")}</h3>
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

          <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <section className="panel"><div className="panel-head"><h2>{t("cd.process")}</h2></div><div style={{ padding: "0.5rem 1.4rem 1.2rem" }}><FlowPanel c={c} /></div></section>
            <section className="panel"><div className="panel-head"><h2>{t("case.timeline")}</h2></div><div style={{ padding: "0.5rem 1.4rem 1.2rem" }}><Timeline c={c} /></div></section>
          </div>
        </div>

        <aside className="side-stack">
          <EstimateCard c={c} compact />
          {c.decision && (
            <div className={`banner ${c.decision.outcome === "approved" ? "banner-ok" : "banner-bad"}`}>
              <strong>{c.decision.outcome === "approved" ? `${t("status.approved")}: ${eur(c.decision.monthlyAmount)}` : t("status.rejected")}</strong>
              {c.decision.note && <p style={{ margin: "0.3rem 0 0" }}>{c.decision.note}</p>}
              <p className="small muted" style={{ margin: "0.3rem 0 0" }}>{t("office.case.decided", { by: c.decision.decidedBy, date: dateTime(c.decision.decidedAt) })}</p>
            </div>
          )}
          {c.parentLink && <div className="card small"><strong>{t("office.case.parentLink")}</strong><div className="muted" style={{ overflowWrap: "anywhere", marginTop: 4 }}>{c.parentLink}</div></div>}
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
              <p className="small muted" style={{ margin: 0 }}>{t("office.case.principle")}</p>
              <button className="button" type="button" disabled={amount === ""} onClick={() => void act("approve")}><CheckCircle2 size={16} />{t("office.case.approve")}</button>
            </div>
          )}
          {mode === "request" && (
            <div className="stack" style={{ gap: "0.7rem" }}>
              <label className="field">{t("office.case.requestHint")}<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} /></label>
              <div className="row">
                <button className="button button-ghost button-small" type="button" onClick={prefill} disabled={blockers.length === 0}>{t("office.case.prefill")}</button>
                <button className="button" type="button" disabled={!message.trim()} onClick={() => void act("request_info")}><Send size={15} />{t("office.case.sendRequest")}</button>
              </div>
            </div>
          )}
          {mode === "reject" && (
            <div className="stack" style={{ gap: "0.7rem" }}>
              <label className="field">{t("office.case.reason")}<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} /></label>
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
            <button className="button button-ghost button-small" type="button" onClick={() => { setMode(mode === "request" ? null : "request"); setError(null); if (!message && blockers.length) prefill(); }}><Send size={14} />{t("office.case.request")}</button>
            <button className="button button-ghost button-small" type="button" disabled={awaitingReview} onClick={() => { setMode(mode === "reject" ? null : "reject"); setError(null); }}><XCircle size={14} />{t("office.case.reject")}</button>
            <button className="button button-small" type="button" disabled={blockers.length > 0 || awaitingReview} onClick={() => { setMode(mode === "approve" ? null : "approve"); setError(null); }}><CheckCircle2 size={14} />{t("cd.approveAmount", { amount: eur(typeof amount === "number" ? amount : c.estimate.monthly) })}</button>
          </>
        )}
        {nextCase && <button className="button button-ghost button-small" type="button" onClick={() => router.push(`/office/cases/${nextCase.id}`)}>{t("cd.next")} <ArrowRight size={14} /></button>}
      </div>
    </div>
  );
}
