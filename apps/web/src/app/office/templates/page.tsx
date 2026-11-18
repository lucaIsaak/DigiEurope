"use client";

import type { TemplateCategory, TemplateField, TemplateProposal } from "@digieurope/shared";
import {
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  FileStack,
  FileText,
  GraduationCap,
  Lock,
  Plus,
  Search,
  ShieldPlus,
  Upload,
  User,
  Users,
  Wallet,
  Workflow,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TodoBar, refreshTodo, useTodo, type TodoItem } from "@/components/TodoBar";
import { DropZone, Field, Spinner, useAsyncError } from "@/components/ui";
import { api, sampleUrl, type LibraryTemplate, type MethodInfo, type ProposalBody, type TemplateLibrary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { useStaff } from "@/lib/staff";

const CATS: { id: TemplateCategory; icon: LucideIcon }[] = [
  { id: "official_form", icon: FileText },
  { id: "study", icon: GraduationCap },
  { id: "work", icon: Briefcase },
  { id: "money", icon: Wallet },
  { id: "insurance", icon: ShieldPlus },
  { id: "office", icon: Building2 },
];
const catIcon = (c: TemplateCategory) => CATS.find((x) => x.id === c)?.icon ?? FileText;
const PROVIDER_ICON: Record<string, LucideIcon> = { student: User, parents: Users, third_party: GraduationCap, office: Building2 };

const slug = (s: string) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "feld";
const TYPES = ["text", "number", "date", "yesno"] as const;
const EMPTY: ProposalBody = { name: "", formblatt: "", title: "", purpose: "", providedBy: "student", category: "official_form", fields: [], signatures: [] };

/** What the template actually contains: its real field names and signatures (no made-up form picture). */
/** Labels in the language of the screen, when the template has an English version. */
const fieldLabel = (tpl: { en?: { fields: Record<string, string> } }, key: string, label: string, lang: string) => (lang === "en" ? tpl.en?.fields[key] ?? label : label);
const sigLabel = (tpl: { en?: { signatures: Record<string, string> } }, key: string, label: string, lang: string) => (lang === "en" ? tpl.en?.signatures[key] ?? label : label);
const printedTitle = (tpl: { title: string; en?: { title: string } }, lang: string) => (lang === "en" ? tpl.en?.title ?? tpl.title : tpl.title);

function Contents({ tpl, lang }: { tpl: LibraryTemplate; lang: string }) {
  const shown = tpl.fields.slice(0, 5);
  const more = tpl.fields.length - shown.length;
  return (
    <span className="contents">
      <span className="contents-n"><b>{tpl.fields.length}</b> fields{tpl.signatures.length > 0 ? ` · ${tpl.signatures.length} signature${tpl.signatures.length > 1 ? "s" : ""}` : ""}</span>
      <span className="contents-l">{shown.map((f) => <span key={f.key}>{fieldLabel(tpl, f.key, f.label, lang)}</span>)}{more > 0 && <span className="more">+{more} more</span>}</span>
    </span>
  );
}

export default function Templates() {
  const { t, tk, bi, date, dateTime, lang } = useI18n();
  const { staff } = useStaff();
  const todo = useTodo();
  const [lib, setLib] = useState<TemplateLibrary | null>(null);
  const [methods, setMethods] = useState<MethodInfo[]>([]);
  const [tab, setTab] = useState<"library" | "proposals">("library");
  const [cat, setCat] = useState<TemplateCategory | "all">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { error, setError, run } = useAsyncError();

  const load = useCallback(async () => {
    setLib(await api.templates());
    setMethods((await api.extraction()).methods);
    refreshTodo();
  }, []);
  useEffect(() => {
    load().catch(() => setLib({ templates: [], proposals: [], canApprove: false, canPropose: false }));
    const p = new URLSearchParams(window.location.search);
    if (p.get("new")) setTab("proposals");
    if (p.get("open")) setOpen(p.get("open"));
  }, [load]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (lib?.templates ?? []).filter((x) => (cat === "all" || x.category === cat) && (!term || bi(x.name).toLowerCase().includes(term) || (x.formblatt ?? "").toLowerCase().includes(term)));
  }, [lib, cat, q, bi]);

  if (!lib) return <Spinner label={t("common.loading")} />;
  if (!lib.canApprove && !lib.canPropose) return <p className="banner banner-warn">{t("prop.noAccess")}</p>;

  const todoItems: TodoItem[] = [];
  if (todo?.proposalsToDecide) todoItems.push({ key: "p", text: t("todo.proposals", { n: todo.proposalsToDecide }), onClick: () => setTab("proposals") });
  if (todo?.templatesToCheck) todoItems.push({ key: "c", text: t("todo.checks", { n: todo.templatesToCheck }), onClick: () => { setTab("library"); const first = lib.templates.find((x) => !x.check && (x.source === "accepted" || x.usedIn.length)); if (first) setOpen(first.id); } });
  if (todo?.myProposals) todoItems.push({ key: "m", text: t("todo.myProposals", { n: todo.myProposals }), tone: "info", onClick: () => setTab("proposals") });
  const current = lib.templates.find((x) => x.id === open) ?? null;

  return (
    <div>
      <header className="hero">
        <div className="hero-text">
          <h1>{t("t2.title")}</h1>
          <p>{t("t2.lead")}</p>
        </div>
        <div className="hero-actions">
          <dl className="hero-figs">
            <div><dd className="num">{lib.templates.length}</dd><dt>{t("t2.fig.total")}</dt></div>
            <div><dd className="num">{lib.templates.filter((x) => x.check).length}</dd><dt>{t("t2.status.ready")}</dt></div>
            <div><dd className="num">{lib.proposals.filter((p) => p.status === "submitted").length}</dd><dt>{t("t2.fig.proposals")}</dt></div>
          </dl>
          {lib.canPropose && <button className="button" type="button" onClick={() => setTab("proposals")}><Plus size={16} />{t("tpl.new")}</button>}
        </div>
      </header>
      <TodoBar items={todoItems} />

      <div className="tabs" role="tablist" style={{ marginBottom: "1.2rem" }}>
        {(["library", "proposals"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(`tpl.tab.${k}` as MessageKey)}{k === "proposals" ? ` (${lib.proposals.filter((p) => p.status === "submitted").length})` : ` (${lib.templates.length})`}
          </button>
        ))}
      </div>

      {tab === "library" && (
        <>
          <div className="q-tools">
            <div className="q-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={cat === "all"} onClick={() => setCat("all")}>{t("t2.cat.all")} <span className="n">{lib.templates.length}</span></button>
              {CATS.map((c) => (
                <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)}>
                  {t(`t2.cat.${c.id}` as MessageKey)} <span className="n">{lib.templates.filter((x) => x.category === c.id).length}</span>
                </button>
              ))}
            </div>
            <label className="q-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("t2.search")} aria-label={t("t2.search")} /></label>
          </div>
          {CATS.map((c) => {
            const items = shown.filter((x) => x.category === c.id);
            if (items.length === 0) return null;
            const CIcon = c.icon;
            const ready = items.filter((x) => x.check).length;
            return (
              <section key={c.id} className={`shelf cat-${c.id}`} aria-labelledby={`cat-${c.id}`}>
                <header className="shelf-h">
                  <span className="shelf-ico"><CIcon size={18} /></span>
                  <div>
                    <h2 id={`cat-${c.id}`}>{t(`t2.cat.${c.id}` as MessageKey)}</h2>
                    <p>{t(`t2.catdesc.${c.id}` as MessageKey)}</p>
                  </div>
                  <span className="shelf-n">{t("t2.sectionCount", { n: items.length, r: ready })}</span>
                </header>
                <div className="tl" role="listbox">
                  {items.map((x) => {
                    const P = PROVIDER_ICON[x.providedBy] ?? User;
                    return (
                      <button key={x.id} type="button" role="option" className="tl-row" aria-selected={open === x.id} onClick={() => setOpen(x.id)}>
                        <span className="tl-ico"><CIcon size={15} /></span>
                        <span className="tl-name">{bi(x.name).replace(/\s*\(Formblatt \d+\)/, "")}</span>
                        <span className="tl-meta"><P size={13} />{t(`tpl.by.${x.providedBy}` as MessageKey)}{x.formblatt ? ` · ${x.formblatt}` : ""}</span>
                        <span className="tl-n">{x.fields.length} fields</span>
                        <span className="tl-use">{x.usedIn.length === 0 ? t("t2.unused") : x.usedIn.length === 1 ? t("t2.usedIn1") : t("t2.usedIn", { n: x.usedIn.length })}</span>
                        <span className={`chip ${x.check ? "ok" : "warn"}`}>{x.check ? t("t2.status.ready") : t("t2.status.check")}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {shown.length === 0 && <p className="muted" style={{ padding: "2rem 0" }}>{t("todo.none")}</p>}
          <p className="small muted" style={{ marginTop: "1rem" }}>{t("tpl.exampleNote")}</p>
        </>
      )}

      {tab === "proposals" && <Proposals lib={lib} methods={methods} me={staff?.name ?? ""} reload={load} />}

      {current && (
        <TemplateDrawer
          tpl={current}
          lib={lib}
          methods={methods}
          onClose={() => setOpen(null)}
          reload={load}
          run={run}
          error={error}
          setError={setError}
          date={date}
          dateTime={dateTime}
          tk={tk}
        />
      )}
    </div>
  );
}

function TemplateDrawer(props: {
  tpl: LibraryTemplate;
  lib: TemplateLibrary;
  methods: MethodInfo[];
  onClose: () => void;
  reload: () => Promise<void>;
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  error: string | null;
  setError: (e: string | null) => void;
  date: (iso?: string) => string;
  dateTime: (iso?: string) => string;
  tk: (k: string, p?: Record<string, string | number>) => string;
}) {
  const { t, bi, lang } = useI18n();
  const { tpl, lib, run } = props;
  const [tab, setTab] = useState<"overview" | "reading" | "check" | "history">(tpl.check ? "overview" : "check");
  const [result, setResult] = useState<{ matches: boolean; kind: string; fields: Record<string, string>; confidence?: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const Icon = catIcon(tpl.category);
  const owner = lib.canApprove;

  async function test(file: File) {
    setBusy(true);
    props.setError(null);
    const r = await run(() => api.testTemplate(tpl.id, file));
    if (r) setResult({ matches: r.matches, kind: r.kind, fields: r.extraction.fields, confidence: r.extraction.confidence });
    setBusy(false);
  }
  async function loadSample() {
    const list = await api.samples(lang);
    const all = list.sets.flatMap((s) => [...s.docs.map((d) => ({ set: s.id, folder: "docs" as "docs" | "extras", ...d })), ...(s.extras ?? []).map((d) => ({ set: s.id, folder: "extras" as "docs" | "extras", ...d }))]);
    // A sample of exactly this template; the decision letter and accepted proposals have their own sample files.
    const hit = all.find((d) => d.kind === tpl.id);
    const url = hit ? sampleUrl(hit.set, hit.folder as "docs", hit.name, lang) : tpl.id === "decision_letter" ? sampleUrl("letter", "docs", list.letter) : sampleUrl("proposal", "docs", list.proposal, lang);
    const blob = await (await fetch(url)).blob();
    await test(new File([blob], hit?.name ?? "sample.pdf", { type: "application/pdf" }));
  }

  const readCount = result ? tpl.fields.filter((f) => (result.fields[f.key] ?? "").trim() !== "").length : 0;
  const tabs: ["overview" | "reading" | "check" | "history", MessageKey][] = [["overview", "t2.tab.overview"], ["reading", "t2.tab.reading"], ["check", "t2.tab.check"], ["history", "t2.tab.history"]];

  return (
    <>
      <div className="drawer-bg" onClick={props.onClose} />
      <aside className={`drawer cat-${tpl.category}`} role="dialog" aria-label={bi(tpl.name)}>
        <div className="drawer-head">
          <div className="row">
            <div className="tpl-top">
              <span className="tpl-ico"><Icon size={20} /></span>
              <span>
                <small style={{ color: "var(--cc)", fontWeight: 650, fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t(`t2.cat.${tpl.category}` as MessageKey)}{tpl.formblatt ? ` · ${tpl.formblatt}` : ""}</small>
                <h2 style={{ margin: "0.15rem 0 0", fontSize: "1.25rem" }}>{bi(tpl.name)}</h2>
              </span>
            </div>
            <button type="button" className="icon-button" aria-label={t("t2.close")} onClick={props.onClose}><X size={18} /></button>
          </div>
          <div className="tpl-meta" style={{ marginTop: "0.8rem" }}>
            {tpl.check ? <span className="ok"><CheckCircle2 size={12} />{t("t2.status.ready")}</span> : <span className="warn"><Clock size={12} />{t("t2.status.check")}</span>}
            <span>{tpl.source === "builtin" ? t("tpl.builtin") : t("tpl.accepted")}</span>
            {tpl.usedIn.map((u) => <span key={u.catalogId}><Workflow size={12} />{u.name}</span>)}
          </div>
        </div>
        <div className="tabs" role="tablist">
          {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(label)}</button>)}
        </div>
        <div className="drawer-body">
          {tab === "overview" && (
            <>
              <p style={{ margin: 0 }}>{bi(tpl.purpose)}</p>
              <p className="small muted" style={{ margin: 0 }}>{t("tpl.printedTitle")}: <em>{printedTitle(tpl, lang)}</em> · {t("t2.from")}: {t(`tpl.by.${tpl.providedBy}` as MessageKey)}</p>
              <div>
                <h3>{t("t2.fields")} · {tpl.fields.length}</h3>
                <div className="formview">
                  <div className="formview-title">{printedTitle(tpl, lang)}</div>
                  {tpl.fields.map((f) => (
                    <div className="fv-field" key={f.key}>
                      <span className="fv-label">{fieldLabel(tpl, f.key, f.label, lang)}{f.required && <b title={t("t2.required")}> *</b>}</span>
                      <span className="fv-input">{t(`prop.type.${f.type}` as MessageKey)}</span>
                    </div>
                  ))}
                  {tpl.signatures.map((sg) => <div className="fv-sig" key={sg.key}><span>{sigLabel(tpl, sg.key, sg.label, lang)}</span></div>)}
                </div>
              </div>
            </>
          )}

          {tab === "reading" && (
            <>
              <p className="small muted" style={{ margin: 0 }}>{t("t2.reading.lead")}</p>
              <fieldset disabled={!owner} className={owner ? "" : "locked"} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: "0.8rem" }}>
                <label className="field">{t("read.method")}
                  <select value={tpl.extraction.method} onChange={async (e) => { await run(() => api.setExtraction(tpl.id, e.target.value as MethodInfo["id"], tpl.extraction.minConfidence)); await props.reload(); }}>
                    {props.methods.map((m) => <option key={m.id} value={m.id}>{bi(m.name)} · {t(`read.status.${m.status}` as MessageKey)}</option>)}
                  </select>
                </label>
                <label className="field">{t("read.minConfidence")}
                  <select value={String(tpl.extraction.minConfidence)} onChange={async (e) => { await run(() => api.setExtraction(tpl.id, tpl.extraction.method, Number(e.target.value))); await props.reload(); }}>
                    {[0.6, 0.7, 0.8, 0.9, 0.95].map((v) => <option key={v} value={v}>{Math.round(v * 100)} %</option>)}
                  </select>
                </label>
              </fieldset>
              {!owner && <span className="reason"><Lock size={13} />{t("t2.reading.owner")}</span>}
              <p className="small muted">{bi(props.methods.find((m) => m.id === tpl.extraction.method)?.description ?? { de: "", en: "" })}</p>
            </>
          )}

          {tab === "check" && (
            <>
              <p className="small muted" style={{ margin: 0 }}>{t("t2.check.lead")}</p>
              {tpl.check && <p className="banner banner-ok small" style={{ margin: 0 }}><CheckCircle2 size={14} style={{ verticalAlign: "-2px" }} /> {t("t2.check.done", { by: tpl.check.confirmedBy, date: props.date(tpl.check.confirmedAt) })}</p>}
              <DropZone label={t("office.inputs.choose")} multiple={false} accept="application/pdf" busy={busy} busyLabel={t("case.docs.reading")} onFiles={(f) => void test(f[0]!)} />
              <button type="button" className="button button-ghost button-small" style={{ justifySelf: "start" }} onClick={() => void loadSample()}><Upload size={14} />{t("office.inputs.load")}</button>
              {result && (
                <div className="stack" style={{ gap: "0.6rem" }}>
                  {!result.matches ? (
                    <p className="banner banner-bad small" style={{ margin: 0 }}><XCircle size={14} style={{ verticalAlign: "-2px" }} /> {t("t2.check.wrong", { kind: props.tk(`doc.${result.kind}`) })}</p>
                  ) : (
                    <>
                      <strong>{t("t2.check.result", { n: readCount, m: tpl.fields.length })}</strong>
                      <table className="ftable">
                        <tbody>
                          {tpl.fields.map((f) => (
                            <tr key={f.key}>
                              <td>{fieldLabel(tpl, f.key, f.label, lang)}<br /><strong style={{ fontWeight: 600 }}>{result.fields[f.key] || "–"}</strong></td>
                              <td>{result.confidence?.[f.key] !== undefined ? <span className={`conf${(result.confidence[f.key] ?? 0) < tpl.extraction.minConfidence ? " low" : ""}`}>{Math.round((result.confidence[f.key] ?? 0) * 100)} %</span> : "–"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {owner ? (
                        <button type="button" className="button" onClick={async () => { const r = await run(() => api.confirmTemplate(tpl.id)); if (r) { await props.reload(); setTab("overview"); } }}>
                          <CheckCircle2 size={16} />{tpl.check ? t("t2.check.again") : t("t2.check.confirm")}
                        </button>
                      ) : (
                        <span className="reason"><Lock size={13} />{t("t2.check.owner")}</span>
                      )}
                    </>
                  )}
                </div>
              )}
              {props.error && <p className="error-text" role="alert">{props.error}</p>}
            </>
          )}

          {tab === "history" && (
            tpl.log.length === 0 ? <p className="small muted">{t("t2.history.empty")}</p> : (
              <ul className="hist">
                {tpl.log.map((l, i) => <li key={i}><span className="small muted" style={{ minWidth: 110 }}>{props.dateTime(l.at)}</span><span style={{ flex: 1 }}>{l.text}<br /><span className="small muted">{l.by}</span></span></li>)}
              </ul>
            )
          )}
        </div>
      </aside>
    </>
  );
}

function Proposals({ lib, methods, me, reload }: { lib: TemplateLibrary; methods: MethodInfo[]; me: string; reload: () => Promise<void> }) {
  const { t, bi, date } = useI18n();
  const [editing, setEditing] = useState<string | "new" | null>(new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("new") ? "new" : null);
  const [form, setForm] = useState<ProposalBody>(EMPTY);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<{ id: string; kind: "accept" | "reject" } | null>(null);
  const [method, setMethod] = useState<MethodInfo["id"]>("builtin");
  const [minConf, setMinConf] = useState(0.8);
  const [comment, setComment] = useState("");
  const { error, setError, run } = useAsyncError();

  const startEdit = (p: TemplateProposal) => {
    setForm({ name: p.name, formblatt: p.formblatt ?? "", title: p.title, purpose: p.purpose, providedBy: p.providedBy, category: p.category ?? "official_form", fields: p.fields, signatures: p.signatures, sampleFilename: p.sampleFilename });
    setSuggested(null);
    setError(null);
    setEditing(p.id);
  };
  async function suggest(files: File[]) {
    setBusy(true);
    const r = await run(() => api.suggestTemplate(files[0]!));
    if (r) {
      setForm((f) => ({ ...f, title: f.title || r.title, name: f.name || r.title.replace(/^Formblatt \d+:\s*/i, "").slice(0, 80), formblatt: f.formblatt || (r.title.match(/^Formblatt \d+/)?.[0] ?? ""), fields: r.fields, signatures: r.signatures, sampleFilename: r.sampleFilename }));
      setSuggested(r.sampleFilename);
    }
    setBusy(false);
  }
  async function save(submit: boolean) {
    const r = await run(() => api.saveProposal({ ...form, submit }, editing && editing !== "new" ? editing : undefined));
    if (r) {
      setEditing(null);
      setForm(EMPTY);
      await reload();
    }
  }
  const setField = (i: number, patch: Partial<TemplateField>) => setForm((f) => ({ ...f, fields: f.fields.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
  const statusPill = (s: TemplateProposal["status"]) => <span className={`badge ${s === "accepted" ? "ok" : s === "rejected" ? "bad" : s === "submitted" ? "warn" : "muted"}`}>{t(`prop.status.${s}` as MessageKey)}</span>;

  return (
    <div className="stack">
      {!editing && lib.canPropose && (
        <button type="button" className="button button-ghost" style={{ justifySelf: "start" }} onClick={() => { setForm(EMPTY); setEditing("new"); }}><Plus size={16} />{t("tpl.new")}</button>
      )}
      {editing && (
        <section className="card stack" aria-labelledby="pf-h">
          <h2 id="pf-h" style={{ margin: 0 }}>{t("prop.form.title")}</h2>
          <p className="muted small" style={{ margin: 0 }}>{t("prop.form.lead")}</p>
          <div>
            <strong style={{ fontSize: "0.92rem" }}>{t("prop.sample")}</strong>
            <DropZone label={t("prop.sample.drop")} multiple={false} accept="application/pdf" busy={busy} busyLabel={t("case.docs.reading")} onFiles={(f) => void suggest(f)} />
            {suggested && <p className="small banner banner-info" style={{ marginTop: "0.5rem", marginBottom: 0 }}>{t("prop.sample.done", { f: suggested })}</p>}
          </div>
          <div className="form-grid">
            <Field label={t("prop.name")}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t("prop.formblatt")}><input value={form.formblatt ?? ""} onChange={(e) => setForm({ ...form, formblatt: e.target.value })} placeholder="Formblatt 7" /></Field>
            <Field label={t("tpl.printedTitle")} className="full"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label={t("prop.purpose")} className="full"><textarea rows={2} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
            <Field label={t("tpl.providedBy")}>
              <select value={form.providedBy} onChange={(e) => setForm({ ...form, providedBy: e.target.value as ProposalBody["providedBy"] })}>
                {(["student", "parents", "office", "third_party"] as const).map((k) => <option key={k} value={k}>{t(`tpl.by.${k}` as MessageKey)}</option>)}
              </select>
            </Field>
            <Field label={t("prop.category")}>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as TemplateCategory })} aria-label="category">
                {CATS.map((c) => <option key={c.id} value={c.id}>{t(`t2.cat.${c.id}` as MessageKey)}</option>)}
              </select>
            </Field>
          </div>
          <div>
            <strong style={{ fontSize: "0.92rem" }}>{t("prop.fields")}</strong>
            <table className="estimate-table" style={{ marginTop: "0.4rem" }}>
              <tbody>
                {form.fields.map((f, i) => (
                  <tr key={i}>
                    <td style={{ width: "50%" }}><input value={f.label} aria-label={t("prop.field.label")} onChange={(e) => setField(i, { label: e.target.value, key: f.key.startsWith("feld") || f.key === slug(f.label) ? slug(e.target.value) : f.key })} /></td>
                    <td><select value={f.type} aria-label={t("prop.field.type")} onChange={(e) => setField(i, { type: e.target.value as TemplateField["type"] })}>{TYPES.map((x) => <option key={x} value={x}>{t(`prop.type.${x}` as MessageKey)}</option>)}</select></td>
                    <td><label className="row small"><input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} />{t("prop.field.required")}</label></td>
                    <td><button type="button" className="icon-button" aria-label={t("inputs.remove")} onClick={() => setForm({ ...form, fields: form.fields.filter((_, k) => k !== i) })}><X size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="link-button small" onClick={() => setForm({ ...form, fields: [...form.fields, { key: `feld_${form.fields.length + 1}`, label: "", type: "text", required: true }] })}>+ {t("prop.field.add")}</button>
          </div>
          <div>
            <strong style={{ fontSize: "0.92rem" }}>{t("prop.signatures")}</strong>
            {form.signatures.map((s, i) => (
              <div className="row" key={i} style={{ margin: "0.3rem 0", flexWrap: "nowrap" }}>
                <input value={s.label} onChange={(e) => setForm({ ...form, signatures: form.signatures.map((x, k) => (k === i ? { key: slug(e.target.value) || `sig_${i + 1}`, label: e.target.value } : x)) })} />
                <button type="button" className="icon-button" aria-label={t("inputs.remove")} onClick={() => setForm({ ...form, signatures: form.signatures.filter((_, k) => k !== i) })}><X size={14} /></button>
              </div>
            ))}
            <button type="button" className="link-button small" onClick={() => setForm({ ...form, signatures: [...form.signatures, { key: `sig_${form.signatures.length + 1}`, label: "Unterschrift " }] })}>+ {t("prop.signature.add")}</button>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="row">
            <button className="button" type="button" onClick={() => void save(true)}>{t("prop.submit")}</button>
            <button className="button button-ghost" type="button" onClick={() => void save(false)}>{t("prop.saveDraft")}</button>
            <button className="link-button small" type="button" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
          </div>
        </section>
      )}

      {lib.proposals.length === 0 && !editing && <p className="muted">{t("prop.empty")}</p>}
      {lib.proposals.map((p) => {
        const Icon = catIcon(p.category ?? "official_form");
        return (
          <section className={`card cat-${p.category ?? "official_form"}`} key={p.id} style={{ borderLeft: "3px solid var(--cc)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div className="tpl-top">
                <span className="tpl-ico"><Icon size={18} /></span>
                <span>
                  <strong>{p.name}{p.formblatt ? ` · ${p.formblatt}` : ""}</strong>
                  <span className="small muted" style={{ display: "block" }}>{t("prop.by", { by: p.proposedBy, date: date(p.proposedAt) })} · {t("tpl.fields", { n: p.fields.length })}{p.sampleFilename ? ` · ${p.sampleFilename}` : ""}</span>
                </span>
              </div>
              {statusPill(p.status)}
            </div>
            <p className="small" style={{ margin: "0.6rem 0 0.3rem" }}>{p.purpose}</p>
            <p className="small muted" style={{ margin: 0 }}>{t("tpl.printedTitle")}: <em>{p.title}</em></p>
            {p.decisionNote && <p className="banner banner-warn small" style={{ marginTop: "0.6rem" }}>{p.decisionNote}{p.decidedBy ? ` · ${p.decidedBy}` : ""}</p>}
            {p.status === "accepted" && <p className="small banner banner-ok" style={{ margin: "0.6rem 0 0" }}>{t("prop.available")} · {p.decidedBy}</p>}
            <div className="row" style={{ marginTop: "0.7rem" }}>
              {(p.status === "draft" || p.status === "rejected") && p.proposedBy === me && <button className="button button-small button-ghost" type="button" onClick={() => startEdit(p)}>{t("prop.edit")}</button>}
              {p.status === "submitted" && (lib.canApprove ? (
                <>
                  <button className="button button-small" type="button" onClick={() => { setDecision({ id: p.id, kind: "accept" }); setError(null); }}>{t("prop.accept")}</button>
                  <button className="button button-small button-ghost" type="button" onClick={() => { setDecision({ id: p.id, kind: "reject" }); setError(null); }}>{t("prop.reject")}</button>
                </>
              ) : (
                <span className="reason"><Lock size={13} />{t("t2.check.owner")}</span>
              ))}
            </div>
            {decision?.id === p.id && decision.kind === "accept" && (
              <div className="stack" style={{ marginTop: "0.75rem" }}>
                <p className="small muted" style={{ margin: 0 }}>{t("prop.accept.note")}</p>
                <div className="row">
                  <label className="field">{t("prop.method")}<select value={method} onChange={(e) => setMethod(e.target.value as MethodInfo["id"])}>{methods.map((m) => <option key={m.id} value={m.id}>{bi(m.name)}</option>)}</select></label>
                  <label className="field">{t("read.minConfidence")}<select value={minConf} onChange={(e) => setMinConf(Number(e.target.value))}>{[0.6, 0.7, 0.8, 0.9, 0.95].map((v) => <option key={v} value={v}>{Math.round(v * 100)} %</option>)}</select></label>
                  <button className="button button-small" type="button" onClick={async () => { const r = await run(() => api.acceptProposal(p.id, method, minConf)); if (r) { setDecision(null); await reload(); } }}>{t("prop.accept")}</button>
                </div>
              </div>
            )}
            {decision?.id === p.id && decision.kind === "reject" && (
              <div className="stack" style={{ marginTop: "0.75rem" }}>
                <label className="field">{t("prop.comment")}<textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
                <div><button className="button button-small button-danger" type="button" onClick={async () => { const r = await run(() => api.rejectProposal(p.id, comment)); if (r) { setDecision(null); setComment(""); await reload(); } }}>{t("prop.reject")}</button></div>
              </div>
            )}
            {decision?.id === p.id && error && <p className="error-text" role="alert">{error}</p>}
          </section>
        );
      })}
    </div>
  );
}
