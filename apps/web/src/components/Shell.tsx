"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, FileStack, FlaskConical, FolderTree, Inbox, KeyRound, LogOut, Moon, RotateCcw, ShieldCheck, SlidersHorizontal, Sun, Workflow, ArrowUpRight, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";
import { useTheme } from "@/lib/theme";
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

const STUDENT_NAV: [string, MessageKey][] = [["/", "nav.start"], ["/status", "nav.status"], ["/ask", "nav.ask"], ["/letter", "nav.letter"]];
const OFFICE_NAV: [string, MessageKey][] = [["/office", "office.nav.inbox"], ["/office/rules", "office.nav.rules"], ["/office/inputs", "office.nav.inputs"], ["/office/insights", "office.nav.insights"]];

type SideItem = { href: string; key: MessageKey; icon: LucideIcon; show: boolean };

/** Office app shell: grouped sidebar navigation, demo tools and account at the bottom. */
function OfficeShell({ children, current, oversight }: { children: ReactNode; current: string; oversight: boolean }) {
  const { t, lang, setLang } = useI18n();
  const { staff, logout, canBuild } = useStaff();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const [demoOpen, setDemoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!staff) return null;
  const groups: { label: MessageKey; items: SideItem[] }[] = oversight
    ? [{ label: "side.oversight", items: [{ href: "/oversight", key: "oversight.nav.catalogue", icon: FolderTree, show: true }] }]
    : [
        { label: "side.work", items: [{ href: "/office", key: "office.nav.inbox", icon: Inbox, show: true }] },
        {
          label: "side.configure",
          items: [
            { href: "/office/builder", key: "office.nav.builder", icon: Workflow, show: canBuild },
            { href: "/office/templates", key: "office.nav.templates", icon: FileStack, show: canBuild || Boolean(staff.canApproveTemplates) },
            { href: "/office/rules", key: "office.nav.rules", icon: ShieldCheck, show: true },
            { href: "/office/inputs", key: "office.nav.inputs", icon: SlidersHorizontal, show: true },
          ],
        },
        { label: "side.analyse", items: [{ href: "/office/insights", key: "office.nav.insights", icon: BarChart3, show: true }] },
        { label: "side.admin", items: [{ href: "/office/staff", key: "office.nav.staff", icon: KeyRound, show: staff.isAdmin }] },
      ];
  const active = (href: string) => current === href || (href !== "/office" && href !== "/oversight" && current.startsWith(href)) || (href === "/office" && current.startsWith("/office/cases"));
  return (
    <div className="office-shell">
      <aside className="side">
        <Link href={oversight ? "/oversight" : "/office"} className="side-brand">
          <span className="brand-mark" aria-hidden>SM</span>
          <span>
            <strong>{oversight ? t("oversight.brand") : t("brand.name")}</strong>
            <small>{oversight ? t("oversight.label") : t("office.label")}</small>
          </span>
        </Link>
        <nav className="side-nav" aria-label="Main">
          {groups.map((g) => {
            const items = g.items.filter((i) => i.show);
            if (items.length === 0) return null;
            return (
              <div key={g.label}>
                <div className="side-label">{t(g.label)}</div>
                {items.map((i) => (
                  <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined}>
                    <i.icon size={17} strokeWidth={2} />
                    {t(i.key)}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          {!oversight && (
            <div className="side-demo">
              <button type="button" className="side-row" onClick={() => setDemoOpen((v) => !v)} aria-expanded={demoOpen}>
                <FlaskConical size={16} />
                {t("side.demo")}
              </button>
              {demoOpen && (
                <div className="side-demo-menu">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const s = await api.deliver().catch(() => null);
                      setBusy(false);
                      if (s) {
                        router.push(`/office?case=${s.id}`);
                        window.dispatchEvent(new CustomEvent("ms:delivered", { detail: s.id }));
                      }
                    }}
                  >
                    <Zap size={15} />
                    {t("side.deliver")}
                  </button>
                  <button type="button" onClick={async () => { await api.reset().catch(() => undefined); router.refresh(); window.dispatchEvent(new CustomEvent("ms:delivered", { detail: "" })); }}>
                    <RotateCcw size={15} />
                    {t("side.reset")}
                  </button>
                </div>
              )}
            </div>
          )}
          <Link href="/" className="side-row"><ArrowUpRight size={16} />{t("nav.student")}</Link>
          <div className="side-row side-prefs">
            <button type="button" className="icon-button" onClick={toggle} title={theme === "dark" ? t("theme.light") : t("theme.dark")} aria-label={theme === "dark" ? t("theme.light") : t("theme.dark")}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="lang-switch" role="group" aria-label={t("lang.label")}>
              {(["de", "en"] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div className="side-user">
            <span className="avatar" aria-hidden>{staff.name.split(" ").pop()?.[0]}</span>
            <span className="who"><strong>{staff.name}</strong><small>{staff.title}</small></span>
            <button type="button" className="icon-button" title={t("staff.signOut")} aria-label={t("staff.signOut")} onClick={() => void logout().then(() => router.push("/office/login"))}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main id="main" className="office-main">{children}</main>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const oversightArea = path.startsWith("/oversight");
  const office = path.startsWith("/office") || oversightArea;
  const { staff, loading, logout, canBuild } = useStaff();
  const { theme, toggle } = useTheme();
  const onLogin = path === "/office/login";
  const bleed = path === "/office/builder";
  const nav: [string, MessageKey][] = office
    ? staff?.isOversight
      ? [["/oversight", "oversight.nav.catalogue"]]
      : staff
      ? [...OFFICE_NAV, ...(canBuild || staff.canApproveTemplates ? ([["/office/templates", "office.nav.templates"]] as [string, MessageKey][]) : []), ...(canBuild ? ([["/office/builder", "office.nav.builder"]] as [string, MessageKey][]) : []), ...(staff.isAdmin ? ([["/office/staff", "office.nav.staff"]] as [string, MessageKey][]) : [])]
      : []
    : STUDENT_NAV;
  useEffect(() => {
    if (!office || onLogin || loading) return;
    if (!staff) router.replace("/office/login");
    else if (staff.isOversight && !oversightArea) router.replace("/oversight");
    else if (!staff.isOversight && oversightArea) router.replace("/office");
  }, [office, onLogin, loading, staff, router, oversightArea]);
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
  if (onLogin) return <main id="main">{children}</main>;
  if (office && !onLogin && staff) {
    return (
      <OfficeShell current={current} oversight={oversightArea}>
        {bleed ? children : <div className="office-page">{children}</div>}
      </OfficeShell>
    );
  }
  return (
    <>
      <header className={`site-header${office ? " office-bar" : ""}`}>
        <div className={`container header-inner${office ? " wide" : ""}`}>
          <Link href={oversightArea ? "/oversight" : office ? "/office" : "/"} className="brand">
            <span className="brand-mark" aria-hidden>SM</span>
            <span>
              <strong>{oversightArea ? t("oversight.brand") : t("brand.name")}</strong>
              <small>{oversightArea ? t("oversight.label") : office ? t("office.label") : t("brand.sub")}</small>
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
          {!office && <Link href="/apply" className="button button-small header-cta">{t("nav.cta")}</Link>}
          <button type="button" className="icon-button theme-toggle" onClick={toggle} title={theme === "dark" ? t("theme.light") : t("theme.dark")} aria-label={theme === "dark" ? t("theme.light") : t("theme.dark")}>
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
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
