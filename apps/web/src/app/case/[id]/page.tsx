"use client";

import { BUILTIN_TEMPLATES, type CaseView, type Finding, type Requirement } from "@digieurope/shared";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  XCircle,
  Circle,
  Copy,
  ExternalLink,
  FileText,
  Flag,
  GraduationCap,
  HelpCircle,
  Inbox as InboxIcon,
  Mail,
  MapPin,
  MessageCircleQuestion,
  Send,
  Upload,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { api, documentUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

type ItemState = "done" | "todo" | "fix" | "note" | "optional";

interface Item {
  key: string;
  group: "student" | "parents" | "third_party" | "office" | "questions";
  name: string;
  why?: string;
  state: ItemState;
  issues: Finding[];
  docId?: string;
  filename?: string;
  req?: Requirement;
}

/** Counts up to a number, gently. Respects reduced motion. */
function useCountUp(value: number) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 700);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}


export default function MyApplication({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, bi, eur, date, dateTime, country, tk } = useI18n();
  const [c, setC] = useState<CaseView | null>(null);
  const [missing, setMissing] = useState(false);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setC(await api.get(id));
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000); // picks up parent uploads and office replies
    return () => clearInterval(timer);
  }, [load]);

  const funding = useCountUp(c?.estimate.monthly ?? 0);

  if (missing) return <p className="error-text">{t("lookup.notFound")}</p>;
  if (!c) return <Spinner label={t("common.loading")} />;

  const editable = c.status === "draft" || c.status === "info_requested";
  const reqs = (c.report.requirements ?? []).filter((r) => r.applies);
  const purpose = (ref: string) => {
    const tpl = BUILTIN_TEMPLATES.find((x) => x.id === ref);
    return tpl ? bi(tpl.purpose) : undefined;
  };
  const docName = (kind: string) => (c.templateNames?.[kind] ? bi(c.templateNames[kind]!) : tk(`doc.${kind}`).startsWith("doc.") ? kind : tk(`doc.${kind}`));

  // ---- Build the checklist ----------------------------------------------------
  const items: Item[] = [];
  for (const r of reqs) {
    if (r.type === "info" && !r.question) {
      if (r.state === "ok") continue; // collected by the form, only shown when missing
    }
    const docs = c.documents.filter((d) => d.kind === r.ref && d.extraction.readable);
    const doc = docs[docs.length - 1];
    const issues = r.type === "document" ? c.report.findings.filter((f) => f.documentKind === r.ref) : c.report.findings.filter((f) => f.ruleId === `INPUT:${r.ref}`);
    const blocking = issues.some((f) => f.severity === "blocker");
    const state: ItemState =
      r.state === "ok" && !blocking ? (issues.length ? "note" : "done") : r.state === "ok" ? "fix" : r.required ? "todo" : "optional";
    items.push({
      key: r.id,
      group: r.type === "info" ? "questions" : r.providedBy === "office" ? "office" : r.providedBy,
      name: r.type === "document" ? docName(r.ref) : bi(r.label),
      why: r.type === "document" ? purpose(r.ref) : r.question?.help ? bi(r.question.help) : undefined,
      state,
      // A missing document needs no extra explanation; issues matter once something was uploaded.
      issues: state === "todo" || state === "optional" ? [] : issues.filter((f) => !f.ruleId.startsWith("INPUT:")),
      docId: doc?.id,
      filename: doc?.filename,
      req: r,
    });
  }
  // Findings not tied to a listed document (duration, early application…) belong to the student.
  const loose = c.report.findings.filter((f) => !f.ruleId.startsWith("INPUT:") && !(f.documentKind && reqs.some((r) => r.ref === f.documentKind)));
  const unreadable = c.documents.filter((d) => !d.extraction.readable);
  const counted = items.filter((i) => i.req?.required);
  const done = counted.filter((i) => i.state === "done" || i.state === "note").length;
  const total = counted.length;
  const blockers = c.report.blockers;

  // ---- Next step --------------------------------------------------------------
  type Next = { label: string; icon: ReactNode; run: () => void; tone?: "accent" };
  const focusItem = (key: string) => {
    setFlash(key);
    document.getElementById(`item-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setFlash(null), 1700);
  };
  let next: Next | null = null;
  let waiting: string | null = null;
  if (editable) {
    const fix = items.find((i) => i.state === "fix");
    const todoMine = items.find((i) => i.state === "todo" && i.group !== "parents" && i.group !== "questions");
    const todoParents = items.find((i) => i.state === "todo" && i.group === "parents");
    const question = items.find((i) => i.state === "todo" && i.group === "questions");
    if (fix) next = { label: t("my.next.fix", { name: fix.name }), icon: <AlertCircle size={18} />, run: () => focusItem(fix.key) };
    else if (todoMine) next = { label: t("my.next.upload", { name: todoMine.name }), icon: <Upload size={18} />, run: () => { focusItem(todoMine.key); fileInput.current?.click(); } };
    else if (todoParents && !c.parentLink) next = { label: t("my.next.invite"), icon: <Users size={18} />, run: () => focusItem("parents-invite") };
    else if (question) next = { label: t("my.next.answer"), icon: <HelpCircle size={18} />, run: () => focusItem(question.key) };
    else if (c.report.ready) next = { label: t("my.next.submit"), icon: <Send size={18} />, tone: "accent", run: () => void submit() };
    if (!next && todoParents && c.parentLink) waiting = t("my.next.waitParents");
  }

  async function upload(files: File[]) {
    setReading(true);
    setError(null);
    const errors: string[] = [];
    for (const file of files) {
      try {
        setC(await api.upload(id, file));
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    try {
      setC(await api.check(id)); // records the first check for the office's insights
    } catch {
      /* the view is already up to date */
    }
    setError(errors.join(" · ") || null);
    setReading(false);
  }
  async function submit() {
    try {
      setC(await api.submit(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ---- Hero copy -----------------------------------------------------------------
  const anyDocs = c.documents.length > 0;
  const remaining = total - done;
  const heroState = c.status === "approved" ? "ready" : c.status === "rejected" ? "rejected" : c.status === "info_requested" ? "info" : editable && c.report.ready && anyDocs ? "ready" : "";
  const title =
    c.status === "approved" ? t("my.state.approved", { amount: eur(c.decision?.monthlyAmount ?? 0) })
    : c.status === "rejected" ? t("my.state.rejected")
    : c.status === "info_requested" ? t("my.state.info")
    : !editable ? t("my.state.office")
    : !anyDocs ? t("my.state.start")
    : c.report.ready ? t("my.state.ready")
    : remaining <= 1 ? t("my.state.left1")
    : t("my.state.left", { n: Math.max(remaining, blockers) });
  const sub =
    c.status === "info_requested" ? c.officeMessage ?? ""
    : c.decision ? t("my.decided.sub", { date: date(c.decision.decidedAt) })
    : !editable ? t("my.state.office.sub")
    : !anyDocs ? t("my.state.start.sub")
    : c.report.ready ? t("my.state.ready.sub")
    : t("my.state.left.sub");

  const stepIdx = c.status === "approved" || c.status === "rejected" ? 4 : !editable ? 3 : c.status === "info_requested" ? 1 : c.report.ready && anyDocs ? 2 : 1;
  const steps: { key: MessageKey; icon: ReactNode }[] = [
    { key: "my.step.details", icon: <User size={15} /> },
    { key: "my.step.documents", icon: <FileText size={15} /> },
    { key: "my.step.ready", icon: <CheckCircle2 size={15} /> },
    { key: "my.step.office", icon: <Building2 size={15} /> },
    { key: "my.step.decision", icon: <Flag size={15} /> },
  ];

  // ---- Budget ---------------------------------------------------------------------
  const e = c.estimate;
  const parentsShare = Math.min(e.need, e.parentContribution);
  const pctParents = e.need ? (parentsShare / e.need) * 100 : 0;

  const groups: { id: Item["group"]; icon: ReactNode }[] = [
    { id: "student", icon: <User size={15} /> },
    { id: "parents", icon: <Users size={15} /> },
    { id: "third_party", icon: <GraduationCap size={15} /> },
    { id: "office", icon: <Building2 size={15} /> },
    { id: "questions", icon: <HelpCircle size={15} /> },
  ];

  const stateIcon = (s: ItemState) =>
    s === "done" ? <CheckCircle2 size={22} /> : s === "fix" ? <AlertCircle size={22} /> : s === "note" ? <AlertCircle size={22} /> : <Circle size={22} />;
  const stateText = (s: ItemState) => t(s === "done" ? "my.item.done" : s === "fix" ? "my.item.fix" : s === "note" ? "my.item.note" : s === "optional" ? "my.item.optional" : "my.item.todo");

  return (
    <div className="my">
      <input ref={fileInput} type="file" multiple accept="application/pdf,image/png,image/jpeg" className="visually-hidden" onChange={(ev) => { const f = [...(ev.target.files ?? [])]; if (f.length) void upload(f); ev.target.value = ""; }} />

      <header className="gv-head" aria-live="polite">
        <p className="gv-kicker">{t("my.kicker", { ref: c.reference })}</p>
        {c.status === "approved" ? (
          <div className="gv-confirm"><h1>{title}</h1><p>{sub}</p></div>
        ) : (
          <>
            <h1 className="gv-h1">{title}</h1>
            <p className="gv-lead">{sub}</p>
          </>
        )}
        <dl className="gv-summary">
          <div><dt>{t("office.case.stay")}</dt><dd>{tk(`stay.${c.stay.type}`)} · {c.stay.city}, {country(c.stay.country)}</dd></div>
          <div><dt>{t("my.dates")}</dt><dd>{date(c.stay.startDate)} – {date(c.stay.endDate)}</dd></div>
          <div><dt>{t("my.status")}</dt><dd>{t("my.stepOf", { n: stepIdx + 1, m: steps.length, name: t(steps[Math.min(stepIdx, steps.length - 1)]!.key) })}</dd></div>
        </dl>
        <div className="row">
          {next && (
            <button type="button" className="button gv-start" onClick={next.run}>
              {next.label}
            </button>
          )}
          {waiting && <span className="gv-inset-inline">{waiting}</span>}
          {c.decision && <Link href="/letter" className="button button-ghost">{t("my.next.letter")}</Link>}
          {reading && <span className="muted"><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> {t("my.reading")}</span>}
        </div>
      </header>

      {error && <p className="banner banner-bad" role="alert" style={{ margin: 0 }}>{error}</p>}

      {c.decision && (
        <section className="panel explain" id="why">
          <div className={`explain-head ${c.decision.outcome === "approved" ? "ok" : "bad"}`}>
            <span className="explain-icon">{c.decision.outcome === "approved" ? <CheckCircle2 size={20} /> : <XCircle size={20} />}</span>
            <div className="grow">
              <h2>{t("xp.why")}</h2>
              <p className="small muted" style={{ margin: 0 }}>{t("my.decided.by", { by: c.decision.decidedBy, date: date(c.decision.decidedAt) })}</p>
            </div>
          </div>
          <div className="explain-body">
            <blockquote className="xp-letter">{c.decision.note}</blockquote>
            <p className="small muted" style={{ margin: "0.75rem 0 0" }}>{t("my.decided.binding")}</p>
          </div>
        </section>
      )}

      <div className="my-grid">
        <section className="panel" aria-labelledby="cl-h">
          <div className="panel-head">
            <h2 id="cl-h">{t("my.checklist")}</h2>
            <p>{t("my.checklist.sub")}</p>
          </div>

          {editable && (
            <label
              className={`drop-strip${over ? " over" : ""}`}
              onDragOver={(ev) => { ev.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(ev) => { ev.preventDefault(); setOver(false); const f = [...ev.dataTransfer.files]; if (f.length) void upload(f); }}
            >
              <span className="ico-big">{reading ? <span className="spinner" /> : <Upload size={20} />}</span>
              <span>
                <strong>{reading ? t("my.reading") : t("my.drop")}</strong>
                <span>{t("my.drop.sub")}</span>
              </span>
              <input type="file" multiple accept="application/pdf,image/png,image/jpeg" className="visually-hidden" onChange={(ev) => { const f = [...(ev.target.files ?? [])]; if (f.length) void upload(f); ev.target.value = ""; }} />
            </label>
          )}

          {groups.map((g) => {
            const list = items.filter((i) => i.group === g.id);
            const extra = g.id === "student" ? loose : [];
            const bad = g.id === "student" ? unreadable : [];
            if (list.length === 0 && extra.length === 0 && bad.length === 0) return null;
            const groupDone = list.filter((i) => i.state === "done" || i.state === "note").length;
            return (
              <div className="cgroup" key={g.id}>
                <div className="cgroup-head">
                  <span className="gi">{g.icon}</span>
                  <h3>{t(`my.group.${g.id}` as MessageKey)}</h3>
                  {list.length > 0 && <span className="count">{groupDone}/{list.length}</span>}
                </div>

                {g.id === "parents" && editable && list.some((i) => i.state !== "done") && (
                  <div className="citem" id="item-parents-invite" style={flash === "parents-invite" ? { background: "var(--accent-soft)" } : undefined}>
                    <span className="st" style={{ color: "var(--primary)" }}><Mail size={20} /></span>
                    <div>
                      {c.parentLink ? (
                        <>
                          <div className="name">{t("my.parents.sent", { email: c.parents.email })}</div>
                          <div className="why">{t("case.parents.simulated")}</div>
                        </>
                      ) : (
                        <>
                          <div className="why" style={{ marginBottom: "0.5rem" }}>{t("my.parents.invite")}</div>
                          <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={async (ev) => { ev.preventDefault(); try { setC(await api.inviteParents(id, email)); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }}>
                            <input type="email" required value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder={t("case.parents.email")} aria-label={t("case.parents.email")} style={{ maxWidth: 280 }} />
                            <button className="mini-btn primary" type="submit"><Send size={14} />{t("case.parents.send")}</button>
                          </form>
                        </>
                      )}
                    </div>
                    {c.parentLink && (
                      <div className="row" style={{ gap: "0.4rem" }}>
                        <button type="button" className="mini-btn" onClick={() => { void navigator.clipboard?.writeText(c.parentLink!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Copy size={14} />{copied ? t("my.parents.copied") : t("my.parents.copy")}</button>
                        <a className="mini-btn" href={c.parentLink} target="_blank" rel="noreferrer"><ExternalLink size={14} />{t("my.parents.open")}</a>
                      </div>
                    )}
                  </div>
                )}

                {list.map((i) => (
                  <div key={i.key} id={`item-${i.key}`} className={`citem ${i.state === "optional" ? "todo" : i.state}${flash === i.key ? " highlight" : ""}`}>
                    <span className="st" aria-hidden>{stateIcon(i.state)}</span>
                    <div>
                      <div className="name">
                        {i.name}
                        {i.req && !i.req.required && <span className="tag">{t("my.item.optional")}</span>}
                      </div>
                      {i.why && i.state !== "done" && <div className="why">{i.why}</div>}
                      {i.filename && <div className="file">{stateText(i.state)} · {i.filename}</div>}
                      {i.issues.map((f) => <div key={f.ruleId} className={`issue${f.severity === "warning" ? " note" : ""}`}>{bi(f.fix)}</div>)}
                      {i.group === "questions" && i.req?.question?.type === "yesno" && (
                        <div className="yn" role="group" aria-label={i.name} style={{ marginTop: "0.5rem" }}>
                          {(["yes", "no"] as const).map((v) => (
                            <button key={v} type="button" aria-pressed={c.info?.[i.req!.ref] === v} disabled={!editable} onClick={async () => setC(await api.setInfo(id, i.req!.ref, v))}>{t(`case.info.${v}` as MessageKey)}</button>
                          ))}
                        </div>
                      )}
                      {i.group === "questions" && i.req?.question && i.req.question.type !== "yesno" && (
                        <input style={{ marginTop: "0.5rem", maxWidth: 280 }} type={i.req.question.type === "number" ? "number" : i.req.question.type === "date" ? "date" : "text"} defaultValue={c.info?.[i.req.ref] ?? ""} disabled={!editable} onBlur={async (ev) => setC(await api.setInfo(id, i.req!.ref, ev.target.value))} />
                      )}
                    </div>
                    <div className="row" style={{ gap: "0.5rem" }}>
                      <strong className={`gv-tag ${i.state}`}>{stateText(i.state)}</strong>
                      {i.docId && <a className="mini-btn" href={documentUrl(i.docId)} target="_blank" rel="noreferrer">{t("my.view")}</a>}
                      {editable && i.req?.type === "document" && i.group !== "parents" && (
                        <button type="button" className={`mini-btn${i.state === "todo" || i.state === "fix" ? " primary" : ""}`} onClick={() => fileInput.current?.click()}>
                          <Upload size={14} />
                          {i.docId ? t("my.replace") : t("my.upload")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {extra.map((f) => (
                  <div key={f.ruleId} className={`citem ${f.severity === "blocker" ? "fix" : "note"}`}>
                    <span className="st"><AlertCircle size={22} /></span>
                    <div>
                      <div className="name">{bi(f.title)}</div>
                      <div className={`issue${f.severity === "warning" ? " note" : ""}`}>{bi(f.fix)}</div>
                    </div>
                    <span />
                  </div>
                ))}
                {bad.map((d) => (
                  <div key={d.id} className="citem fix">
                    <span className="st"><AlertCircle size={22} /></span>
                    <div>
                      <div className="name">{t("my.item.unreadable", { f: d.filename })}</div>
                      <div className="why">{t("case.docs.unreadable")}</div>
                    </div>
                    {editable ? <button type="button" className="mini-btn" onClick={async () => setC(await api.removeDocument(id, d.id))}>{t("case.docs.remove")}</button> : <span />}
                  </div>
                ))}
              </div>
            );
          })}
        </section>

        <aside className="side-stack">
          {(c.outbox ?? []).filter((m) => m.to === "student").slice(-1).map((m) => (
            <div className="mail-card" key={m.id}>
              <div className="row small muted" style={{ justifyContent: "space-between" }}><span><Mail size={13} /> {t("inbox.title")}</span><span>{dateTime(m.at)}</span></div>
              <strong style={{ display: "block", margin: "0.3rem 0" }}>{m.subject}</strong>
              <div className="small" style={{ whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}>{m.body}</div>
            </div>
          ))}

          <section className="panel budget" aria-labelledby="bg-h">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 id="bg-h" style={{ margin: 0, fontSize: "1.05rem" }}>{t("my.budget")}</h2>
              {e.provisional && <span className="tag">{t("my.budget.provisional")}</span>}
            </div>
            <div style={{ marginTop: "0.9rem" }} className="big num">{eur(funding)}<small>{t("my.budget.likely")}</small></div>
            <div className="small muted num">{t("my.budget.range", { low: eur(e.low), high: eur(e.high) })}</div>
            <div className="bar" aria-hidden>
              <div className="p" style={{ width: `${pctParents}%` }} />
              <div className="f" style={{ width: `${100 - pctParents}%` }} />
            </div>
            <div className="legend num">
              <span />
              <span className="muted">{t("my.budget.need")}</span>
              <strong>{eur(e.need)}</strong>
              <i style={{ background: "var(--line-strong)" }} />
              <span className="muted">{t("my.budget.parents")}</span>
              <span>− {eur(parentsShare)}</span>
              <i style={{ background: "var(--accent)" }} />
              <span>{t("my.budget.you")}</span>
              <strong>{eur(Math.max(0, e.need - parentsShare))}</strong>
            </div>
            <div className="once num">
              <span>✈ {t("my.budget.travel")} {eur(e.oneOff.travel)}</span>
              {e.oneOff.tuition > 0 && <span>🎓 {t("my.budget.tuition")} {eur(e.oneOff.tuition)}</span>}
            </div>
            <p className="small muted" style={{ margin: "0.9rem 0 0" }}>{t("my.budget.months", { n: e.months, total: eur(e.monthly * e.months) })}. {t("my.budget.note")}</p>
          </section>

          <section className="panel" aria-labelledby="h-h">
            <div className="panel-head"><h2 id="h-h">{t("my.history")}</h2></div>
            <ul className="tl">
              {[...c.history].reverse().slice(0, 6).map((h, k) => (
                <li key={k}><time>{dateTime(h.at)}</time>{tk(`hist.${h.kind}`)}</li>
              ))}
            </ul>
          </section>

          <section className="panel" aria-labelledby="hp-h">
            <div className="panel-head"><h2 id="hp-h">{t("my.help")}</h2></div>
            <div className="help-links">
              <Link href="/ask"><MessageCircleQuestion size={18} />{t("my.help.ask")}<ArrowRight size={14} style={{ marginLeft: "auto" }} /></Link>
              <Link href="/letter"><FileText size={18} />{t("my.help.letter")}<ArrowRight size={14} style={{ marginLeft: "auto" }} /></Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
