"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Spinner, StatusPill } from "@/components/ui";
import { api, type CaseSummary, type Insights } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const FILTERS = ["all", "submitted", "in_review", "info_requested", "approved", "rejected"] as const;

export default function Inbox() {
  const { t, tk, eur, dateTime, country } = useI18n();
  const [rows, setRows] = useState<CaseSummary[] | null>(null);
  const [ins, setIns] = useState<Insights | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [q, i] = await Promise.all([api.queue(), api.insights()]);
    setRows(q);
    setIns(i);
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function deliver() {
    setBusy(true);
    const s = await api.deliver();
    setFresh(s.id);
    await load();
    setBusy(false);
  }

  if (!rows || !ins) return <Spinner label={t("common.loading")} />;
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const newest = rows.find((r) => r.id === fresh);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>{t("office.inbox.title")}</h1>
          <p className="lead" style={{ maxWidth: "70ch" }}>{t("office.inbox.lead")}</p>
        </div>
        <button className="button" type="button" onClick={deliver} disabled={busy}>{busy ? <span className="spinner" /> : null}{t("office.inbox.deliver")}</button>
      </div>
      {newest && <p className="banner banner-info" role="status">{t("office.inbox.delivered", { ref: newest.reference })} · <Link href={`/office/cases/${newest.id}`}>{t("common.open")}</Link></p>}

      <div className="grid-4">
        <div className="stat"><strong>{ins.open}</strong><span>{t("office.kpi.open")}</span></div>
        <div className="stat"><strong>{ins.total}</strong><span>{t("office.kpi.total")}</span></div>
        <div className="stat"><strong>{ins.firstTimeComplete} %</strong><span>{t("office.kpi.complete")}</span></div>
        <div className="stat"><strong>{ins.medianDaysToDecision ?? "–"}</strong><span>{t("office.kpi.days")}</span></div>
      </div>

      <div className="row" role="group">
        {FILTERS.map((f) => (
          <button key={f} type="button" className={`chip${filter === f ? " chip-on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)} style={filter === f ? { borderColor: "var(--primary)", color: "var(--primary)", fontWeight: 600 } : undefined}>
            {f === "all" ? t("common.all") : tk(`status.${f}`)}
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t("office.col.ref")}</th><th>{t("office.col.name")}</th><th>{t("office.col.stay")}</th><th>{t("office.col.source")}</th>
              <th>{t("office.col.check")}</th><th>{t("office.col.estimate")}</th><th>{t("office.col.status")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} style={r.id === fresh ? { background: "var(--primary-soft)" } : undefined}>
                <td><Link className="row-link" href={`/office/cases/${r.id}`}>{r.reference}</Link><br /><small className="muted">{dateTime(r.submittedAt ?? r.updatedAt)}</small></td>
                <td>{r.name}</td>
                <td>{country(r.country)} · {tk(`stay.${r.stayType}`)}</td>
                <td><span className="pill pill-muted">{r.source === "portal" ? t("office.source.portal") : t("office.source.web")}</span></td>
                <td>{r.blockers === 0 ? <span className="pill pill-ok">✓ {t("office.check.complete")}</span> : <span className="pill pill-bad">{t("office.check.open", { n: r.blockers })}</span>}</td>
                <td>{eur(r.estimateMonthly)}</td>
                <td><StatusPill status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
