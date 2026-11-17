"use client";

import type { CaseView } from "@digieurope/shared";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { DocumentChecklist, EstimateCard, FindingList, Inbox, Timeline } from "@/components/CaseParts";
import { DropZone, Field, Spinner, StatusPill, useAsyncError } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const TRACK: Record<string, number> = { draft: 0, submitted: 1, in_review: 3, info_requested: 2, approved: 4, rejected: 4 };

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, bi, eur, date } = useI18n();
  const [c, setC] = useState<CaseView | null>(null);
  const [missing, setMissing] = useState(false);
  const [reading, setReading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [email, setEmail] = useState("");
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const { error, run } = useAsyncError();

  const load = useCallback(async () => {
    try {
      setC(await api.get(id));
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000); // picks up parent uploads and office replies
    return () => clearInterval(timer);
  }, [load]);

  if (missing) return <p className="error-text">{t("lookup.notFound")}</p>;
  if (!c) return <Spinner label={t("common.loading")} />;

  const editable = c.status === "draft" || c.status === "info_requested";
  const checked = c.history.some((h) => h.kind === "checked");
  const step = TRACK[c.status] ?? 0;
  const blockers = c.report.findings.filter((f) => f.severity === "blocker");
  const notes = c.report.findings.filter((f) => f.severity === "warning");

  async function upload(files: File[]) {
    setReading(true);
    setFileErrors([]);
    const errors: string[] = [];
    for (const file of files) {
      try {
        setC(await api.upload(id, file));
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 600)); // lets the "reading" state be seen
    setFileErrors(errors);
    setReading(false);
  }

  async function check() {
    setChecking(true);
    await new Promise((r) => setTimeout(r, 1400));
    const res = await run(() => api.check(id));
    if (res) setC(res);
    setChecking(false);
  }

  return (
    <div className="stack">
      <div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 style={{ margin: 0 }}>{t("case.title")}</h1>
          <StatusPill status={c.status} />
        </div>
        <p className="muted">
          {c.reference} · {c.student.firstName} {c.student.lastName} · {c.stay.city} · {date(c.stay.startDate)} – {date(c.stay.endDate)}
        </p>
        <ol className="tracker" aria-label={t("case.status.title")}>
          {([1, 2, 3, 4] as const).map((n) => (
            <li key={n} className={n < step || (step === 4 && n === 4) ? "done" : n === step ? "now" : ""}>{t(`case.track.${n}` as const)}</li>
          ))}
        </ol>
      </div>

      {c.status === "info_requested" && (
        <div className="banner banner-warn">
          <h2>{t("case.info.title")}</h2>
          <p style={{ marginBottom: "0.25rem" }}>{c.officeMessage}</p>
          <p className="small" style={{ margin: 0 }}>{t("case.info.how")}</p>
        </div>
      )}
      {c.decision && (
        <div className={`banner ${c.decision.outcome === "approved" ? "banner-ok" : "banner-bad"}`}>
          <h2>{c.decision.outcome === "approved" ? t("case.decision.approved", { amount: eur(c.decision.monthlyAmount) }) : t("case.decision.rejected")}</h2>
          {c.decision.note && <p>{c.decision.note}</p>}
          <Link href="/letter">{t("case.decision.next")}</Link>
        </div>
      )}

      <Inbox c={c} />

      <div className="grid-2">
        <div className="stack">
          {editable && (
            <section className="card" aria-labelledby="docs-h">
              <h2 id="docs-h">{t("case.docs.title")}</h2>
              <p className="muted">{t("case.docs.lead")}</p>
              <DropZone label={t("case.docs.drop")} busy={reading} busyLabel={t("case.docs.reading")} onFiles={upload} />
              {fileErrors.map((e) => <p key={e} className="error-text">{e}</p>)}
            </section>
          )}
          <section className="card" aria-labelledby="list-h">
            <h2 id="list-h">{t("case.docs.title")}</h2>
            <DocumentChecklist c={c} showRemove={editable} onRemove={async (docId) => setC(await api.removeDocument(id, docId))} />
          </section>

          <section className="card" aria-labelledby="par-h">
            <h2 id="par-h">{t("case.parents.title")}</h2>
            <p className="muted">{t("case.parents.lead")}</p>
            {c.parents.status === "received" ? (
              <p className="banner banner-ok" style={{ marginBottom: 0 }}>✓ {t("case.parents.received")}</p>
            ) : c.parentLink ? (
              <div className="stack">
                <p style={{ marginBottom: 0 }}>{t("case.parents.sent", { email: c.parents.email })} · <em>{t("case.parents.waiting")}</em></p>
                <p className="small muted" style={{ margin: 0 }}>{t("case.parents.simulated")}</p>
                <div className="row">
                  <code className="small" style={{ overflowWrap: "anywhere" }}>{c.parentLink}</code>
                  <a className="button button-secondary button-small" href={c.parentLink} target="_blank" rel="noreferrer">{t("case.parents.openLink")}</a>
                </div>
              </div>
            ) : editable ? (
              <form
                className="row"
                style={{ alignItems: "flex-end" }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await run(() => api.inviteParents(id, email));
                  if (res) setC(res);
                }}
              >
                <Field label={t("case.parents.email")} className="grow"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <button className="button" type="submit">{t("case.parents.send")}</button>
              </form>
            ) : null}
          </section>
        </div>

        <aside className="stack sticky-side">
          <section className="card" aria-labelledby="check-h" aria-live="polite">
            <h2 id="check-h">{t("case.check.title")}</h2>
            {checking ? (
              <Spinner label={t("case.check.running")} />
            ) : !checked && editable ? (
              <>
                <p className="muted">{t("case.check.before")}</p>
                <button className="button" type="button" onClick={check} disabled={c.documents.length === 0}>{t("case.check.button")}</button>
              </>
            ) : (
              <>
                {c.report.ready ? (
                  <div className="banner banner-ok">
                    <h3>✓ {t("case.check.ready")}</h3>
                    <p style={{ marginBottom: 0 }}>{t("case.check.readyText")}</p>
                  </div>
                ) : (
                  <div className="banner banner-bad">
                    <h3>{t("case.check.fix")} · {t("case.check.fixCount", { n: blockers.length })}</h3>
                  </div>
                )}
                {blockers.length > 0 && <FindingList findings={blockers} />}
                {notes.length > 0 && (
                  <>
                    <h3 style={{ marginTop: "1rem" }}>{t("case.check.warnings")}</h3>
                    <FindingList findings={notes} />
                  </>
                )}
                {c.report.passed.length > 0 && (
                  <details style={{ marginTop: "0.75rem" }}>
                    <summary className="small">{t("case.check.passed", { n: c.report.passed.length })}</summary>
                    <ul className="small muted">{c.report.passed.map((p) => <li key={p.ruleId}>{bi(p.title)}</li>)}</ul>
                  </details>
                )}
                {editable && <button className="button button-ghost button-small" style={{ marginTop: "0.75rem" }} type="button" onClick={check}>{t("case.check.again")}</button>}
              </>
            )}
          </section>

          {(checked || !editable) && <EstimateCard c={c} />}

          {editable && checked && (
            <section className="card">
              <h2>{t("case.submit.title")}</h2>
              <button
                className="button"
                type="button"
                disabled={!c.report.ready}
                onClick={async () => {
                  const res = await run(() => api.submit(id));
                  if (res) setC(res);
                }}
              >
                {t("case.submit.button")}
              </button>
              {!c.report.ready && <p className="small muted" style={{ marginTop: "0.5rem", marginBottom: 0 }}>{t("case.submit.disabled")}</p>}
            </section>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
        </aside>
      </div>

      <section className="card">
        <h2>{t("case.status.title")}</h2>
        <Timeline c={c} />
      </section>
    </div>
  );
}
