"use client";

import { NODE_CATALOG, REQUIRED_DOCS, type CaseView, type DocumentKind, type DocumentRef, type Finding, type NodeKind } from "@digieurope/shared";
import { documentUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { SourceLink } from "./ui";

export const docLabel = (t: ReturnType<typeof useI18n>["t"], kind: string) => t(`doc.${kind}` as MessageKey);

export function requiredKinds(c: Pick<CaseView, "stay">): DocumentKind[] {
  const kinds = [...REQUIRED_DOCS[c.stay.type]];
  if (c.stay.tuitionFees > 0) kinds.push("tuition_waiver_proof");
  return kinds;
}

export function ExtractedFacts({ doc }: { doc: DocumentRef }) {
  const { tk } = useI18n();
  const fields = Object.entries(doc.extraction.fields);
  const sigs = Object.entries(doc.extraction.signatures);
  return (
    <dl className="facts">
      {fields.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{tk(`field.${k}`)}</dt>
          <dd>{v}</dd>
        </div>
      ))}
      {sigs.map(([k, ok]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{tk(`sig.${k}`)}</dt>
          <dd>{ok ? `✓ ${tk("case.docs.signed")}` : `✗ ${tk("case.docs.unsigned")}`}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One row per required document: read, needs a fix, or missing. */
export function DocumentChecklist({ c, onRemove, showRemove, office }: { c: CaseView; onRemove?: (id: string) => void; showRemove?: boolean; office?: boolean }) {
  const { t, bi } = useI18n();
  const checked = c.history.some((h) => h.kind === "checked") || office;
  const kinds = requiredKinds(c);
  const extra = c.documents.filter((d) => !kinds.includes(d.kind) && d.extraction.readable);
  const unreadable = c.documents.filter((d) => !d.extraction.readable);
  const row = (kind: DocumentKind) => {
    const docs = c.documents.filter((d) => d.kind === kind && d.extraction.readable);
    const doc = docs[docs.length - 1];
    const findings = c.report.findings.filter((f) => f.documentKind === kind);
    const state = !doc ? "missing" : findings.some((f) => f.severity === "blocker") ? "fix" : findings.length ? "note" : "ok";
    const icon = state === "ok" ? "✓" : state === "missing" ? "•" : "!";
    const tone = state === "ok" ? "sev-ok" : state === "missing" ? "sev-idle" : state === "fix" ? "sev-bad" : "sev-warn";
    return (
      <div className="doc-row" key={kind}>
        <span className={`sev ${tone}`} aria-hidden>{icon}</span>
        <div>
          <strong>{docLabel(t, kind)}</strong>{" "}
          <span className="muted small">
            {state === "missing" ? t("case.docs.missing") : state === "ok" ? t("case.docs.ok") : t("case.docs.fix")}
            {doc && ` · ${doc.filename}`}
          </span>
          {checked && findings.map((f) => (
            <p key={f.ruleId} className="small" style={{ margin: "0.25rem 0 0" }}>{bi(f.fix)}</p>
          ))}
          {doc && (
            <details>
              <summary>{t("case.docs.details")}</summary>
              <ExtractedFacts doc={doc} />
            </details>
          )}
        </div>
        <div className="row small">
          {doc && <a href={documentUrl(doc.id)} target="_blank" rel="noreferrer">{t("case.docs.view")}</a>}
          {doc && showRemove && onRemove && <button type="button" className="link-button" onClick={() => onRemove(doc.id)}>{t("case.docs.remove")}</button>}
        </div>
      </div>
    );
  };
  return (
    <div>
      {kinds.map(row)}
      {extra.map((d) => (
        <div className="doc-row" key={d.id}>
          <span className="sev sev-ok" aria-hidden>✓</span>
          <div><strong>{docLabel(t, d.kind)}</strong> <span className="muted small">{d.filename}</span></div>
          <a className="small" href={documentUrl(d.id)} target="_blank" rel="noreferrer">{t("case.docs.view")}</a>
        </div>
      ))}
      {unreadable.map((d) => (
        <div className="doc-row" key={d.id}>
          <span className="sev sev-bad" aria-hidden>!</span>
          <div><strong>{d.filename}</strong> <span className="muted small">{t("case.docs.unreadable")}</span></div>
          <div className="row small">
            <a href={documentUrl(d.id)} target="_blank" rel="noreferrer">{t("case.docs.view")}</a>
            {showRemove && onRemove && <button type="button" className="link-button" onClick={() => onRemove(d.id)}>{t("case.docs.remove")}</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FindingList({ findings, showRule }: { findings: Finding[]; showRule?: boolean }) {
  const { bi, t } = useI18n();
  return (
    <div>
      {findings.map((f) => (
        <div className="finding" key={f.ruleId}>
          <span className={`sev ${f.severity === "blocker" ? "sev-bad" : "sev-warn"}`} aria-hidden>{f.severity === "blocker" ? "!" : "i"}</span>
          <div>
            <h3>{bi(f.title)}</h3>
            <p>{bi(f.fix)}</p>
            <div className="row small">
              <SourceLink source={f.source} />
              {showRule && <span className="muted">{t("office.case.rule", { id: f.ruleId })}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EstimateCard({ c, compact }: { c: CaseView; compact?: boolean }) {
  const { t, eur } = useI18n();
  const e = c.estimate;
  return (
    <div className="card">
      <h2>{t("case.estimate.title")}</h2>
      <p className="muted small" style={{ margin: 0 }}>{t("case.estimate.likely")}</p>
      <div className="money">{eur(e.monthly)} <span className="muted small" style={{ fontWeight: 400 }}>{t("common.perMonth")}</span></div>
      <p className="small muted">{t("case.estimate.range", { low: eur(e.low), high: eur(e.high) })}</p>
      {e.provisional && <p className="banner banner-warn small">{t("case.estimate.provisional")}</p>}
      {!compact && (
        <>
          <h3 style={{ marginTop: "1rem" }}>{t("case.estimate.breakdown")}</h3>
          <table className="estimate-table">
            <tbody>
              {e.parts.map((p) => (
                <tr key={p.key}><td>{t(`est.part.${p.key}` as MessageKey)}</td><td>{eur(p.amount)}</td></tr>
              ))}
              <tr><td><strong>{t("case.estimate.need")}</strong></td><td><strong>{eur(e.need)}</strong></td></tr>
              <tr><td>− {t("case.estimate.parents")}</td><td>{eur(e.parentContribution)}</td></tr>
              <tr className="total"><td>{t("case.estimate.monthly")}</td><td>{eur(Math.max(0, e.need - e.parentContribution))}</td></tr>
            </tbody>
          </table>
          <h3 style={{ marginTop: "1rem" }}>{t("case.estimate.once")}</h3>
          <table className="estimate-table">
            <tbody>
              <tr><td>{t("case.estimate.travel")}</td><td>{eur(e.oneOff.travel)}</td></tr>
              {e.oneOff.tuition > 0 && <tr><td>{t("case.estimate.tuition")}</td><td>{eur(e.oneOff.tuition)}</td></tr>}
            </tbody>
          </table>
        </>
      )}
      <ul className="small muted" style={{ paddingLeft: "1.1rem", marginBottom: 0 }}>
        {e.notes.map((n) => <li key={n}>{t(n as MessageKey)}</li>)}
      </ul>
    </div>
  );
}

export function Timeline({ c }: { c: CaseView }) {
  const { t, dateTime } = useI18n();
  return (
    <ul className="timeline">
      {[...c.history].reverse().map((h, i) => (
        <li key={i}>
          <time>{dateTime(h.at)}</time>
          <span>{t(`hist.${h.kind}` as MessageKey)}{h.text && h.kind === "info_requested" ? `: ${h.text}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

/** Messages the process sent to the student. */
export function Inbox({ c }: { c: CaseView }) {
  const { t, dateTime } = useI18n();
  const mails = (c.outbox ?? []).filter((m) => m.to === "student");
  if (mails.length === 0) return null;
  return (
    <section className="card" aria-labelledby="inbox-h">
      <h2 id="inbox-h">{t("inbox.title")}</h2>
      <div className="stack" style={{ gap: "0.6rem" }}>
        {[...mails].reverse().map((m) => (
          <div className="mail" key={m.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{m.subject}</strong>
              <span className="small muted">{dateTime(m.at)}</span>
            </div>
            <pre>{m.body}</pre>
            {m.aiDraft && <p className="small muted" style={{ margin: "0.5rem 0 0" }}>{t("inbox.auto")}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** What the office's process did with this case: steps, messages, calls to systems. */
export function FlowPanel({ c }: { c: CaseView }) {
  const { t, bi, dateTime } = useI18n();
  if (!c.flow) return <p className="muted small">{t("flow.none")}</p>;
  return (
    <div className="stack" style={{ gap: "0.75rem" }}>
      <p className="small muted" style={{ margin: 0 }}>
        {t("flow.version", { name: c.flow.processId, v: c.flow.version })}{c.assignedTeam ? ` · ${t("flow.team", { t: c.assignedTeam })}` : ""}
      </p>
      <div>
        {c.flow.log.map((l, i) => (
          <div className="log-line" key={i}>
            <span aria-hidden>{l.handle === "info" || l.note.startsWith("Waiting") ? "…" : "✓"}</span>
            <span>
              <strong>{bi(NODE_CATALOG[l.kind as NodeKind]?.title ?? { de: l.kind, en: l.kind })}</strong> <span className="muted small">{dateTime(l.at)}</span>
              <br /><span className="muted">{l.note}</span>
            </span>
          </div>
        ))}
      </div>
      {(c.outbox ?? []).length > 0 && (
        <>
          <h3 style={{ margin: 0 }}>{t("flow.mails")}</h3>
          {(c.outbox ?? []).map((m) => (
            <div className="mail" key={m.id}>
              <strong className="small">→ {m.to}: {m.subject}</strong> {m.aiDraft && <span className="pill">{t("flow.aiDraft")}</span>}
              <pre>{m.body}</pre>
            </div>
          ))}
        </>
      )}
      {(c.integrations ?? []).length > 0 && (
        <>
          <h3 style={{ margin: 0 }}>{t("flow.calls")}</h3>
          {(c.integrations ?? []).map((i, k) => <p key={k} className="small" style={{ margin: 0 }}><code>{i.system}.{i.action}</code> → {String((i.response as { externalId?: string }).externalId)}</p>)}
        </>
      )}
    </div>
  );
}
