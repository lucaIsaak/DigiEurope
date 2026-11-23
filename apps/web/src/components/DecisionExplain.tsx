"use client";

import { walkDecisionTree, type AuditRecord, type CaseView } from "@digieurope/shared";
import { CheckCircle2, Download, FileText, GitBranch, MessageSquareText, MinusCircle, ScrollText, ShieldCheck, UserCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { DecisionTree } from "@/components/DecisionTree";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

type Tab = "human" | "tree" | "technical";

/**
 * Explainability for a decided case: the human explanation the student received,
 * and the frozen technical record (rule versions, inputs, documents, calculation, process steps) for audits.
 */
export function DecisionExplain({ c }: { c: CaseView }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("human");
  const d = c.decision;
  if (!d) return null;
  const ok = d.outcome === "approved";
  return (
    <section className="panel explain" id="explain">
      <div className={`explain-head ${ok ? "ok" : "bad"}`}>
        <span className="explain-icon">{ok ? <CheckCircle2 size={20} /> : <XCircle size={20} />}</span>
        <div className="grow">
          <h2>{t("xp.title")}</h2>
          <p className="small muted" style={{ margin: 0 }}>{t("xp.sub")}</p>
        </div>
        <div className="seg" role="tablist" aria-label={t("xp.title")}>
          <button type="button" role="tab" aria-selected={tab === "human"} aria-pressed={tab === "human"} onClick={() => setTab("human")}><MessageSquareText size={14} />{t("xp.tab.human")}</button>
          <button type="button" role="tab" aria-selected={tab === "tree"} aria-pressed={tab === "tree"} onClick={() => setTab("tree")}><GitBranch size={14} />{t("xp.tab.tree")}</button>
          <button type="button" role="tab" aria-selected={tab === "technical"} aria-pressed={tab === "technical"} onClick={() => setTab("technical")}><ScrollText size={14} />{t("xp.tab.technical")}</button>
        </div>
      </div>
      {tab === "human" ? <Human c={c} /> : tab === "tree" ? <TreeTab c={c} /> : d.audit ? <Technical c={c} a={d.audit} /> : <p className="muted" style={{ padding: "1rem 1.4rem" }}>{t("xp.noRecord")}</p>}
    </section>
  );
}

/** The decision tree with the path this case took, next to what the caseworker decided. */
function TreeTab({ c }: { c: CaseView }) {
  const { t, eur } = useI18n();
  const d = c.decision!;
  const walk = walkDecisionTree(c, new Date(d.decidedAt));
  const rulesWord = walk.outcome === "approved" ? `${t("dt.out.approved")} · ${eur(walk.monthly)} ${t("common.perMonth")}` : t(`dt.out.${walk.outcome}` as MessageKey);
  const ours = d.outcome === "approved" ? `${t("dt.out.approved")} · ${eur(d.monthlyAmount)} ${t("common.perMonth")}` : t("dt.out.rejected");
  const same = walk.outcome === d.outcome && (d.outcome !== "approved" || walk.monthly === d.monthlyAmount);
  return (
    <div className="explain-body">
      <h3 style={{ margin: 0 }}>{t("dt.title")}</h3>
      <p className="small muted" style={{ margin: "0.2rem 0 0.9rem" }}>{t("dt.lead")}</p>
      <div className={`dt-compare ${same ? "same" : "differs"}`}>
        <span><b>{t("dt.rulesIs")}</b> {rulesWord}</span>
        <span><b>{t("dt.decided")}</b> {ours} · {d.decidedBy}</span>
        <em>{same ? t("dt.same") : t("dt.differs")}</em>
      </div>
      <DecisionTree walk={walk} />
    </div>
  );
}

function Human({ c }: { c: CaseView }) {
  const { t, eur, dateTime } = useI18n();
  const d = c.decision!;
  const ok = d.outcome === "approved";
  return (
    <div className="explain-body">
      <div className="xp-outcome">
        <span className={`badge ${ok ? "ok" : "bad"}`}>{ok ? t("status.approved") : t("status.rejected")}</span>
        {ok && <strong className="num">{eur(d.monthlyAmount)} <span className="small muted">{t("common.perMonth")}</span></strong>}
      </div>
      <blockquote className="xp-letter">{d.note || t("xp.noNote")}</blockquote>
      <div className="xp-sign">
        <UserCheck size={15} />
        <span>{t("xp.signed", { by: d.decidedBy, date: dateTime(d.decidedAt) })}</span>
      </div>
      <p className="small muted" style={{ margin: "0.4rem 0 0" }}>{t("xp.humanNote", { lang: c.language.toUpperCase() })}</p>
    </div>
  );
}

function Technical({ c, a }: { c: CaseView; a: AuditRecord }) {
  const { t, tk, bi, eur, dateTime } = useI18n();
  const [busy, setBusy] = useState(false);
  const x = a.calculation;
  const deviates = a.outcome === "approved" && Math.round(x.grant) !== Math.round(a.monthlyAmount);
  const fails = a.rules.filter((r) => r.result === "fail");
  const download = async () => {
    setBusy(true);
    try {
      const blob = await api.auditRecord(c.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-${c.reference}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="explain-body">
      <dl className="xp-meta">
        <div><dt>{t("xp.m.reference")}</dt><dd className="num">{c.reference}</dd></div>
        <div><dt>{t("xp.m.decision")}</dt><dd>{a.outcome === "approved" ? `${t("status.approved")} · ${eur(a.monthlyAmount)}` : t("status.rejected")}</dd></div>
        <div><dt>{t("xp.m.by")}</dt><dd>{a.decidedBy}</dd></div>
        <div><dt>{t("xp.m.recorded")}</dt><dd className="num">{dateTime(a.recordedAt)}</dd></div>
        <div><dt>{t("xp.m.process")}</dt><dd>{a.process ? `${a.process.name} · v${a.process.version}` : t("xp.m.noProcess")}</dd></div>
        <div><dt>{t("xp.m.rules")}</dt><dd>{t("xp.m.rulesVal", { n: a.rules.length, f: fails.length })}</dd></div>
      </dl>
      <p className="xp-principle"><ShieldCheck size={15} />{t("xp.principle")}</p>

      <h3 className="xp-h">1 · {t("xp.calc")}</h3>
      <table className="xp-table num">
        <tbody>
          {x.parts.map((p) => <tr key={p.key}><td>{t(`est.part.${p.key}` as MessageKey)}</td><td>{eur(p.amount)}</td></tr>)}
          <tr className="sum"><td>{t("case.estimate.need")}</td><td>{eur(x.need)}</td></tr>
          {x.parentsKnown ? (
            <>
              <tr><td>{t("xp.c.sum")}</td><td>{eur(x.sumOfIncome ?? 0)}</td></tr>
              <tr><td>{t("xp.c.tax")}</td><td>− {eur(x.incomeTax ?? 0)}</td></tr>
              <tr><td>{t("xp.c.deduction", { p: x.deductionPercent })}</td><td>→ {eur(x.netMonthly ?? 0)} / {t("xp.c.month")}</td></tr>
              <tr><td>{t("xp.c.allowance", { s: x.siblings, m: x.married === false ? t("xp.c.single") : t("xp.c.married") })}</td><td>− {eur(x.allowance)}</td></tr>
              <tr><td>{t("xp.c.excess")}</td><td>{eur(x.excess)}</td></tr>
              <tr><td>{t("xp.c.countable", { p: x.countablePercent, d: x.divisor })}</td><td>{eur(x.contribution)}</td></tr>
            </>
          ) : (
            <tr><td colSpan={2} className="muted">{t("xp.c.noParents")}</td></tr>
          )}
          <tr><td>{t("xp.c.grantExact")}</td><td>{eur(x.grantExact)}</td></tr>
          <tr className="sum"><td>{t("xp.c.grant")}</td><td>{eur(x.grant)}</td></tr>
          {(x.oneOff.travel > 0 || x.oneOff.tuition > 0) && <tr><td>{t("case.estimate.once")}</td><td>{eur(x.oneOff.travel + x.oneOff.tuition)}</td></tr>}
        </tbody>
      </table>
      {deviates && <p className="banner banner-warn small" style={{ marginTop: "0.6rem" }}>{t("xp.c.deviates", { calc: eur(x.grant), set: eur(a.monthlyAmount) })}</p>}

      <h3 className="xp-h">2 · {t("xp.rules")}</h3>
      <table className="xp-table">
        <thead><tr><th>{t("xp.r.rule")}</th><th>{t("xp.r.version")}</th><th>{t("xp.r.result")}</th><th>{t("xp.r.approvedBy")}</th></tr></thead>
        <tbody>
          {a.rules.map((r) => (
            <tr key={r.id}>
              <td><span>{bi(r.title)}</span><small className="muted mono"> {r.id}</small><div className="small muted">{r.source}</div></td>
              <td className="num">v{r.version}</td>
              <td><Result r={r.result} severity={r.severity} /></td>
              <td className="small">{r.approvedBy ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="xp-h">3 · {t("xp.inputs")}</h3>
      <table className="xp-table">
        <tbody>
          {a.inputs.map((i) => (
            <tr key={i.ref}>
              <td>{bi(i.label)}{!i.required && <small className="muted"> · {t("xp.i.optional")}</small>}</td>
              <td>{!i.applies ? <span className="badge muted">{t("xp.i.notApplicable")}</span> : i.state === "ok" ? <span className="badge ok">{t("xp.i.ok")}</span> : <span className={`badge ${i.required ? "bad" : "muted"}`}>{t("xp.i.missing")}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="xp-h">4 · {t("xp.docs")}</h3>
      <table className="xp-table">
        <thead><tr><th>{t("xp.d.file")}</th><th>{t("xp.d.from")}</th><th>{t("xp.d.reader")}</th><th>{t("xp.d.conf")}</th></tr></thead>
        <tbody>
          {a.documents.map((doc) => (
            <tr key={doc.filename + doc.uploadedAt}>
              <td><FileText size={13} style={{ verticalAlign: "-2px" }} /> {doc.filename}<div className="small muted">{dateTime(doc.uploadedAt)}</div></td>
              <td className="small">{tk(`xp.from.${doc.uploadedBy}`).startsWith("xp.") ? doc.uploadedBy : tk(`xp.from.${doc.uploadedBy}`)}</td>
              <td className="small">{tk(`read.engine.${doc.engine}`).startsWith("read.") ? doc.engine : tk(`read.engine.${doc.engine}`)}</td>
              <td className="small num">{doc.lowestConfidence === null ? "–" : `${Math.round(doc.lowestConfidence * 100)} %`}{doc.flaggedForReview && <span className="badge warn" style={{ marginLeft: 6 }}>{t("xp.d.review")}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {a.processSteps.length > 0 && (
        <>
          <h3 className="xp-h">5 · {t("xp.steps")}</h3>
          <ol className="xp-steps">
            {a.processSteps.map((s, i) => (
              <li key={i}><span className="num small muted">{dateTime(s.at)}</span><span className="mono small">{s.step}{s.handle ? ` → ${s.handle}` : ""}</span><span className="small">{s.note}</span></li>
            ))}
          </ol>
        </>
      )}

      <h3 className="xp-h">{a.processSteps.length > 0 ? 6 : 5} · {t("xp.sources")}</h3>
      <ul className="xp-sources small">
        {a.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></li>)}
      </ul>

      <div className="row" style={{ justifyContent: "space-between", marginTop: "1rem", gap: "0.75rem" }}>
        <span className="small muted">{t("xp.frozen")}</span>
        <button type="button" className="button button-ghost button-small" disabled={busy} onClick={() => void download()}><Download size={14} />{t("xp.download")}</button>
      </div>
    </div>
  );
}

function Result({ r, severity }: { r: "pass" | "fail" | "n/a"; severity: "blocker" | "warning" }) {
  const { t } = useI18n();
  if (r === "pass") return <span className="xp-res ok"><CheckCircle2 size={14} />{t("xp.r.pass")}</span>;
  if (r === "fail") return <span className={`xp-res ${severity === "blocker" ? "bad" : "warn"}`}><XCircle size={14} />{severity === "blocker" ? t("xp.r.failBlocker") : t("xp.r.failWarning")}</span>;
  return <span className="xp-res"><MinusCircle size={14} />{t("xp.r.na")}</span>;
}
