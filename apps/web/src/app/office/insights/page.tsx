"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { api, type Insights } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function InsightsPage() {
  const { t, bi } = useI18n();
  const [ins, setIns] = useState<Insights | null>(null);
  useEffect(() => void api.insights().then(setIns), []);
  if (!ins) return <Spinner label={t("common.loading")} />;
  const max = Math.max(1, ...ins.missing.map((m) => m.count));
  const weekMax = Math.max(1, ...ins.perWeek.map((w) => w.count));
  const reco = ins.missing.filter((m) => m.share >= 10 && m.recommendation);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>{t("office.insights.title")}</h1>
          <p className="lead" style={{ maxWidth: "70ch" }}>{t("office.insights.lead")}</p>
        </div>
        <span className="pill pill-muted">{t("office.insights.demo")}</span>
      </div>
      <div className="grid-4">
        <div className="stat"><strong>{ins.total}</strong><span>{t("office.kpi.total")}</span></div>
        <div className="stat"><strong>{ins.firstTimeComplete} %</strong><span>{t("office.kpi.complete")}</span></div>
        <div className="stat"><strong>{ins.medianDaysToDecision ?? "–"}</strong><span>{t("office.kpi.days")}</span></div>
        <div className="stat"><strong>{ins.open}</strong><span>{t("office.kpi.open")}</span></div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <section className="card">
          <h2>{t("office.insights.missing")}</h2>
          <div className="bars">
            {ins.missing.map((m) => (
              <div key={m.ruleId}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span>{bi(m.title)}</span>
                  <span className="small muted">{t("office.insights.share", { n: m.count, p: m.share })}</span>
                </div>
                <div className="bar-track"><div className="bar" style={{ width: `${(m.count / max) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>{t("office.insights.volume")}</h2>
          <div className="col-chart" style={{ marginBottom: "1.5rem" }}>
            {ins.perWeek.map((w) => (
              <div key={w.week} style={{ height: `${Math.max(2, (w.count / weekMax) * 100)}%` }} title={`${w.week}: ${w.count}`}><small>{w.week}</small></div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <h2>{t("office.insights.reco")}</h2>
        <p className="muted">{t("office.insights.recoLead")}</p>
        {reco.length === 0 ? <p>{t("office.insights.noReco")}</p> : (
          <div className="stack">
            {reco.map((m) => (
              <div key={m.ruleId} className="banner banner-info">
                <h3>{bi(m.title)} <span className="small muted">({m.share} %)</span></h3>
                <p style={{ marginBottom: 0 }}>→ {bi(m.recommendation!)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
