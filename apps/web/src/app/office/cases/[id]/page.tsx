"use client";

import type { CaseView } from "@digieurope/shared";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { DocumentChecklist, EstimateCard, FindingList, Timeline } from "@/components/CaseParts";
import { Spinner, StatusPill, useAsyncError } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function OfficeCase({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, bi, eur, date, dateTime, country, tk } = useI18n();
  const [c, setC] = useState<CaseView | null>(null);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [mode, setMode] = useState<"request" | "approve" | "reject">("approve");
  const { error, setError, run } = useAsyncError();

  const load = useCallback(async () => {
    const v = await api.officeCase(id);
    setC(v);
    setAmount((a) => (a === "" ? v.estimate.monthly : a));
  }, [id]);
  useEffect(() => void load(), [load]);

  if (!c) return <Spinner label={t("common.loading")} />;
  const decided = c.status === "approved" || c.status === "rejected";
  const blockers = c.report.findings.filter((f) => f.severity === "blocker");
  const act = async (action: "request_info" | "approve" | "reject") => {
    const res = await run(() => api.act(id, action, { message, amount: typeof amount === "number" ? amount : undefined }));
    if (res) setC(res);
  };
  const prefill = () => setMessage(blockers.map((f) => `• ${f.fix[c.language]}`).join("\n"));

  return (
    <div className="stack">
      <div>
        <p className="small"><Link href="/office">← {t("office.inbox.title")}</Link></p>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 style={{ margin: 0 }}>{t("office.case.title", { ref: c.reference })}</h1>
          <div className="row">
            <span className="pill pill-muted">{c.source === "portal" ? t("office.source.portal") : t("office.source.web")}</span>
            <StatusPill status={c.status} />
          </div>
        </div>
        <p className="muted">{t("office.case.principle")}</p>
      </div>

      <div className="grid-2">
        <div className="stack">
          <section className="card">
            <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <h3>{t("office.case.student")}</h3>
                <p style={{ margin: 0 }}><strong>{c.student.firstName} {c.student.lastName}</strong><br />{date(c.student.birthDate)}<br />{c.student.university}<br />{c.student.course}</p>
              </div>
              <div>
                <h3>{t("office.case.stay")}</h3>
                <p style={{ margin: 0 }}>{tk(`apply.type.${c.stay.type}`)}<br />{c.stay.city}, {country(c.stay.country)}<br />{c.stay.institution}<br />{date(c.stay.startDate)} – {date(c.stay.endDate)}</p>
              </div>
            </div>
          </section>
          <section className="card">
            <h2>{t("office.case.checks")}</h2>
            {c.report.findings.length === 0 ? <p className="banner banner-ok" style={{ marginBottom: 0 }}>✓ {t("office.case.noItems")}</p> : <FindingList findings={c.report.findings} showRule />}
          </section>
          <section className="card">
            <h2>{t("office.case.documents")}</h2>
            <DocumentChecklist c={c} office />
          </section>
          <section className="card">
            <h2>{t("case.timeline")}</h2>
            <Timeline c={c} />
          </section>
        </div>

        <aside className="stack sticky-side">
          <EstimateCard c={c} compact />
          <section className="card">
            <h2>{t("office.case.decide")}</h2>
            {decided && c.decision ? (
              <div className={`banner ${c.decision.outcome === "approved" ? "banner-ok" : "banner-bad"}`}>
                <h3>{c.decision.outcome === "approved" ? t("status.approved") + ": " + eur(c.decision.monthlyAmount) : t("status.rejected")}</h3>
                {c.decision.note && <p>{c.decision.note}</p>}
                <p className="small" style={{ margin: 0 }}>{t("office.case.decided", { by: c.decision.decidedBy, date: dateTime(c.decision.decidedAt) })}</p>
              </div>
            ) : c.status === "draft" ? null : (
              <div className="stack">
                {c.status === "submitted" && <button className="button button-ghost" type="button" onClick={async () => { const r = await run(() => api.openCase(id)); if (r) setC(r); }}>{t("office.case.open")}</button>}
                <div className="row" role="tablist">
                  {(["approve", "request", "reject"] as const).map((m) => (
                    <button key={m} type="button" role="tab" aria-selected={mode === m} className="chip" style={mode === m ? { borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 600 } : undefined} onClick={() => { setMode(m); setError(null); }}>
                      {m === "approve" ? t("office.case.approve") : m === "request" ? t("office.case.request") : t("office.case.reject")}
                    </button>
                  ))}
                </div>
                {mode === "approve" && (
                  <>
                    <label className="field">{t("office.case.amount")}<input type="number" min={0} max={5000} value={amount} onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))} /></label>
                    {blockers.length > 0 && <p className="small banner banner-warn">{t("office.case.blocked")}</p>}
                    <button className="button" type="button" disabled={blockers.length > 0 || amount === ""} onClick={() => act("approve")}>{t("office.case.approve")}</button>
                  </>
                )}
                {mode === "request" && (
                  <>
                    <label className="field">{t("office.case.requestHint")}<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} /></label>
                    <div className="row">
                      <button className="button button-ghost button-small" type="button" onClick={prefill} disabled={blockers.length === 0}>{t("office.case.prefill")}</button>
                      <button className="button" type="button" disabled={!message.trim()} onClick={() => act("request_info")}>{t("office.case.sendRequest")}</button>
                    </div>
                  </>
                )}
                {mode === "reject" && (
                  <>
                    <label className="field">{t("office.case.reason")}<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} /></label>
                    <button className="button button-danger" type="button" disabled={!message.trim()} onClick={() => act("reject")}>{t("office.case.reject")}</button>
                  </>
                )}
                {error && <p className="error-text" role="alert">{error}</p>}
              </div>
            )}
          </section>
          {c.parentLink && (
            <section className="card"><h3>{t("office.case.parentLink")}</h3><p className="small" style={{ overflowWrap: "anywhere", marginBottom: 0 }}>{c.parentLink}</p></section>
          )}
        </aside>
      </div>
    </div>
  );
}
