"use client";

import { needsResidenceTitle, type ApplicationWithPrecheck, type Appointment } from "@digieurope/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Loading, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type StepState = "done" | "current" | "attention" | "todo";

function icsFor(a: Appointment, reference: string) {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(a.start);
  const end = new Date(start.getTime() + a.minutes * 60_000);
  const body = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DigiEurope//Prototype//EN", "BEGIN:VEVENT",
    `UID:${reference}@digieurope.example`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:Express ID check ${reference}`, `LOCATION:${a.location}`, "DESCRIPTION:Bring your passport.", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

export default function StatusPage() {
  const { id } = useParams<{ id: string }>();
  const { t, tk, date, dateTime } = useI18n();
  const [app, setApp] = useState<ApplicationWithPrecheck | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.get(id).then((a) => alive && setApp(a)).catch(() => alive && setNotFound(true));
    load();
    const timer = setInterval(load, 6000); // live updates while the caseworker works on it
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);

  if (notFound) return <Alert kind="error">{t("status.notFound")}</Alert>;
  if (!app) return <Loading />;

  const s = app.status;
  const passport = app.identityMethod === "passport";
  const reviewAt = app.history.find((h) => h.status === "in_review")?.at;
  const decided = s === "approved" || s === "rejected";

  const steps: { key: string; title: string; text: string; state: StepState; at?: string }[] = [
    { key: "submitted", title: t("status.step.submitted"), text: t("status.step.submitted.text"), state: app.submittedAt ? "done" : "todo", at: app.submittedAt },
    { key: "prechecked", title: t("status.step.prechecked"), text: t("status.step.prechecked.text"), state: app.submittedAt ? "done" : "todo", at: app.submittedAt },
    {
      key: "review",
      title: t("status.step.review"),
      text: s === "submitted" ? t("status.step.review.waiting") : t("status.step.review.text"),
      state: s === "info_requested" ? "attention" : s === "submitted" || s === "in_review" ? "current" : decided || s === "id_check" ? "done" : "todo",
      at: reviewAt,
    },
    ...(passport
      ? [{
          key: "idcheck", title: t("status.step.idcheck"), text: t("status.step.idcheck.text"),
          state: (s === "id_check" ? "current" : s === "approved" ? "done" : "todo") as StepState,
          at: app.appointment?.start,
        }]
      : []),
    { key: "done", title: t("status.step.done"), text: t("status.step.done.text"), state: s === "approved" ? "done" : "todo", at: s === "approved" ? app.decidedAt : undefined },
  ];
  if (s === "rejected") steps.pop();

  const lastCaseworkerMsg = [...app.messages].reverse().find((m) => m.from === "caseworker");
  const nonEu = needsResidenceTitle(app.person.nationality);

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>{t("status.title")}</h1>
        <StatusBadge status={s} />
      </div>
      <p className="muted">{t("status.live")}</p>

      <div className="status-layout">
        <div className="stack">
          {s === "draft" && (
            <Alert kind="info" title={tk("status.draft")}>
              <Link href={`/register/${app.id}`} className="button">{t("wizard.next")} →</Link>
            </Alert>
          )}
          {s === "info_requested" && (
            <Alert kind="warning" title={t("status.info.title")}>
              {lastCaseworkerMsg && <p>„{lastCaseworkerMsg.text}“</p>}
              <Link href={`/register/${app.id}`} className="button">{t("status.info.action")}</Link>
            </Alert>
          )}
          {s === "id_check" && app.appointment && (
            <Alert kind="info" title={t("status.appointment.title")}>
              <p style={{ fontSize: "1.2rem", fontWeight: 700, margin: "4px 0" }}>{dateTime(app.appointment.start)}</p>
              <p>{app.appointment.location}</p>
              <p>{t("status.appointment.bring")}</p>
              <a className="button button-secondary" href={icsFor(app.appointment, app.reference)} download={`${app.reference}.ics`}>
                {t("status.appointment.calendar")}
              </a>
            </Alert>
          )}
          {s === "approved" && (
            <Alert kind="success" title={t("status.approved.title")}>
              <p>{t("status.approved.text")}</p>
              <Link href={`/status/${app.id}/certificate`} className="button">{t("status.approved.download")}</Link>
            </Alert>
          )}
          {s === "rejected" && (
            <Alert kind="error" title={t("status.rejected.title")}>
              {lastCaseworkerMsg && <p>„{lastCaseworkerMsg.text}“</p>}
              <p>{t("status.rejected.text")}</p>
            </Alert>
          )}

          {s !== "draft" && (
            <section className="card">
              <ol className="timeline">
                {steps.map((step) => (
                  <li key={step.key} className={step.state}>
                    <span className="dot" aria-hidden>{step.state === "done" ? "✓" : step.state === "attention" ? "!" : ""}</span>
                    <strong>
                      {step.title}
                      {(step.state === "current" || step.state === "attention") && <span className="now-tag">{t("status.now")}</span>}
                    </strong>
                    {step.at && <span className="when">{dateTime(step.at)}</span>}
                    {step.state !== "done" && step.state !== "todo" && <p>{step.text}</p>}
                    {step.state === "todo" && <p className="muted">{step.text}</p>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {s === "approved" && (
            <section className="card">
              <h2>{t("status.next.title")}</h2>
              <ul className="check-list">
                {(["status.next.bank", "status.next.tax", "status.next.insurance", "status.next.broadcast"] as const).map((k) => (
                  <li key={k}><span className="sev sev-warning" aria-hidden>→</span><span>{t(k)}</span></li>
                ))}
                {nonEu && <li><span className="sev sev-warning" aria-hidden>→</span><span>{t("status.next.permit")}</span></li>}
                <li><span className="sev sev-warning" aria-hidden>→</span><span>{t("status.next.eid")}</span></li>
              </ul>
            </section>
          )}
        </div>

        <aside className="stack">
          <section className="card">
            <p className="muted" style={{ margin: 0 }}>{t("status.reference")}</p>
            <p className="ref-box mono">{app.reference}</p>
            <p style={{ margin: 0 }}>{app.person.firstName} {app.person.lastName}</p>
            <p className="muted">{app.move.newAddress.street} {app.move.newAddress.houseNumber}, {app.move.newAddress.postalCode} {app.move.newAddress.city} · {date(app.move.moveInDate)}</p>
            <p className="hint">{t("status.keep")}</p>
          </section>
          {app.messages.length > 0 && (
            <section className="card">
              <h2>{t("status.messages")}</h2>
              <ul className="messages">
                {app.messages.map((m) => (
                  <li key={m.id} className={`from-${m.from}`}>
                    <div className="meta">{tk(`status.from.${m.from}`)} · {dateTime(m.at)}</div>
                    {m.text}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
