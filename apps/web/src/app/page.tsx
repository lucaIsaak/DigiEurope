"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { myApplications } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function Home() {
  const { t } = useI18n();
  const [mine, setMine] = useState<{ id: string; reference: string }[]>([]);
  useEffect(() => setMine(myApplications.list()), []);

  return (
    <>
      <section className="hero">
        <div>
          <p className="kicker">{t("home.kicker")}</p>
          <h1>{t("home.title")}</h1>
          <p className="lead">{t("home.lead")}</p>
          <div className="row">
            <Link href="/register" className="button button-large">{t("home.start")}</Link>
            <Link href="/status" className="button button-secondary button-large">{t("home.track")}</Link>
          </div>
          {mine.length > 0 && (
            <p className="hint" style={{ marginTop: 16 }}>
              {t("home.mine")}:{" "}
              {mine.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <Link href={`/status/${a.id}`} className="mono">{a.reference}</Link>
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="card">
          <h2>{t("home.need.title")}</h2>
          <ul className="check-list">
            {(["home.need.id", "home.need.landlord", "home.need.visa", "home.need.time"] as const).map((k) => (
              <li key={k}><span className="sev sev-ok" aria-hidden>✓</span><span>{t(k)}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="home-section">
        <h2>{t("home.how.title")}</h2>
        <div className="grid-3 steps-3">
          {([1, 2, 3] as const).map((n) => (
            <div className="card" key={n}>
              <h3>{t(`home.how.${n}.title`)}</h3>
              <p className="muted" style={{ margin: 0 }}>{t(`home.how.${n}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section card">
        <h2>{t("home.why.title")}</h2>
        <p>{t("home.why.text")}</p>
        <ul className="check-list">
          {(["home.why.bank", "home.why.tax", "home.why.permit", "home.why.contracts"] as const).map((k) => (
            <li key={k}><span className="sev sev-warning" aria-hidden>→</span><span>{t(k)}</span></li>
          ))}
        </ul>
      </section>
    </>
  );
}
