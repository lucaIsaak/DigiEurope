"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { api, type Insights } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function InsightsPage() {
  const { t, bi } = useI18n();
  const [ins, setIns] = useState<Insights | null>(null);
  useEffect(() => {
    void api.insights().then(setIns);
  }, []);
  if (!ins) return <Spinner label={t("common.loading")} />;
  const max = Math.max(1, ...ins.missing.map((m) => m.count));
  const weekMax = Math.max(1, ...ins.perWeek.map((w) => w.count));
  const reco = ins.missing.filter((m) => m.share >= 10 && m.recommendation);

  return (
    <div className="ins">
      <header className="ins-head">
        <h1>{t("office.insights.title")}</h1>
        <p>{t("office.insights.lead")}</p>
        <span className="muted small">{t("office.insights.demo")}</span>
      </header>

      <dl className="ins-kpis">
        <div><dd className="num">{ins.total}</dd><dt>{t("office.kpi.total")}</dt></div>
        <div><dd className="num">{ins.firstTimeComplete} %</dd><dt>{t("office.kpi.complete")}</dt></div>
        <div><dd className="num">{ins.medianDaysToDecision ?? "–"}</dd><dt>{t("office.kpi.days")}</dt></div>
        <div><dd className="num">{ins.open}</dd><dt>{t("office.kpi.open")}</dt></div>
      </dl>

      <div className="ins-cols">
        <section className="ins-sec">
          <h2>{t("office.insights.missing")}</h2>
          <table className="ins-table">
            <tbody>
              {ins.missing.map((m) => (
                <tr key={m.ruleId}>
                  <td>{bi(m.title)}</td>
                  <td className="ins-bar" aria-hidden><span style={{ width: `${(m.count / max) * 100}%` }} /></td>
                  <td className="r num">{t("office.insights.share", { n: m.count, p: m.share })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="ins-sec">
          <h2>{t("office.insights.volume")}</h2>
          <div className="col-chart ins-chart">
            {ins.perWeek.map((w) => (
              <div key={w.week} style={{ height: `${Math.max(2, (w.count / weekMax) * 100)}%` }} title={`${w.week}: ${w.count}`}><small>{w.week}</small></div>
            ))}
          </div>
        </section>
      </div>

      <section className="ins-sec">
        <h2>{t("office.insights.reco")}</h2>
        <p className="muted">{t("office.insights.recoLead")}</p>
        {reco.length === 0 ? <p>{t("office.insights.noReco")}</p> : (
          <ul className="ins-reco">
            {reco.map((m) => (
              <li key={m.ruleId}>
                <div className="ins-reco-head"><strong>{bi(m.title)}</strong><span className="muted num">{m.share} %</span></div>
                <p>{bi(m.recommendation!)}</p>
                <div className="ins-links">
                  {m.documentKind && <Link href={`/office/templates?open=${m.documentKind}`}>{t("ins.openTemplate")}</Link>}
                  <Link href="/office/rules">{t("ins.openRule")}</Link>
                  <Link href="/office/builder">{t("ins.editProcess")}</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
