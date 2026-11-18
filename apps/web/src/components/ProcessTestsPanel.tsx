"use client";

import type { ProcessTest } from "@digieurope/shared";
import { CheckCircle2, Play, Plus, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import type { ProcessTestResult, TestRunResult } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** The sample cases of a process: each says which steps a case must pass and where it must stop. They run before every publish. */
export function ProcessTestsPanel({
  tests, setTests, last, lastSample, lastDecision, results, busy, onRun, stepName,
}: {
  tests: ProcessTest[];
  setTests: (t: ProcessTest[]) => void;
  last: TestRunResult | null;
  lastSample: string;
  lastDecision: string;
  results: ProcessTestResult[] | null;
  busy: boolean;
  onRun: () => void;
  stepName: (id: string) => string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const addFromRun = () => {
    if (!last || !name.trim()) return;
    const visits = [...new Set(last.log.map((l) => l.nodeId))];
    setTests([...tests, { id: `t-${Date.now().toString(36)}`, name: name.trim(), sample: lastSample, ...(lastDecision ? { decision: lastDecision } : {}), expect: { visits, waitingAt: last.waiting } }]);
    setName("");
  };
  return (
    <div className="tests">
      <div className="tests-bar">
        <strong>{t("builder.tests.title")}</strong>
        <span className="small muted">{t("builder.tests.lead")}</span>
        <span className="ws-spacer" />
        <button className="button button-small" type="button" disabled={busy || tests.length === 0} onClick={onRun}><Play size={14} />{t("builder.tests.run")}</button>
      </div>
      {tests.length === 0 && <p className="muted small" style={{ padding: "0.6rem 1rem" }}>{t("builder.tests.none")}</p>}
      <ul className="tests-list">
        {tests.map((x) => {
          const r = results?.find((y) => y.id === x.id);
          return (
            <li key={x.id}>
              <span className="tests-state" aria-hidden>{r ? (r.ok ? <CheckCircle2 size={16} color="var(--ok)" /> : <XCircle size={16} color="var(--bad)" />) : <span className="tests-dot" />}</span>
              <div>
                <strong>{x.name}</strong>
                <small className="muted">
                  {t(`builder.test.sample.${x.sample}` as never)}{x.decision ? ` · ${t(`builder.test.decision.${x.decision}` as never)}` : ""} · {t("builder.tests.passes")}: {x.expect.visits.map(stepName).join(" → ")} · {x.expect.waitingAt === undefined ? "" : x.expect.waitingAt === null ? t("builder.tests.endsOnItsOwn") : `${t("builder.tests.stopsAt")}: ${stepName(x.expect.waitingAt)}`}
                </small>
                {r && !r.ok && r.failures.map((f, i) => <small key={i} className="bad-text">{f}</small>)}
              </div>
              <button className="icon-button" type="button" aria-label={t("builder.delete")} onClick={() => setTests(tests.filter((y) => y.id !== x.id))}><Trash2 size={15} /></button>
            </li>
          );
        })}
      </ul>
      <div className="tests-add">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("builder.tests.namePlaceholder")} aria-label={t("builder.tests.namePlaceholder")} />
        <button className="button button-ghost button-small" type="button" disabled={!last || !name.trim()} onClick={addFromRun}><Plus size={14} />{t("builder.tests.addFromRun")}</button>
        {!last && <span className="small muted">{t("builder.tests.needRun")}</span>}
      </div>
    </div>
  );
}
