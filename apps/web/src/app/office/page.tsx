"use client";

import { NODE_CATALOG, type CaseView, type NodeKind } from "@digieurope/shared";
import { AlertCircle, ArrowRight, CheckCircle2, Clock, FileText, Globe, Search, Send, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner, StatusPill } from "@/components/ui";
import { api, type CaseSummary, type Insights } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

type Tab = "needs" | "waiting" | "decided" | "all";
const TAB_OF: Record<string, Tab> = { submitted: "needs", in_review: "needs", info_requested: "waiting", approved: "decided", rejected: "decided" };
const DAY = 86_400_000;

/** A stable, pleasant colour per person, for the initials avatar. */
function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 45%)`;
}

export default function Inbox() {
  const { t, tk, bi, eur, date, country } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState<CaseSummary[] | null>(null);
  const [ins, setIns] = useState<Insights | null>(null);
  const [sla, setSla] = useState(5);
  const [tab, setTab] = useState<Tab>("needs");
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

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { needs: 0, waiting: 0, decided: 0, all: 0 };
    for (const r of rows ?? []) {
      c[TAB_OF[r.status] ?? "all"] += 1;
      c.all += 1;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => tab === "all" || TAB_OF[r.status] === tab)
      .filter((r) => !term || r.name.toLowerCase().includes(term) || r.reference.toLowerCase().includes(term))
      // Oldest first in the work tabs, so nobody waits longest by accident.
      .sort((a, b) => (tab === "needs" || tab === "waiting" ? (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "") : (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")));
  }, [rows, tab, q]);

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

  return (
    <div>
      <div className="wl-head">
        <div>
          <h1>{t("wl.title")}</h1>
          <p className="num">{t("wl.sub", { open: ins.open, complete: ins.firstTimeComplete, days: ins.medianDaysToDecision ?? "–" })}</p>
        </div>
      </div>

      <div className="wl-tools">
        <div className="seg" role="group">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
              {t(label)} <span className="n">{counts[k]}</span>
            </button>
          ))}
        </div>
        <label className="wl-search">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("wl.search")} aria-label={t("wl.search")} />
        </label>
      </div>

      <div className="wl">
        <div className="wl-list" ref={listRef} role="listbox" aria-label={t("wl.title")}>
          <div className="wl-head-row" aria-hidden>
            <span />
            <span>{t("office.col.name")}</span>
            <span>{t("office.col.stay")}</span>
            <span>{t("office.col.check")}</span>
            <span>{t("office.col.status")}</span>
            <span style={{ textAlign: "right" }}>{t("wl.estimate")}</span>
          </div>
          {shown.length === 0 && <div className="preview-empty"><CheckCircle2 size={28} /><p>{t("wl.empty")}</p></div>}
          {shown.map((r) => {
            const [last, first] = r.name.split(", ");
            return (
              <div
                key={r.id}
                className="wl-row"
                role="option"
                aria-selected={r.id === selected}
                tabIndex={-1}
                onClick={() => setSelected(r.id)}
                onDoubleClick={() => router.push(`/office/cases/${r.id}`)}
              >
                <span className="av" style={{ background: hue(r.name) }} aria-hidden>{(first?.[0] ?? "") + (last?.[0] ?? "")}</span>
                <span className="who">
                  <strong>{first} {last} {r.id === fresh && <span className="badge new">{t("wl.new")}</span>}</strong>
                  <span>{r.reference} · {r.source === "portal" ? t("wl.portal") : t("wl.direct")}</span>
                </span>
                <span className="stay">
                  {country(r.country)}
                  <span>{tk(`stay.${r.stayType}`)}</span>
                </span>
                <span>{r.blockers === 0 ? <span className="badge ok"><CheckCircle2 size={12} />{t("wl.complete")}</span> : <span className="badge bad"><AlertCircle size={12} />{t("wl.open", { n: r.blockers })}</span>}</span>
                <span className={`age ${ageClass(r)}`}>
                  <StatusPill status={r.status} />
                  <span><Clock size={11} /> {t("wl.age", { n: age(r) })}{ageClass(r) === "over" ? ` · ${t("wl.overdue")}` : ageClass(r) === "soon" ? ` · ${t("wl.dueSoon")}` : ""}</span>
                </span>
                <span className="amt">{eur(r.estimateMonthly)}</span>
              </div>
            );
          })}
        </div>

        <aside className="preview" aria-live="polite">
          {!p ? (
            <div className="preview-empty">{t("wl.select")}</div>
          ) : (
            <>
              <div className="preview-head">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="small muted num">{p.reference}</span>
                  <StatusPill status={p.status} />
                </div>
                <h2>{p.student.firstName} {p.student.lastName}</h2>
                <div className="small muted">{p.student.university} · {p.student.course}</div>
              </div>

              <div className="preview-sec">
                <dl className="kv">
                  <dt><Globe size={13} /> {t("office.case.stay")}</dt>
                  <dd>{tk(`stay.${p.stay.type}`)} · {p.stay.city}, {country(p.stay.country)}</dd>
                  <dt />
                  <dd className="small muted">{p.stay.institution} · {date(p.stay.startDate)} – {date(p.stay.endDate)}</dd>
                  <dt><Users size={13} /> {t("wl.team")}</dt>
                  <dd>{p.assignedTeam ?? "–"}</dd>
                  {p.flow?.waiting && (
                    <>
                      <dt>⏸</dt>
                      <dd>{t("wl.waitingAt", { step: bi(NODE_CATALOG[(p.flow.log.find((l) => l.nodeId === p.flow!.waiting)?.kind ?? "human_task") as NodeKind]?.title ?? { de: "", en: "" }) })}</dd>
                    </>
                  )}
                </dl>
              </div>

              <div className="preview-sec">
                <h3>{t("wl.findings")} · {blockers.length}</h3>
                {blockers.length === 0 ? (
                  <div className="mini-finding" style={{ color: "var(--ok)" }}><CheckCircle2 size={16} />{t("office.case.noItems")}</div>
                ) : (
                  blockers.slice(0, 4).map((f) => (
                    <div className="mini-finding" key={f.ruleId}>
                      <AlertCircle size={16} color="var(--bad)" />
                      <span><strong>{bi(f.title)}</strong></span>
                    </div>
                  ))
                )}
              </div>

              <div className="preview-sec">
                <h3>{t("wl.documents")} · {p.documents.length}</h3>
                <div className="doc-dots">
                  {(p.report.requirements ?? []).filter((r) => r.applies && r.type === "document").map((r) => (
                    <span key={r.id} title={bi(r.label)}>
                      {r.state === "ok" ? <CheckCircle2 size={12} color="var(--ok)" /> : <FileText size={12} color={r.required ? "var(--bad)" : "var(--muted)"} />}
                      {bi(r.label).replace(/\s*\(Formblatt \d+\)/, "").slice(0, 22)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="preview-sec">
                <h3>{t("wl.estimate")}</h3>
                <div className="row" style={{ alignItems: "baseline", gap: "0.4rem" }}>
                  <strong className="num" style={{ fontSize: "1.6rem", letterSpacing: "-0.03em" }}>{eur(p.estimate.monthly)}</strong>
                  <span className="small muted">{t("common.perMonth")}</span>
                </div>
                <div className="small muted num">{t("case.estimate.need")} {eur(p.estimate.need)} · {t("case.estimate.parents")} {eur(p.estimate.parentContribution)}</div>
              </div>

              <div className="preview-actions">
                <Link className="button" href={`/office/cases/${p.id}`} style={{ flex: 1 }}>{t("wl.openCase")} <ArrowRight size={16} /></Link>
                {blockers.length > 0 && p.status !== "info_requested" && p.status !== "approved" && p.status !== "rejected" && (
                  <Link className="button button-ghost" href={`/office/cases/${p.id}`} title={t("office.case.request")}><Send size={15} /></Link>
                )}
              </div>
              <div className="kbd" style={{ padding: "0 1.3rem 1rem" }}>{t("wl.keys")}</div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
