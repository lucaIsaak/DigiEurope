"use client";

import { PILOT_MUNICIPALITY, type ApplicationWithPrecheck } from "@digieurope/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Printable specimen. Clearly watermarked: this prototype never issues official documents. */
export default function Certificate() {
  const { id } = useParams<{ id: string }>();
  const { t, date } = useI18n();
  const [app, setApp] = useState<ApplicationWithPrecheck | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get(id).then(setApp).catch(() => setError(true));
  }, [id]);

  if (error) return <Alert kind="error">{t("status.notFound")}</Alert>;
  if (!app) return <Loading />;
  if (app.status !== "approved") return <Alert kind="info"><Link href={`/status/${id}`}>{t("wizard.toStatus")}</Link></Alert>;

  const a = app.move.newAddress;
  return (
    <>
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <Link href={`/status/${id}`}>← {t("wizard.toStatus")}</Link>
        <span className="spacer" />
        <button className="button" onClick={() => window.print()}>{t("cert.print")}</button>
      </div>
      <article className="certificate">
        <div className="specimen-bar">{t("cert.specimen")}</div>
        <div className="watermark" aria-hidden>{t("cert.specimen").split("·")[0]}</div>
        <p className="muted" style={{ margin: 0 }}>{PILOT_MUNICIPALITY.office}</p>
        <p className="muted">{PILOT_MUNICIPALITY.officeAddress}</p>
        <h1 style={{ marginTop: 32 }}>{t("cert.title")}</h1>
        <p className="muted">{t("cert.subtitle")} · {app.reference}</p>
        <p style={{ marginTop: 24 }}>{t("cert.text")}</p>
        <dl className="kv">
          <dt>{t("cert.name")}</dt><dd><strong>{app.person.firstName} {app.person.lastName}</strong></dd>
          <dt>{t("person.birthDate")}</dt><dd>{date(app.person.birthDate)}, {app.person.birthPlace}</dd>
          <dt>{t("cert.address")}</dt><dd>{a.street} {a.houseNumber}{a.addressExtra ? `, ${a.addressExtra}` : ""}, {a.postalCode} {a.city}</dd>
          <dt>{t("cert.since")}</dt><dd>{date(app.move.moveInDate)}</dd>
          <dt>{t("cert.type")}</dt><dd>{t(app.move.residenceType === "main" ? "cw.mainResidence" : "cw.secondaryResidence")}</dd>
          <dt>{t("cert.issued")}</dt><dd>{date(app.decidedAt)}</dd>
        </dl>
      </article>
    </>
  );
}
