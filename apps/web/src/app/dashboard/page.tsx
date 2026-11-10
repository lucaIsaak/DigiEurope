"use client";

import type { ApplicationStatus, Metrics } from "@digieurope/shared";
import { useEffect, useMemo, useState } from "react";
import { Alert, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Assumptions {
  counterMinutes: number;
  repeatRate: number;
  noShowRate: number;
  reviewMinutes: number;
  idCheckMinutes: number;
}

// Defaults from the caseworker interview: ~12 min per registration, 1 in 3 needs a second visit, 1 in 10 no-shows.
const DEFAULTS: Assumptions = { counterMinutes: 12, repeatRate: 33, noShowRate: 10, reviewMinutes: 3, idCheckMinutes: 5 };
const COUNTER_FIRST_TIME_BASELINE = 0.67;

const pct = (x: number) => `${Math.round(x * 100)} %`;

export default function Dashboard() {
  const { t, tk, lang } = useI18n();
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState<Assumptions>(DEFAULTS);

  useEffect(() => {
    const load = () => api.metrics().then(setM).catch((e: Error) => setError(e.message));
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  const estimate = useMemo(() => {
    if (!m) return null;
    const baseline = a.counterMinutes * (1 + a.repeatRate / 100 + a.noShowRate / 100);
    const savedEid = m.approvedByMethod.eid * Math.max(0, baseline - a.reviewMinutes);
    const savedPassport = m.approvedByMethod.passport * Math.max(0, baseline - a.reviewMinutes - a.idCheckMinutes);
    return { baseline, hours: (savedEid + savedPassport) / 60 };
  }, [m, a]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!m || !estimate) return <Loading />;

  const nf = new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 1 });
  const statusOrder: ApplicationStatus[] = ["draft", "submitted", "in_review", "info_requested", "id_check", "approved", "rejected"];
  const maxStatus = Math.max(1, ...statusOrder.map((s) => m.totals[s]));
  const langTotal = Object.values(m.languages).reduce((x, y) => x + y, 0) || 1;
  const approvedTotal = m.approvedByMethod.eid + m.approvedByMethod.passport || 1;

  return (
    <>
      <h1>{t("db.title")}</h1>
      <p className="muted">{t("db.lead")}</p>

      <div className="kpis">
        <div className="kpi">
          <div className="label">{t("db.kpi.submitted")}</div>
          <div className="value">{m.submittedLast30Days}</div>
        </div>
        <div className="kpi">
          <div className="label">{t("db.kpi.complete")}</div>
          <div className="value">{pct(m.completeAtFirstSubmission)}</div>
          <div className="sub">{t("db.kpi.complete.delta", { baseline: pct(COUNTER_FIRST_TIME_BASELINE) })}</div>
        </div>
        <div className="kpi">
          <div className="label">{t("db.kpi.days")}</div>
          <div className="value">{m.medianDaysToDecision === null ? "–" : nf.format(m.medianDaysToDecision)}</div>
          <div className="sub">{t("db.kpi.days.sub", { avg: m.averageDaysToDecision === null ? "–" : nf.format(m.averageDaysToDecision) })}</div>
        </div>
        <div className="kpi highlight">
          <div className="label">{t("db.kpi.hours")}</div>
          <div className="value">{nf.format(Math.round(estimate.hours))} h</div>
          <div className="sub">{t("db.kpi.hours.sub", { n: m.approvedByMethod.eid + m.approvedByMethod.passport })}</div>
        </div>
        <div className="kpi">
          <div className="label">{t("db.kpi.landlord")}</div>
          <div className="value">{pct(m.digitalLandlordShare)}</div>
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
        <section className="card">
          <h2>{t("db.weekly.title")}</h2>
          <WeeklyChart weekly={m.weekly} />
        </section>
        <section className="card stack">
          <div>
            <h2>{t("db.status.title")}</h2>
            {statusOrder.map((s) => (
              <div className="hbar" key={s}>
                <span>{tk(`status.${s}`)}</span>
                <span className="track"><span className="fill" style={{ display: "block", width: `${(m.totals[s] / maxStatus) * 100}%` }} /></span>
                <span className="n">{m.totals[s]}</span>
              </div>
            ))}
          </div>
          <div>
            <h3>{t("db.lang.title")}</h3>
            {Object.entries(m.languages).sort((x, y) => y[1] - x[1]).map(([l, n]) => (
              <div className="hbar" key={l}>
                <span>{l.toUpperCase()}</span>
                <span className="track"><span className="fill" style={{ display: "block", width: `${(n / langTotal) * 100}%` }} /></span>
                <span className="n">{pct(n / langTotal)}</span>
              </div>
            ))}
          </div>
          <div>
            <h3>{t("db.method.title")}</h3>
            {(["eid", "passport"] as const).map((k) => (
              <div className="hbar" key={k}>
                <span>{t(`cw.method.${k}`)}</span>
                <span className="track"><span className="fill" style={{ display: "block", width: `${(m.approvedByMethod[k] / approvedTotal) * 100}%` }} /></span>
                <span className="n">{m.approvedByMethod[k]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>{t("db.assumptions.title")}</h2>
        <p className="muted">{t("db.assumptions.lead")}</p>
        <div className="assumptions">
          {(
            [
              ["counterMinutes", "db.a.counterMinutes"],
              ["repeatRate", "db.a.repeatRate"],
              ["noShowRate", "db.a.noShowRate"],
              ["reviewMinutes", "db.a.reviewMinutes"],
              ["idCheckMinutes", "db.a.idCheckMinutes"],
            ] as const
          ).map(([key, label]) => (
            <div className="field" key={key}>
              <label htmlFor={key}>{t(label)}</label>
              <input id={key} type="number" min={0} max={key.endsWith("Rate") ? 100 : 120} value={a[key]}
                onChange={(e) => setA({ ...a, [key]: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 14 }}>
          {t("db.formula", {
            counter: a.counterMinutes, repeat: a.repeatRate, noshow: a.noShowRate,
            baseline: nf.format(estimate.baseline), review: a.reviewMinutes, idcheck: a.idCheckMinutes,
          })}
        </p>
      </section>
    </>
  );
}

/** Grouped columns, two series. Hover a week for exact values; the table view carries the same data. */
function WeeklyChart({ weekly }: { weekly: Metrics["weekly"] }) {
  const { t, date } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 240, padL = 32, padB = 28, padT = 12, padR = 8;
  const max = Math.max(4, ...weekly.flatMap((w) => [w.submitted, w.decided]));
  const step = max <= 8 ? 2 : max <= 20 ? 5 : 10;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const band = (W - padL - padR) / weekly.length;
  const bar = Math.min(20, (band - 14) / 2);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const base = y(0);

  // Column with a 4px rounded data-end and a square baseline.
  const col = (x: number, v: number) => {
    if (v === 0) return "";
    const yt = y(v), r = Math.min(4, base - yt, bar / 2);
    return `M${x},${base} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bar - r} Q${x + bar},${yt} ${x + bar},${yt + r} V${base} Z`;
  };

  const series = [
    { key: "submitted" as const, label: t("db.weekly.submitted"), color: "var(--series-1)" },
    { key: "decided" as const, label: t("db.weekly.decided"), color: "var(--series-2)" },
  ];

  return (
    <div>
      <div className="legend">
        {series.map((s) => (
          <span key={s.key}><span className="key" style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t("db.weekly.title")} onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#e6e8ec" strokeWidth={1} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{v}</text>
            </g>
          ))}
          {weekly.map((w, i) => {
            const x0 = padL + i * band;
            const cx = x0 + band / 2;
            return (
              <g key={w.weekStart} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
                <rect x={x0} y={padT} width={band} height={H - padT - padB} fill={hover === i ? "#f1f4f9" : "transparent"} />
                <path d={col(cx - bar - 1, w.submitted)} fill="var(--series-1)" />
                <path d={col(cx + 1, w.decided)} fill="var(--series-2)" />
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#6b7280">{date(w.weekStart).replace(/\s?\d{4}$/, "")}</text>
              </g>
            );
          })}
          <line x1={padL} x2={W - padR} y1={base} y2={base} stroke="#b9c0cc" strokeWidth={1} />
        </svg>
        {hover !== null && (
          <div className="chart-tooltip" style={{ left: `${((padL + (hover + 0.5) * band) / W) * 100}%`, top: `${(y(Math.max(weekly[hover]!.submitted, weekly[hover]!.decided)) / H) * 100}%` }}>
            <div><strong>{t("db.weekly.week")} {date(weekly[hover]!.weekStart)}</strong></div>
            {series.map((s) => (
              <div key={s.key}><span className="key" style={{ background: s.color }} />{s.label}: {weekly[hover]![s.key]}</div>
            ))}
          </div>
        )}
      </div>
      <details style={{ marginTop: 8 }}>
        <summary className="hint">{t("db.weekly.table")}</summary>
        <table className="data" style={{ marginTop: 8 }}>
          <thead><tr><th>{t("db.weekly.week")}</th><th className="num">{t("db.weekly.submitted")}</th><th className="num">{t("db.weekly.decided")}</th></tr></thead>
          <tbody>
            {weekly.map((w) => (
              <tr key={w.weekStart} style={{ cursor: "default" }}><td>{date(w.weekStart)}</td><td className="num">{w.submitted}</td><td className="num">{w.decided}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
