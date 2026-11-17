"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

/** A service start page: what it does, how it works, one button. */
export default function Home() {
  const { t } = useI18n();
  return (
    <div className="gv-cols">
      <div className="gv-main">
        <p className="gv-kicker">{t("h2.eyebrow")}</p>
        <h1 className="gv-h1">{t("h2.title.a")} {t("h2.title.b")}</h1>
        <p className="gv-lead">{t("h2.lead")}</p>

        <p>
          <Link href="/apply" className="button gv-start">{t("h2.cta")}<svg aria-hidden width="20" height="16" viewBox="0 0 33 40"><path fill="currentColor" d="M0 0h13l20 20-20 20H0l20-20z" /></svg></Link>
        </p>

        <h2>{t("h2.how.title")}</h2>
        <p>{t("h2.how.lead")}</p>
        <ol className="gv-steps">
          {(["1", "2", "3"] as const).map((n) => (
            <li key={n}>
              <strong>{t(`home.how.${n}.t` as const)}</strong>
              <span>{t(`home.how.${n}.d` as const)}</span>
            </li>
          ))}
        </ol>

        <div className="gv-inset">
          <p><strong>{t("h2.trust.1")}.</strong> {t("home.trust")}</p>
        </div>

        <h2>{t("h2.pain.title")}</h2>
        <ul className="gv-list">
          {(["1", "2", "3"] as const).map((n) => (
            <li key={n}><strong>{t(`h2.pain.${n}.k` as const)}</strong> {t(`h2.pain.${n}` as const)}</li>
          ))}
        </ul>
      </div>

      <aside className="gv-aside" aria-labelledby="related">
        <h2 id="related" className="gv-aside-h">{t("h2.tools.title")}</h2>
        <ul>
          <li><Link href="/status">{t("h2.track")}</Link></li>
          <li><Link href="/ask">{t("nav.ask")}</Link><br /><span className="muted small">{t("home.tools.ask")}</span></li>
          <li><Link href="/letter">{t("nav.letter")}</Link><br /><span className="muted small">{t("home.tools.letter")}</span></li>
          <li><Link href="/samples">{t("footer.samples")}</Link></li>
        </ul>
      </aside>
    </div>
  );
}
