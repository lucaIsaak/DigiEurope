"use client";

import { ArrowRight, CheckCircle2, Circle, FileSearch, FileUp, MessageCircleQuestion, Scale, ShieldCheck, Users, Wallet, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export default function Home() {
  const { t, eur } = useI18n();
  return (
    <>
      <section className="home-hero">
        <div>
          <span className="eyebrow">{t("h2.eyebrow")}</span>
          <h1>
            {t("h2.title.a")}
            <br />
            <em>{t("h2.title.b")}</em>
          </h1>
          <p className="lead muted">{t("h2.lead")}</p>
          <div className="row" style={{ marginTop: "1.6rem" }}>
            <Link href="/apply" className="button button-lg">{t("h2.cta")} <ArrowRight size={18} /></Link>
            <Link href="/status" className="button button-ghost button-lg">{t("h2.track")}</Link>
          </div>
          <div className="trust">
            <span><Scale size={15} />{t("h2.trust.1")}</span>
            <span><ShieldCheck size={15} />{t("h2.trust.2")}</span>
            <span><Users size={15} />{t("h2.trust.3")}</span>
          </div>
        </div>

        {/* A picture of the product itself: the checklist and the likely amount. */}
        <div className="preview-stage" aria-hidden>
          <div className="mock">
            <div className="mock-hero">
              <div>
                <small>{t("h2.mock.sub")}</small>
                <strong>{t("h2.mock.title")}</strong>
              </div>
              <div className="mini-ring" style={{ ["--p" as string]: 75 }}><span>6/8</span></div>
            </div>
            <div className="mock-row"><CheckCircle2 size={19} color="var(--ok)" />{t("h2.mock.1")}<span className="tag">✓</span></div>
            <div className="mock-row"><Circle size={19} color="var(--line-strong)" />{t("h2.mock.2")}<span className="tag">PDF</span></div>
            <div className="mock-row"><AlertCircle size={19} color="var(--accent)" />{t("h2.mock.3")}</div>
          </div>
          <div className="float">
            <div className="small muted">{t("h2.mock.likely")}</div>
            <div className="big num">{eur(1040)}</div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>{t("h2.pain.title")}</h2>
        <p className="lead muted">{t("h2.pain.lead")}</p>
        <div className="pain">
          {(["1", "2", "3"] as const).map((n) => (
            <div key={n}><strong>{t(`h2.pain.${n}.k` as const)}</strong><span className="muted">{t(`h2.pain.${n}` as const)}</span></div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>{t("h2.how.title")}</h2>
        <p className="lead muted">{t("h2.how.lead")}</p>
        <div className="steps3">
          {([["1", FileUp], ["2", FileSearch], ["3", Wallet]] as const).map(([n, Icon]) => (
            <div key={n}>
              <span className="si"><Icon size={22} /></span>
              <h3>{t(`home.how.${n}.t` as const)}</h3>
              <p>{t(`home.how.${n}.d` as const)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>{t("h2.tools.title")}</h2>
        <div className="tools" style={{ marginTop: "1.2rem" }}>
          <Link href="/ask">
            <span className="ti"><MessageCircleQuestion size={22} /></span>
            <span><strong>{t("nav.ask")}</strong><br /><span className="muted small">{t("home.tools.ask")}</span></span>
          </Link>
          <Link href="/letter">
            <span className="ti"><FileSearch size={22} /></span>
            <span><strong>{t("nav.letter")}</strong><br /><span className="muted small">{t("home.tools.letter")}</span></span>
          </Link>
        </div>
      </section>

      <section className="cta-band">
        <div>
          <h2>{t("h2.final.title")}</h2>
          <p>{t("h2.final.lead")}</p>
        </div>
        <Link href="/apply" className="btn-hero">{t("h2.cta")} <ArrowRight size={16} /></Link>
      </section>
    </>
  );
}
