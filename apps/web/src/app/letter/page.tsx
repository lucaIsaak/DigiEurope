"use client";

import { analyzeLetter, type LetterFields, type LetterScenario } from "@digieurope/shared";
import { FileSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { DropZone, SourceLink, Spinner } from "@/components/ui";
import { api, sampleUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

export default function LetterPage() {
  const { t, bi, eur, date, country } = useI18n();
  const [fields, setFields] = useState<LetterFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<LetterScenario>({ incomeChangePercent: 10, tuitionAgain: true, extraSiblings: 0 });
  const analysis = useMemo(() => (fields ? analyzeLetter(fields, scenario) : null), [fields, scenario]);

  async function read(file: File) {
    setBusy(true);
    setError(null);
    try {
      setFields(await api.readLetter(file));
    } catch (e) {
      setFields(null);
      setError(e instanceof Error ? e.message : t("letter.error"));
    }
    setBusy(false);
  }

  async function useSample() {
    const list = await api.samples();
    const res = await fetch(sampleUrl("letter", "docs", list.letter));
    const blob = await res.blob();
    await read(new File([blob], list.letter, { type: "application/pdf" }));
  }

  const verdictTone = analysis?.next.verdict === "likely_rejected" ? "banner-bad" : analysis?.next.verdict === "likely_reduced" ? "banner-warn" : "banner-ok";

  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow">{t("nav.letter")}</span>
          <h1>{t("letter.title")}</h1>
          <p>{t("letter.lead")}</p>
        </div>
      </div>
      {!fields && (
        <section className="card narrow" style={{ margin: 0, width: "100%" }}>
          <span className="icon-badge"><FileSearch size={24} /></span>
          <DropZone label={t("letter.drop")} multiple={false} accept="application/pdf" busy={busy} busyLabel={t("case.docs.reading")} onFiles={(f) => void read(f[0]!)} />
          <p style={{ marginTop: "0.9rem", marginBottom: 0 }}><button type="button" className="button button-ghost button-small" onClick={useSample}>{t("letter.useSample")}</button></p>
          {error && <p className="error-text" role="alert">{error}</p>}
        </section>
      )}
      {busy && fields && <Spinner label={t("common.loading")} />}
      {fields && analysis && (
        <div className="grid-2">
          <div className="stack">
            <section className="card">
              <h2>{t("letter.why")}</h2>
              <table className="estimate-table">
                <tbody>
                  {analysis.explain.map((row, i) => (
                    <tr key={i} className={row.kind === "total" ? "total" : ""}><td>{bi(row.label)}</td><td>{eur(row.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
              <details style={{ marginTop: "0.75rem" }}>
                <summary className="small">{t("letter.read")}</summary>
                <dl className="facts">
                  <dt>{t("common.country")}</dt><dd>{country(fields.country)}</dd>
                  <dt>{t("common.period")}</dt><dd>{date(fields.period_from)} – {date(fields.period_to)}</dd>
                  <dt>{t("letter.income")}</dt><dd>{fields.parent_income_year}: {eur(fields.parent_net_monthly)} / {t("common.perMonth")}</dd>
                </dl>
              </details>
              <p><button type="button" className="link-button small" onClick={() => setFields(null)}>{t("letter.again")}</button></p>
            </section>
            <section className="card">
              <h2>{t("letter.scenario")}</h2>
              <div className="form-grid">
                <label className="field">{t("letter.income")}
                  <select value={scenario.incomeChangePercent} onChange={(e) => setScenario({ ...scenario, incomeChangePercent: Number(e.target.value) })}>
                    {[[-20, "m20"], [0, "0"], [10, "10"], [25, "25"]].map(([v, k]) => <option key={v} value={v}>{t(`letter.income.${k}` as MessageKey)}</option>)}
                  </select>
                </label>
                <div className="stack" style={{ gap: "0.5rem" }}>
                  <label className="row"><input type="checkbox" checked={scenario.tuitionAgain} onChange={(e) => setScenario({ ...scenario, tuitionAgain: e.target.checked })} /> {t("letter.tuition")}</label>
                  <label className="row"><input type="checkbox" checked={scenario.extraSiblings > 0} onChange={(e) => setScenario({ ...scenario, extraSiblings: e.target.checked ? 1 : 0 })} /> {t("letter.sibling")}</label>
                </div>
              </div>
            </section>
          </div>
          <aside className="stack sticky-side">
            <section className={`card verdict ${verdictTone}`} aria-live="polite">
              <h2>{t(`letter.verdict.${analysis.next.verdict}` as MessageKey)}</h2>
              <p className="muted small" style={{ margin: 0 }}>{t("letter.expected")}</p>
              <div className="money">{eur(analysis.next.monthly)}</div>
              <h3 style={{ marginTop: "1rem" }}>{t("letter.reasons")}</h3>
              <ul style={{ paddingLeft: "1.1rem" }}>
                {analysis.next.reasons.map((r, i) => (
                  <li key={i}>{bi(r.text)} {r.source && <SourceLink source={r.source} />}</li>
                ))}
              </ul>
              {analysis.next.levers.length > 0 && (
                <>
                  <h3>{t("letter.levers")}</h3>
                  <ul style={{ paddingLeft: "1.1rem" }}>{analysis.next.levers.map((l, i) => <li key={i}>{bi(l)}</li>)}</ul>
                </>
              )}
            </section>
            <p className="small muted">{t("letter.disclaimer")}</p>
          </aside>
        </div>
      )}
    </div>
  );
}
