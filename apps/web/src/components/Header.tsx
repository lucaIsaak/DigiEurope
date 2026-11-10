"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export function Header() {
  const { t, lang, setLang } = useI18n();
  const path = usePathname();
  const area = path.startsWith("/caseworker") ? "caseworker" : path.startsWith("/dashboard") ? "dashboard" : "citizen";

  return (
    <>
      <div className="demo-bar" role="note">
        <span>{t("demo.banner")}</span>
        <nav aria-label={t("demo.views")} className="demo-views">
          <Link href="/" aria-current={area === "citizen" ? "page" : undefined}>{t("nav.citizen")}</Link>
          <Link href="/caseworker" aria-current={area === "caseworker" ? "page" : undefined}>{t("nav.caseworker")}</Link>
          <Link href="/dashboard" aria-current={area === "dashboard" ? "page" : undefined}>{t("nav.dashboard")}</Link>
        </nav>
      </div>
      <header className="site-header">
        <div className="container header-inner">
          <Link href={area === "citizen" ? "/" : `/${area}`} className="brand">
            <span className="brand-mark" aria-hidden>DE</span>
            <span>
              <strong>{t("app.municipality")}</strong>
              <small>{area === "citizen" ? t("home.kicker").split("·")[0] : area === "caseworker" ? t("nav.caseworker") : t("nav.dashboard")}</small>
            </span>
          </Link>
          {area === "citizen" && (
            <nav className="main-nav">
              <Link href="/register">{t("nav.register")}</Link>
              <Link href="/status">{t("nav.status")}</Link>
            </nav>
          )}
          <div className="lang-switch" role="group" aria-label={t("lang.label")}>
            {(["de", "en"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>
    </>
  );
}
