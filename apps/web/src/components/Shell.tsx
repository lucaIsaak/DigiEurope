"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Check, Clock, FileStack, FlaskConical, FolderTree, Globe, Inbox, KeyRound, LogOut, Moon, RotateCcw, ShieldCheck, SlidersHorizontal, Sun, Workflow, ArrowUpRight, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";
import { useTheme } from "@/lib/theme";
import { Spinner } from "./ui";
import { useTodo } from "./TodoBar";
import { RoleInfo } from "./RoleInfo";
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

type NavItem = { href: string; key: MessageKey; icon: LucideIcon; show: boolean };

/** A small popover menu: closes on outside click and on Escape. */
function Menu({ button, label, children, align = "right" }: { button: ReactNode; label: string; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((v) => !v)}>
        {button}
      </button>
      {open && (
        <div className={`menu-pop ${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Globe button with the language choice. */
function LanguageMenu() {
  const { t, lang, setLang } = useI18n();
  return (
    <Menu label={t("lang.label")} button={<><Globe size={17} /><span className="menu-code">{lang.toUpperCase()}</span></>}>
      {(close) =>
        (["de", "en"] as const).map((l) => (
          <button key={l} type="button" role="menuitemradio" aria-checked={lang === l} onClick={() => { setLang(l); close(); }}>
            <span className="menu-flag">{l.toUpperCase()}</span>
            {l === "de" ? "Deutsch" : "English"}
            {lang === l && <Check size={15} className="menu-check" />}
          </button>
        ))
      }
    </Menu>
  );
}

/** Office app shell: horizontal top bar with navigation, language and the account menu. */
function OfficeShell({ children, current, oversight }: { children: ReactNode; current: string; oversight: boolean }) {
  const { t } = useI18n();
  const { staff, logout, canBuild } = useStaff();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const todo = useTodo();
  const badge: Record<string, number> = oversight || !todo ? {} : {
    "/office/rules": todo.rulesToApprove,
    "/office/templates": todo.proposalsToDecide + todo.templatesToCheck,
    "/office/processes": todo.processDrafts,
  };
  const [busy, setBusy] = useState(false);
  if (!staff) return null;
  const items: NavItem[] = oversight
    ? [{ href: "/oversight", key: "oversight.nav.catalogue", icon: FolderTree, show: true }]
    : [
        { href: "/office", key: "office.nav.inbox", icon: Inbox, show: true },
        { href: "/office/processes", key: "office.nav.builder", icon: Workflow, show: canBuild },
        { href: "/office/templates", key: "office.nav.templates", icon: FileStack, show: canBuild || Boolean(staff.canApproveTemplates) },
        { href: "/office/rules", key: "office.nav.rules", icon: ShieldCheck, show: true },
        { href: "/office/insights", key: "office.nav.insights", icon: BarChart3, show: true },
        { href: "/office/staff", key: "office.nav.staff", icon: KeyRound, show: staff.isAdmin },
        { href: "/office/settings", key: "office.nav.settings", icon: SlidersHorizontal, show: staff.isAdmin || Boolean(staff.canApproveTemplates) },
      ];
  const active = (href: string) => current === href || (href === "/office/processes" && current.startsWith("/office/builder")) || (href !== "/office" && href !== "/oversight" && current.startsWith(href)) || (href === "/office" && current.startsWith("/office/cases"));
  const initials = staff.name.replace(/^(Frau|Herr)\s+/, "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="office-shell">
      <header className="topbar">
        <Link href={oversight ? "/oversight" : "/office"} className="topbar-brand">
          <span className="brand-mark" aria-hidden>SM</span>
          <span>
            <strong>{oversight ? t("oversight.brand") : t("brand.name")}</strong>
            <small>{oversight ? t("oversight.label") : t("office.label")}</small>
          </span>
        </Link>
        <nav className="topbar-nav" aria-label="Main">
          {items.filter((i) => i.show).map((i) => (
            <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined}>
              <i.icon size={16} strokeWidth={2} />
              <span>{t(i.key)}</span>
              {badge[i.href] ? <span className="count" aria-label={`${badge[i.href]}`}>{badge[i.href]}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="topbar-end">
          <LanguageMenu />
          <Menu
            label={t("account.label")}
            button={<span className="avatar" aria-hidden>{initials}</span>}
          >
            {(close) => (
              <>
                <div className="menu-head">
                  <span className="avatar big" aria-hidden>{initials}</span>
                  <span><strong>{staff.name}</strong><small>{staff.title}</small></span>
                </div>
                <div className="menu-sep" />
                <div className="menu-row">
                  <span className="menu-row-label">{theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}{t("account.appearance")}</span>
                  <div className="seg" role="group" aria-label={t("account.appearance")}>
                    <button type="button" aria-pressed={theme === "light"} onClick={() => theme !== "light" && toggle()}><Sun size={14} />{t("theme.lightShort")}</button>
                    <button type="button" aria-pressed={theme === "dark"} onClick={() => theme !== "dark" && toggle()}><Moon size={14} />{t("theme.darkShort")}</button>
                  </div>
                </div>
                <div className="menu-sep" />
                {!oversight && (
                  <>
                    <div className="menu-label"><FlaskConical size={13} />{t("side.demo")}</div>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const s = await api.deliver().catch(() => null);
                        setBusy(false);
                        close();
                        if (s) {
                          router.push(`/office?case=${s.id}`);
                          window.dispatchEvent(new CustomEvent("ms:delivered", { detail: s.id }));
                        }
                      }}
                    >
                      <Zap size={15} />{t("side.deliver")}
                    </button>
                    <button type="button" role="menuitem" onClick={async () => { close(); await api.advanceClock(7).catch(() => undefined); router.refresh(); window.dispatchEvent(new CustomEvent("ms:delivered", { detail: "" })); }}>
                      <Clock size={15} />{t("side.skip")}
                    </button>
                    <button type="button" role="menuitem" onClick={async () => { close(); await api.reset().catch(() => undefined); router.refresh(); window.dispatchEvent(new CustomEvent("ms:delivered", { detail: "" })); }}>
                      <RotateCcw size={15} />{t("side.reset")}
                    </button>
                    <div className="menu-sep" />
                  </>
                )}
                <Link href="/" role="menuitem" onClick={close}><ArrowUpRight size={15} />{t("nav.student")}</Link>
                <button type="button" role="menuitem" onClick={() => { close(); void logout().then(() => router.push("/office/login")); }}>
                  <LogOut size={15} />{t("staff.signOut")}
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>
      <main id="main" className="office-main">{children}</main>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
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
      ? [...OFFICE_NAV, ...(canBuild || staff.canApproveTemplates ? ([["/office/templates", "office.nav.templates"]] as [string, MessageKey][]) : []), ...(canBuild ? ([["/office/processes", "office.nav.builder"]] as [string, MessageKey][]) : []), ...(staff.isAdmin ? ([["/office/staff", "office.nav.staff"]] as [string, MessageKey][]) : [])]
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
  const siteFooter = <footer className="site-footer">
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
      </footer>;
  if (onLogin) return <div className="login-shell"><main id="main">{children}</main>{siteFooter}</div>;
  if (office && !onLogin && staff) {
    return (
      <OfficeShell current={current} oversight={oversightArea}>
        {bleed ? (
          <>
            <div className="roleinfo-float"><RoleInfo path={current} /></div>
            {children}
          </>
        ) : (
          <div className="office-page">
            {!current.startsWith("/office/cases") && <RoleInfo path={current} inline />}
            {children}
          </div>
        )}
      </OfficeShell>
    );
  }
  return (
    <div>
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
          <LanguageMenu />
        </div>
      </header>
      <main id="main" className={bleed ? "bleed" : "container page"}>
        {office && !onLogin && !staff ? <div className="container page"><Spinner label={t("common.loading")} /></div> : children}
      </main>
      {!bleed && siteFooter}
    </div>
  );
}
