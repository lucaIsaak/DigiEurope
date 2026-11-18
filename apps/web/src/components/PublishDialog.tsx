"use client";

import { CheckCircle2, Minus, Pencil, Plus, XCircle } from "lucide-react";
import type { ProcessImpact, ProcessTestResult } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Before a new version goes live: what changes, what it depends on, whether its sample cases still hold, who owns it and why it changes. */
export function PublishDialog({
  impact, tests, owner, setOwner, note, setNote, busy, onConfirm, onCancel,
}: {
  impact: ProcessImpact;
  tests: ProcessTestResult[];
  owner: string;
  setOwner: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const failing = tests.filter((x) => !x.ok);
  const needsNote = impact.liveVersion !== null;
  const ok = failing.length === 0 && (!needsNote || note.trim().length >= 3) && owner.trim().length > 0;
  const Icon = { added: Plus, removed: Minus, changed: Pencil };
  return (
    <>
      <div className="drawer-bg" onClick={onCancel} />
      <div className="modal" role="dialog" aria-label={t("builder.publish")}>
        <h2>{t("pub.title", { v: (impact.liveVersion ?? 0) + 1 })}</h2>

        <section>
          <h3>{t("pub.tests")}</h3>
          {tests.length === 0 ? <p className="small muted">{t("pub.noTests")}</p> : (
            <ul className="pd-list">
              {tests.map((x) => (
                <li key={x.id}>
                  {x.ok ? <CheckCircle2 size={15} color="var(--ok)" /> : <XCircle size={15} color="var(--bad)" />}
                  <span><strong>{x.name}</strong>{x.failures.map((f, i) => <small key={i} className="bad-text">{f}</small>)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>{t("pub.changes")} {impact.liveVersion !== null && <span className="muted small">(v{impact.liveVersion} → v{impact.liveVersion + 1})</span>}</h3>
          {impact.changes.length === 0 ? <p className="small muted">{t("pub.noChanges")}</p> : (
            <ul className="pd-list">
              {impact.changes.map((c, i) => {
                const I = Icon[c.kind];
                return <li key={i} className={`chg ${c.kind}`}><I size={14} /><span>{c.text}</span></li>;
              })}
            </ul>
          )}
        </section>

        <section>
          <h3>{t("pub.deps")}</h3>
          <dl className="pd-deps">
            <div><dt>{t("pub.deps.rules")}</dt><dd>{impact.dependencies.rules}</dd></div>
            <div><dt>{t("pub.deps.messages")}</dt><dd>{impact.dependencies.messages.join(", ") || "–"}</dd></div>
            <div><dt>{t("pub.deps.documents")}</dt><dd>{impact.dependencies.documents.join(", ") || "–"}</dd></div>
            <div><dt>{t("pub.deps.systems")}</dt><dd>{impact.dependencies.systems.join(", ") || "–"}</dd></div>
          </dl>
        </section>

        <div className="pd-form">
          <label className="field">{t("pub.owner")}<input value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
          <label className="field">{t("pub.note")}{needsNote ? " *" : ""}<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("pub.notePlaceholder")} /></label>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: "0.6rem" }}>
          <button className="button button-ghost" type="button" onClick={onCancel}>{t("common.cancel")}</button>
          <button className="button" type="button" disabled={!ok || busy} onClick={onConfirm}>{t("builder.publish")}</button>
        </div>
      </div>
    </>
  );
}
