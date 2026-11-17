"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export default function Home() {
  const { t } = useI18n();
  return (
    <>
      <section className="hero">
        <p className="pill">{t("home.kicker")}</p>
        <h1 style={{ marginTop: "0.8rem" }}>{t("home.title")}</h1>
        <p className="lead">{t("home.lead")}</p>
        <div className="row" style={{ marginTop: "1.25rem" }}>
          <Link href="/apply" className="button">{t("home.cta")}</Link>
          <Link href="/status" className="button button-ghost">{t("home.ctaStatus")}</Link>
        </div>
        <p className="small muted" style={{ marginTop: "1rem" }}>{t("home.trust")}</p>
      </section>

      <section className="stack" style={{ marginTop: "1.5rem" }}>
        <h2>{t("home.problem.title")}</h2>
        <div className="grid-3">
          {(["1", "2", "3"] as const).map((n) => (
            <div className="card" key={n}><p style={{ margin: 0 }}>{t(`home.problem.${n}` as const)}</p></div>
          ))}
        </div>
      </section>

      <section className="stack" style={{ marginTop: "2.5rem" }}>
        <h2>{t("home.how.title")}</h2>
        <div className="grid-3">
          {(["1", "2", "3"] as const).map((n) => (
            <div className="card" key={n}>
              <div className="row"><span className="step-num">{n}</span><h3 style={{ margin: 0 }}>{t(`home.how.${n}.t` as const)}</h3></div>
              <p className="muted" style={{ marginTop: "0.6rem", marginBottom: 0 }}>{t(`home.how.${n}.d` as const)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="stack" style={{ marginTop: "2.5rem" }}>
        <h2>{t("home.tools.title")}</h2>
        <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Link href="/ask" className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <h3>{t("nav.ask")} →</h3><p className="muted" style={{ marginBottom: 0 }}>{t("home.tools.ask")}</p>
          </Link>
          <Link href="/letter" className="card" style={{ textDecoration: "none", color: "inherit", marginTop: 0 }}>
            <h3>{t("nav.letter")} →</h3><p className="muted" style={{ marginBottom: 0 }}>{t("home.tools.letter")}</p>
          </Link>
        </div>
      </section>
    </>
  );
}
