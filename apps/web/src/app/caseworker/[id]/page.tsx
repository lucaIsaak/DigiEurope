"use client";

import { PILOT_MUNICIPALITY, type ApplicationWithPrecheck, type CaseworkerAction } from "@digieurope/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrecheckText } from "@/components/PrecheckPanel";
import { Alert, Loading, SeverityIcon, StatusBadge } from "@/components/ui";
import { api, documentUrl, exportUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, tk, date, dateTime, country } = useI18n();
  const text = usePrecheckText();
  const [app, setApp] = useState<ApplicationWithPrecheck | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.openCase(id).then(setApp).catch((e: Error) => setError(e.message));
  }, [id]);

  async function act(action: CaseworkerAction) {
    setBusy(true);
    setError(null);
    try {
      setApp(await api.act(id, action, message));
      setMessage("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !app) return <Alert kind="error">{error}</Alert>;
  if (!app) return <Loading />;

  const { person: p, identityDocument: idDoc, residenceTitle: rt, move: m, landlord: l } = app;
  const s = app.status;
  const reviewable = s === "submitted" || s === "in_review";
  const open = reviewable || s === "id_check";
  const issues = app.precheck.items.filter((i) => i.severity !== "ok");
  const addr = (a: typeof m.newAddress) => `${a.street} ${a.houseNumber}${a.addressExtra ? `, ${a.addressExtra}` : ""}, ${a.postalCode} ${a.city}`;
  const docKinds = { identity: "docs.idUpload", landlord_confirmation: "wizard.step.landlord", residence_title: "docs.residence", other: "docs.other" } as const;

  return (
    <>
      <p><Link href="/caseworker">← {t("cw.back")}</Link></p>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{p.lastName}, {p.firstName}</h1>
        <span className="mono muted">{app.reference}</span>
        <StatusBadge status={s} />
        <span className="pill pill-neutral">{t(`cw.method.${app.identityMethod}`)}</span>
        <span className="pill pill-neutral">{t("cw.lang")}: {app.language.toUpperCase()}</span>
      </div>

      <div className="case-layout">
        <div className="card">
          <h2 className="section-title">{t("cw.section.person")}</h2>
          <dl className="kv">
            <dt>{t("person.firstName")}</dt><dd>{p.firstName}</dd>
            <dt>{t("person.lastName")}</dt><dd>{p.lastName}{p.birthName ? ` (${t("person.birthName")}: ${p.birthName})` : ""}</dd>
            <dt>{t("person.birthDate")}</dt><dd>{date(p.birthDate)}, {p.birthPlace}</dd>
            <dt>{t("person.nationality")}</dt><dd>{country(p.nationality)}</dd>
            <dt>{t("person.sex")}</dt><dd>{t(`person.sex.${p.sex}`)}</dd>
            <dt>{t("person.maritalStatus")}</dt><dd>{t(`person.marital.${p.maritalStatus}`)}</dd>
            <dt>{t("person.religion")}</dt><dd>{t(`person.religion.${p.religion}`)}</dd>
          </dl>

          <h2 className="section-title">{t("cw.section.idDoc")}</h2>
          <dl className="kv">
            <dt>{t("person.idDoc.type")}</dt><dd>{idDoc.type ? t(`person.idDoc.${idDoc.type}`) : "–"}{app.identityMethod === "eid" ? " · eID ✓" : ""}</dd>
            <dt>{t("person.idDoc.number")}</dt><dd className="mono">{idDoc.number}</dd>
            <dt>{t("person.idDoc.issuingCountry")}</dt><dd>{country(idDoc.issuingCountry)}</dd>
            <dt>{t("person.idDoc.expiryDate")}</dt><dd>{date(idDoc.expiryDate)}</dd>
          </dl>

          {rt.type && rt.type !== "none" && (
            <>
              <h2 className="section-title">{t("cw.section.residence")}</h2>
              <dl className="kv">
                <dt>{t("docs.residence.type")}</dt><dd>{t(`docs.residence.${rt.type}`)}</dd>
                <dt>{t("docs.residence.expiry")}</dt><dd>{date(rt.expiryDate)}</dd>
              </dl>
            </>
          )}

          <h2 className="section-title">{t("cw.section.newAddress")}</h2>
          <dl className="kv">
            <dt>{t("cert.address")}</dt><dd>{addr(m.newAddress)}</dd>
            <dt>{t("move.moveInDate")}</dt><dd>{date(m.moveInDate)}</dd>
            <dt>{t("cert.type")}</dt><dd>{t(m.residenceType === "main" ? "cw.mainResidence" : "cw.secondaryResidence")}</dd>
          </dl>

          <h2 className="section-title">{t("cw.section.previous")}</h2>
          <dl className="kv">
            <dt>{t("cert.address")}</dt>
            <dd>{m.previousResidence === "abroad" ? t("cw.abroad", { country: country(m.previousCountry) }) : m.previousResidence === "germany" ? addr(m.previousAddress) : t("move.previous.none")}</dd>
          </dl>

          <h2 className="section-title">{t("cw.section.landlord")}</h2>
          <p>
            {l.status === "confirmed"
              ? t("cw.landlord.digital", { name: l.landlordName, address: l.landlordAddress ?? "–", date: dateTime(l.confirmedAt) })
              : t("cw.landlord.document")}
          </p>

          <h2 className="section-title">{t("cw.section.documents")}</h2>
          {app.documents.length === 0 ? <p className="muted">–</p> : (
            <ul className="upload-list">
              {app.documents.map((d) => (
                <li key={d.id}>
                  <a href={documentUrl(d.id)} target="_blank" rel="noreferrer">{t(docKinds[d.kind])}</a>
                  <small>{d.filename} · {Math.max(1, Math.round(d.size / 1024))} KB</small>
                </li>
              ))}
            </ul>
          )}

          <h2 className="section-title">{t("cw.section.history")}</h2>
          <ul className="messages">
            {app.history.filter((h) => h.status !== "draft").map((h, i) => (
              <li key={i}><div className="meta">{dateTime(h.at)}</div><StatusBadge status={h.status} /></li>
            ))}
            {app.messages.map((msg) => (
              <li key={msg.id} className={`from-${msg.from}`}>
                <div className="meta">{tk(`status.from.${msg.from}`)} · {dateTime(msg.at)}</div>
                {msg.text}
              </li>
            ))}
          </ul>
        </div>

        <aside className="case-aside">
          <section className="card">
            <h2>{t("cw.precheck")}</h2>
            {issues.filter((i) => i.severity === "blocker").length === 0 && (
              <p className="row" style={{ gap: 8 }}><SeverityIcon severity="ok" /> <strong>{t("cw.precheck.ok")}</strong></p>
            )}
            <ul className="precheck-list">
              {issues.map((i) => (
                <li key={i.code} className="precheck-item"><SeverityIcon severity={i.severity} />{text(i)}</li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>{t("cw.actions")}</h2>
            {error && <Alert kind="error">{error}</Alert>}
            {s === "info_requested" && <p className="muted">{t("cw.waitingApplicant")}</p>}
            {!open && s !== "info_requested" && <p className="muted">{t("cw.closed")}</p>}
            {open && (
              <>
                {reviewable && <p className="hint" style={{ marginTop: 0 }}>{app.identityMethod === "eid" ? t("cw.eidHint") : t("cw.passportHint")}</p>}
                {s === "id_check" && app.appointment && (
                  <Alert kind="info">{t("cw.appointment", { when: dateTime(app.appointment.start) })}</Alert>
                )}
                <div className="field">
                  <label htmlFor="msg">{t("cw.message")}</label>
                  <textarea id="msg" value={message} onChange={(e) => setMessage(e.target.value)} aria-describedby="msg-hint" />
                  <p className="hint" id="msg-hint">{t("cw.message.hint")}</p>
                </div>
                <div className="action-buttons">
                  {reviewable && app.identityMethod === "eid" && (
                    <button className="button" disabled={busy} onClick={() => act("approve")}>✓ {t("cw.action.approve")}</button>
                  )}
                  {reviewable && app.identityMethod === "passport" && (
                    <button className="button" disabled={busy} onClick={() => act("invite_id_check")}>{t("cw.action.invite")}</button>
                  )}
                  {s === "id_check" && (
                    <button className="button" disabled={busy} onClick={() => act("confirm_identity")}>✓ {t("cw.action.confirmId")}</button>
                  )}
                  <button className="button button-secondary" disabled={busy || !message.trim()} onClick={() => act("request_info")}>{t("cw.action.requestInfo")}</button>
                  <button className="button button-danger" disabled={busy || !message.trim()} onClick={() => act("reject")}>{t("cw.action.reject")}</button>
                </div>
              </>
            )}
            <p style={{ marginTop: 16, marginBottom: 0 }}>
              <a href={exportUrl(app.id)} download>{t("cw.export")}</a>
            </p>
            <p className="hint">{PILOT_MUNICIPALITY.office}</p>
          </section>
        </aside>
      </div>
    </>
  );
}
