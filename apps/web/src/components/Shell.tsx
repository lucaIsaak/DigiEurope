"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";
import { Spinner } from "./ui";
import type { MessageKey } from "@/lib/messages";

function Nav({ items, current }: { items: [string, MessageKey][]; current: string }) {
  const { t } = useI18n();
  return (
    <nav className="main-nav" aria-label="Main">
      {items.map(([href, key]) => (
        <Link key={href} href={href} aria-current={current === href || (href !== "/" && href !== "/office" && current.startsWith(href)) ? "page" : undefined}>
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}

const STUDENT_NAV: [string, MessageKey][] = [["/", "nav.start"], ["/apply", "nav.apply"], ["/status", "nav.status"], ["/ask", "nav.ask"], ["/letter", "nav.letter"]];
const OFFICE_NAV: [string, MessageKey][] = [["/office", "office.nav.inbox"], ["/office/rules", "office.nav.rules"], ["/office/inputs", "office.nav.inputs"], ["/office/insights", "office.nav.insights"]];

export function Shell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const office = path.startsWith("/office");
  const { staff, loading, logout, canBuild } = useStaff();
  const onLogin = path === "/office/login";
  const bleed = path === "/office/builder";
  const nav: [string, MessageKey][] = office
    ? staff
      ? [...OFFICE_NAV, ...(canBuild ? ([["/office/builder", "office.nav.builder"]] as [string, MessageKey][]) : []), ...(staff.isAdmin ? ([["/office/staff", "office.nav.staff"]] as [string, MessageKey][]) : [])]
      : []
    : STUDENT_NAV;
  useEffect(() => {
    if (office && !onLogin && !loading && !staff) router.replace("/office/login");
  }, [office, onLogin, loading, staff, router]);
  const clicks = useRef<number[]>([]);

  /** Hidden demo reset: press the copyright mark five times quickly, or Shift+Alt+R. */
  async function reset() {
    await api.reset().catch(() => undefined);
    try {
      localStorage.removeItem("ms.myApplications");
    } catch {
      /* ignore */
    }
    router.push("/");
    router.refresh();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.altKey && e.code === "KeyR") void reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = path === "/" ? "/" : path.replace(/\/$/, "");
  return (
    <>
      <header className={`site-header${office ? " office-bar" : ""}`}>
        <div className={`container header-inner${office ? " wide" : ""}`}>
          <Link href={office ? "/office" : "/"} className="brand">
            <span className="brand-mark" aria-hidden>SM</span>
            <span>
              <strong>{t("brand.name")}</strong>
              <small>{office ? t("office.label") : t("brand.sub")}</small>
            </span>
          </Link>
          <Nav items={nav} current={current} />
          {office && (
            <span className="header-user">
              <Link href="/" className="header-link">{t("nav.student")}</Link>
              {staff && (
                <>
                  <span className="user-chip" title={staff.title}>
                    <span className="avatar" aria-hidden>{staff.name.split(" ").pop()?.[0]}</span>
                    <span className="user-name">{staff.name}</span>
                  </span>
                  <button type="button" className="icon-button header-signout" title={t("staff.signOut")} aria-label={t("staff.signOut")} onClick={() => void logout().then(() => router.push("/office/login"))}>
                    <LogOut size={16} />
                  </button>
                </>
              )}
            </span>
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
      <main id="main" className={bleed ? "bleed" : "container page"}>
        {office && !onLogin && !staff ? <div className="container page"><Spinner label={t("common.loading")} /></div> : children}
      </main>
      {!bleed && <footer className="site-footer">
        <div className="container">
          <span>
            <span
              onClick={() => {
                const n = Date.now();
                clicks.current = [...clicks.current.filter((x) => n - x < 2500), n];
                if (clicks.current.length >= 5) {
                  clicks.current = [];
                  void reset();
                }
              }}
            >
              ©
            </span>{" "}
            {t("brand.name")} · {t("footer.note")}
          </span>
          <span className="row" style={{ gap: "1rem" }}>
            <Link href="/samples">{t("footer.samples")}</Link>
            <Link href="/office">{t("staff.footer")}</Link>
          </span>
        </div>
      </footer>}
    </>
  );
}
