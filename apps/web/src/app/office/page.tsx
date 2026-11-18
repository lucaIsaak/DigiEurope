"use client";

import { NODE_CATALOG, type CaseStatus, type CaseView, type NodeKind } from "@digieurope/shared";
import { ArrowRight, Check, Search, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner, StatusChip, StatusDot } from "@/components/ui";
import { api, type CaseSummary, type Insights } from "@/lib/api";
import { useStaff } from "@/lib/staff";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

type Tab = "needs" | "waiting" | "decided" | "all";
const TAB_OF: Record<string, Tab> = { submitted: "needs", in_review: "needs", info_requested: "waiting", approved: "decided", rejected: "decided" };
const DAY = 86_400_000;

export default function Inbox() {
  const { t, tk, bi, eur, date, country } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState<CaseSummary[] | null>(null);
  const [ins, setIns] = useState<Insights | null>(null);
  const [sla, setSla] = useState(5);
  const { staff } = useStaff();
  const [tab, setTab] = useState<Tab>("needs");
  const [scopeChoice, setScopeChoice] = useState<"mine" | "all" | null>(null);
  const scope = scopeChoice ?? (staff?.isCaseworker ? "mine" : "all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<CaseView | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [qr, i] = await Promise.all([api.queue(), api.insights()]);
    setRows(qr);
    setIns(i);
  }, []);

  useEffect(() => {
    void load();
    api.config().then((c) => setSla(c.config.slaDays)).catch(() => undefined);
    const timer = setInterval(() => void load(), 5000);
    // A delivery from the sidebar's demo tools selects the new case.
    const onDelivered = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      void load().then(() => {
        if (id) {
          setTab("all");
          setSelected(id);
          setFresh(id);
        }
      });
    };
    window.addEventListener("ms:delivered", onDelivered);
    const fromUrl = new URLSearchParams(window.location.search).get("case");
    if (fromUrl) {
      setTab("all");
      setSelected(fromUrl);
      setFresh(fromUrl);
    }
    return () => {
      clearInterval(timer);
      window.removeEventListener("ms:delivered", onDelivered);
    };
  }, [load]);

  /** "My cases" are the ones assigned to me, plus cases nobody has yet. */
  const scoped = useMemo(() => (rows ?? []).filter((r) => scope === "all" || !r.assignedTo || r.assignedTo.id === staff?.id), [rows, scope, staff?.id]);
  const mineCount = useMemo(() => (rows ?? []).filter((r) => !r.assignedTo || r.assignedTo.id === staff?.id).length, [rows, staff?.id]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { needs: 0, waiting: 0, decided: 0, all: 0 };
    for (const r of scoped) {
      c[TAB_OF[r.status] ?? "all"] += 1;
      c.all += 1;
    }
    return c;
  }, [scoped]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return scoped
      .filter((r) => tab === "all" || TAB_OF[r.status] === tab)
      .filter((r) => !term || r.name.toLowerCase().includes(term) || r.reference.toLowerCase().includes(term))
      // Oldest first in the work tabs, so nobody waits longest by accident.
      .sort((a, b) => Number(b.failed) - Number(a.failed) || (tab === "needs" || tab === "waiting" ? (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "") : (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")));
  }, [scoped, tab, q]);

  // Keep a selection, and load the preview for it.
  useEffect(() => {
    if (!shown.length) return;
    if (!selected || !shown.some((r) => r.id === selected)) setSelected(shown[0]!.id);
  }, [shown, selected]);
  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    let alive = true;
    api.officeCase(selected).then((c) => alive && setPreview(c)).catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [selected, rows]);

  // Keyboard: up and down move, Enter opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      const i = shown.findIndex((r) => r.id === selected);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const n = shown[Math.min(shown.length - 1, i + 1)];
        if (n) setSelected(n.id);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const n = shown[Math.max(0, i - 1)];
        if (n) setSelected(n.id);
      } else if (e.key === "Enter" && selected) router.push(`/office/cases/${selected}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, selected, router]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!rows || !ins) return <Spinner label={t("common.loading")} />;

  const age = (r: CaseSummary) => (r.submittedAt ? Math.floor((Date.now() - Date.parse(r.submittedAt)) / DAY) : 0);
  const ageClass = (r: CaseSummary) => {
    if (TAB_OF[r.status] !== "needs") return "";
    const a = age(r);
    return a > sla ? "over" : a >= sla - 1 ? "soon" : "";
  };
  const tabs: [Tab, MessageKey][] = [["needs", "wl.tab.needs"], ["waiting", "wl.tab.waiting"], ["decided", "wl.tab.decided"], ["all", "wl.tab.all"]];
  const p = preview;
  const blockers = p?.report.findings.filter((f) => f.severity === "blocker") ?? [];

  const overdue = rows.filter((r) => ageClass(r) === "over").length;
  const initials = (r: CaseSummary) => {
    const [last, first] = r.name.split(", ");
    return `${first?.[0] ?? ""}${last?.[0] ?? ""}`;
  };

  return (
    <div className="q-page">
      <header className="hero">
        <div className="hero-text">
          <h1>{t("wl.title")}</h1>
          <p>{t("wl.lead")}</p>
        </div>
        <dl className="hero-figs">
          <div><dd className="num">{ins.open}</dd><dt>{t("office.kpi.open")}</dt></div>
          <div className={overdue ? "hot" : ""}><dd className="num">{overdue}</dd><dt>{t("wl.overdue")}</dt></div>
          <div><dd className="num">{ins.firstTimeComplete}<small> %</small></dd><dt>{t("office.kpi.complete")}</dt></div>
          <div><dd className="num">{ins.medianDaysToDecision ?? "–"}</dd><dt>{t("office.kpi.days")}</dt></div>
        </dl>
      </header>

      <div className="q-tools">
        <div className="q-tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {t(label)} <span className="n">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="q-tabs q-scope" role="group" aria-label={t("wl.scope")}>
          <button type="button" aria-pressed={scope === "mine"} onClick={() => setScopeChoice("mine")}>{t("wl.scope.mine")} <span className="n">{mineCount}</span></button>
          <button type="button" aria-pressed={scope === "all"} onClick={() => setScopeChoice("all")}>{t("wl.scope.all")} <span className="n">{(rows ?? []).length}</span></button>
        </div>
        <label className="q-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("wl.search")} aria-label={t("wl.search")} />
        </label>
      </div>

      <div className="q-split">
        <div className="q-table sheet" ref={listRef} role="listbox" aria-label={t("wl.title")}>
          <div className="q-row q-th" aria-hidden>
            <span>{t("office.col.name")}</span>
            <span>{t("office.col.stay")}</span>
            <span>{t("wl.documents")}</span>
            <span>{t("office.col.status")}</span>
            <span className="r">{t("wl.col.age")}</span>
            <span className="r">{t("wl.estimate")}</span>
          </div>
          {shown.length === 0 && <div className="q-empty">{t("wl.empty")}</div>}
          {shown.map((r) => {
            const ac = ageClass(r);
            const pct = r.docsTotal ? Math.round((r.docsDone / r.docsTotal) * 100) : 100;
            return (
              <div
                key={r.id}
                className="q-row"
                role="option"
                aria-selected={r.id === selected}
                tabIndex={-1}
                onClick={() => setSelected(r.id)}
                onDoubleClick={() => router.push(`/office/cases/${r.id}`)}
              >
                <span className="who">
                  <i className="av" aria-hidden>{initials(r)}</i>
                  <span>
                    <strong>{r.name.split(", ").reverse().join(" ")}{r.id === fresh && <em className="q-new">{t("wl.new")}</em>}</strong>
                    <small className="num">{r.reference} · {r.source === "portal" ? t("wl.portal") : t("wl.direct")}{r.assignedTo ? ` · ${r.assignedTo.name}` : ""}</small>
                    {r.failed && <span className="q-chip-stopped" title={r.problem ?? ""}>{t("wl.chip.stopped")}</span>}
                  </span>
                </span>
                <span className="two"><strong>{country(r.country)}</strong><small>{tk(`stay.${r.stayType}`)}</small></span>
                <span className="docs">
                  <span className={`prog${r.blockers ? " warn" : " ok"}`} aria-hidden><i style={{ width: `${pct}%` }} /></span>
                  <small className="num">{r.docsDone}/{r.docsTotal}{r.blockers > 0 ? ` · ${t("wl.open", { n: r.blockers })}` : ""}</small>
                </span>
                <span><StatusChip status={r.status as CaseStatus} /></span>
                <span className="r two">
                  <strong className={`num q-age ${ac}`}>{t("wl.age", { n: age(r) })}</strong>
                  {ac === "over" && <small className="over">{t("wl.overdue")}</small>}
                  {ac === "soon" && <small className="soon">{t("wl.dueSoon")}</small>}
                </span>
                <span className="r num amt">{eur(r.estimateMonthly)}</span>
              </div>
            );
          })}
        </div>

        <aside className="q-peek sheet" aria-live="polite">
          {!p ? (
            <div className="q-empty">{t("wl.select")}</div>
          ) : (
            <>
              <div className="q-peek-head">
                <div className="q-peek-ref"><span className="num">{p.reference}</span><StatusDot status={p.status} /></div>
                <h2>{p.student.firstName} {p.student.lastName}</h2>
                <p>{p.student.university} · {p.student.course}</p>
                <div className="q-peek-actions">
                  <Link className="button" href={`/office/cases/${p.id}`}>{t("wl.openCase")} <ArrowRight size={14} /></Link>
                  {blockers.length > 0 && p.status !== "info_requested" && p.status !== "approved" && p.status !== "rejected" && (
                    <Link className="button button-ghost" href={`/office/cases/${p.id}`} title={t("office.case.request")} aria-label={t("office.case.request")}><Send size={14} /></Link>
                  )}
                </div>
              </div>

              <dl className="q-dl">
                <dt>{t("office.case.stay")}</dt>
                <dd>{tk(`stay.${p.stay.type}`)} · {p.stay.city}, {country(p.stay.country)}<small>{p.stay.institution}<br />{date(p.stay.startDate)} – {date(p.stay.endDate)}</small></dd>
                <dt>{t("wl.team")}</dt>
                <dd>{p.assignedTeam ?? "–"}</dd>
                {p.flow?.waiting && (
                  <>
                    <dt>{t("wl.col.waiting")}</dt>
                    <dd>{bi(NODE_CATALOG[(p.flow.log.find((l) => l.nodeId === p.flow!.waiting)?.kind ?? "human_task") as NodeKind]?.title ?? { de: "", en: "" })}</dd>
                  </>
                )}
                <dt>{t("wl.estimate")}</dt>
                <dd className="num"><strong>{eur(p.estimate.monthly)}</strong> {t("common.perMonth")}<small>{t("case.estimate.need")} {eur(p.estimate.need)} · {t("case.estimate.parents")} {eur(p.estimate.parentContribution)}</small></dd>
              </dl>

              <section className="q-sec">
                <h3>{t("wl.findings")} <span className="n">{blockers.length}</span></h3>
                {blockers.length === 0 ? (
                  <p className="q-ok"><Check size={14} />{t("office.case.noItems")}</p>
                ) : (
                  <ul className="q-list">{blockers.slice(0, 4).map((f) => <li key={f.ruleId} className="bad">{bi(f.title)}</li>)}</ul>
                )}
              </section>

              {p.decision && (
                <section className="q-sec">
                  <h3>{t("xp.title")}</h3>
                  <p className="q-clamp">{p.decision.note}</p>
                  <Link className="small" href={`/office/cases/${p.id}#explain`}>{t("xp.open")} →</Link>
                </section>
              )}

              <section className="q-sec">
                <h3>{t("wl.documents")} <span className="n">{p.documents.length}</span></h3>
                <ul className="q-list docs">
                  {(p.report.requirements ?? []).filter((r) => r.applies && r.type === "document").map((r) => (
                    <li key={r.id} className={r.state === "ok" ? "ok" : r.required ? "bad" : "mute"}>{bi(r.label).replace(/\s*\(Formblatt \d+\)/, "")}</li>
                  ))}
                </ul>
              </section>

              <p className="kbd q-keys">{t("wl.keys")}</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
