"use client";

import { useCallback, useEffect, useState } from "react";
import { SourceLink, Spinner, useAsyncError } from "@/components/ui";
import { api, type RuleEntry } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function Rules() {
  const { t, bi, dateTime } = useI18n();
  const [rules, setRules] = useState<RuleEntry[] | null>(null);
  const [sel, setSel] = useState("R-HEALTH-ABROAD");
  const { error, run } = useAsyncError();
  const load = useCallback(async () => setRules(await api.rules()), []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!rules) return <Spinner label={t("common.loading")} />;
  const cur = rules.find((r) => r.rule.id === sel) ?? rules[0]!;
  const passed = cur.tests.filter((x) => x.ok).length;
  const approved = cur.state.status === "approved";

  return (
    <div className="stack">
      <div>
        <h1>{t("office.rules.title")}</h1>
        <p className="lead" style={{ maxWidth: "78ch" }}>{t("office.rules.lead")}</p>
        <div className="flow" aria-hidden>
          {(["1", "2", "3", "4"] as const).map((n, i) => (
            <span key={n} style={{ display: "contents" }}>
              <span className="node">{t(`office.rules.flow.${n}` as const)}</span>
              {i < 3 && <span className="arrow">→</span>}
            </span>
          ))}
        </div>
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.8fr)" }}>
        <div className="list-select" role="list">
          {rules.map((r) => (
            <button key={r.rule.id} type="button" aria-current={r.rule.id === cur.rule.id} onClick={() => setSel(r.rule.id)}>
              <span><strong>{bi(r.rule.title)}</strong></span>
              <span className="row">
                <small>{r.rule.id}</small>
                <span className={`pill ${r.state.status === "approved" ? "pill-ok" : "pill-warn"}`}>{r.state.status === "approved" ? t("office.rules.approved") : t("office.rules.draft")}</span>
              </span>
            </button>
          ))}
        </div>

        <section className="card" aria-live="polite">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{bi(cur.rule.title)}</h2>
            <span className="pill pill-muted">{cur.rule.scope === "federal" ? t("office.rules.scope.federal") : t("office.rules.scope.office")}</span>
          </div>
          <p className="small muted">{cur.rule.id} · v{cur.rule.version} · <SourceLink source={cur.rule.source} /></p>
          {cur.rule.draftedByAi && <p className="banner banner-warn small">{t("office.rules.aiNote")}</p>}

          <h3>{t("office.rules.plain")}</h3>
          <p className="banner banner-info" style={{ marginTop: 0 }}>{bi(cur.rule.plain)}</p>

          <h3>{t("office.rules.compiled")}</h3>
          {cur.compiled.when && (<><p className="small muted" style={{ margin: 0 }}>{t("office.rules.appliesWhen")}</p><pre className="code">{cur.compiled.when}</pre></>)}
          <p className="small muted" style={{ margin: 0 }}>{t("office.rules.passesWhen")}</p>
          <pre className="code">{cur.compiled.pass}</pre>
          <p className="small muted" style={{ margin: 0 }}>{t("office.rules.message")}</p>
          <p className="small">{bi(cur.rule.fix)}</p>

          <h3>{t("office.rules.tests")} · {t("office.rules.testsPass", { n: passed, m: cur.tests.length })}</h3>
          <table className="estimate-table">
            <tbody>
              {cur.tests.map((x) => (
                <tr key={x.name}>
                  <td>{x.ok ? "✓" : "✗"} {x.name}</td>
                  <td className="small muted" style={{ textAlign: "right" }}>{x.expectPass ? t("office.rules.expect.pass") : t("office.rules.expect.fail")}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: "1rem" }}>
            {approved ? (
              <>
                <span className="small muted">{t("office.rules.approvedBy", { by: cur.state.approvedBy ?? "", date: dateTime(cur.state.approvedAt) })}</span>
                <button className="button button-ghost button-small" type="button" onClick={async () => { await run(() => api.revokeRule(cur.rule.id)); await load(); }}>{t("office.rules.revoke")}</button>
              </>
            ) : (
              <button className="button" type="button" disabled={passed !== cur.tests.length} onClick={async () => { await run(() => api.approveRule(cur.rule.id)); await load(); }}>{t("office.rules.approve")}</button>
            )}
          </div>
          {approved && !cur.rule.when ? null : null}
          {approved && cur.rule.draftedByAi && <p className="small banner banner-ok" style={{ marginTop: "0.75rem" }}>{t("office.rules.effect")}</p>}
          {error && <p className="error-text" role="alert">{error}</p>}
        </section>
      </div>
    </div>
  );
}
