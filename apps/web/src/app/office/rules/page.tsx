"use client";

import {
  BUILTIN_TEMPLATES,
  DECISION_TREE,
  baselineFacts,
  describeCheck,
  describeRuleCondition,
  factCatalog,
  fromCheck,
  runRuleTests,
  toCheck,
  type Condition,
  type DocumentTemplate,
  type Rule,
} from "@digieurope/shared";
import { AlertTriangle, CheckCircle2, CircleDot, Clock, Lock, Pencil, Plus, Power, Search, ShieldCheck, Sparkles, User, Workflow, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConditionBuilder } from "@/components/ConditionBuilder";
import { DecisionTree } from "@/components/DecisionTree";
import { TodoBar, refreshTodo, useTodo, type TodoItem } from "@/components/TodoBar";
import { SourceLink, Spinner, useAsyncError } from "@/components/ui";
import { api, type RuleDraftBody, type RuleEntry, type RuleVersionView } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { useStaff } from "@/lib/staff";

type Filter = "all" | "attention" | "federal" | "office" | "paused";
const needsAttention = (r: RuleEntry) => r.status === "draft" || r.status === "changed";

export default function Rules() {
  const { t, bi, lang, dateTime, date } = useI18n();
  const { staff, canBuild } = useStaff();
  const todo = useTodo();
  const [rules, setRules] = useState<RuleEntry[] | null>(null);
  const [templates, setTemplates] = useState<DocumentTemplate[]>(BUILTIN_TEMPLATES);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<RuleDraftBody | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"rules" | "tree">("rules");
  const { error, setError, run } = useAsyncError();

  const load = useCallback(async () => {
    const list = await api.rules();
    setRules(list);
    return list;
  }, []);
  useEffect(() => {
    void load();
    api.templates().then((l) => setTemplates(l.templates)).catch(() => undefined);
  }, [load]);

  const facts = useMemo(() => factCatalog(templates), [templates]);
  /** Which question of the decision tree a rule feeds, by rule id. */
  const treeQuestion = useMemo(() => {
    const m = new Map<string, number>();
    DECISION_TREE.nodes.filter((n) => n.kind === "question").forEach((n, i) => n.kind === "question" && n.rules.forEach((id) => m.set(id, i + 1)));
    return m;
  }, []);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rules ?? [])
      .filter((r) => !term || bi(r.title).toLowerCase().includes(term) || r.id.toLowerCase().includes(term))
      .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
  }, [rules, q, bi]);

  if (!rules) return <Spinner label={t("common.loading")} />;
  const cur = rules.find((r) => r.id === sel) ?? null;

  const todoItems: TodoItem[] = [];
  if (todo?.rulesToApprove) todoItems.push({ key: "a", text: todo.rulesToApprove === 1 ? t("todo.rules1") : t("todo.rules", { n: todo.rulesToApprove }), onClick: () => setFilter("attention") });
  if (todo?.myRuleDrafts) todoItems.push({ key: "m", text: t("todo.myRules"), tone: "info", onClick: () => setFilter("attention") });

  const sentences = (rule: Rule) => {
    const when = fromCheck(rule.when);
    const pass = fromCheck(rule.pass);
    return {
      when: when === null ? null : when.map((c) => describeRuleCondition(c, facts, lang)),
      pass: pass === null ? null : pass.map((c) => describeRuleCondition(c, facts, lang)),
    };
  };

  const startEdit = (r: RuleEntry) => {
    const base = (r.draft ?? r.live)!.rule;
    setError(null);
    setEditing({
      title: base.title, plain: base.plain, fix: base.fix, severity: base.severity,
      when: fromCheck(base.when) ?? [], pass: fromCheck(base.pass) ?? [],
      tests: base.tests.map((x) => ({ name: x.name, expectPass: x.expectPass })),
    });
  };

  const after = async (res: RuleEntry | undefined) => {
    if (!res) return;
    setRules((rs) => rs!.map((x) => (x.id === res.id ? res : x)));
    refreshTodo();
  };

  const allGroups = ([
    { key: "attention", label: "r.group.attention", items: shown.filter(needsAttention) },
    { key: "federal", label: "r.group.federal", items: shown.filter((r) => !needsAttention(r) && r.status !== "paused" && r.scope === "federal") },
    { key: "office", label: "r.group.office", items: shown.filter((r) => !needsAttention(r) && r.status !== "paused" && r.scope === "office") },
    { key: "paused", label: "r.group.paused", items: shown.filter((r) => r.status === "paused" && !needsAttention(r)) },
  ] as { key: Filter; label: MessageKey; items: RuleEntry[] }[]);
  const groups = allGroups.filter((g) => (filter === "all" || g.key === filter) && g.items.length > 0);
  const open = (id: string) => { setSel(id); setEditing(null); setCreating(false); setError(null); };
  const close = () => { setSel(null); setEditing(null); setCreating(false); };

  const attention = rules.filter(needsAttention).length;
  const startNew = () => {
    setError(null);
    setSel(null);
    setCreating(true);
    setEditing({ title: { de: "", en: "" }, plain: { de: "", en: "" }, fix: { de: "", en: "" }, severity: "blocker", when: [], pass: [], tests: [] });
  };

  const card = (r: RuleEntry) => {
    const rule = (r.draft ?? r.live)!.rule;
    const sx = sentences(rule);
    const when = sx.when?.[0] ?? null;
    const pass = sx.pass ?? [];
    return (
      <button key={r.id} type="button" className="rcard" aria-current={r.id === sel} onClick={() => open(r.id)}>
        <span className="rc-flow">
          <span className="rc-step if"><b>{t("r.flow.if")}</b>{when ?? t("r.flow.always")}</span>
          <span className="rc-step chk"><b>{t("r.flow.check")}</b>{pass[0] ?? "–"}{pass.length > 1 && <i>{t("r.flow.more", { n: pass.length - 1 })}</i>}</span>
        </span>
        <span className="rc-title">{bi(r.title)}</span>
        <span className="rc-plain">{bi(rule.plain)}</span>
        <span className="rc-foot">
          <span className={`chip ${r.status === "live" ? "ok" : r.status === "paused" ? "mute" : "warn"}`}>{t(`r.status.${r.status}` as MessageKey)}</span>
          <span className={`rc-sev ${rule.severity}`}>{t(rule.severity === "blocker" ? "r.sev.short.blocker" : "r.sev.short.warning")}</span>
          {r.draft?.rule.draftedByAi && <Sparkles size={12} />}
          <span className={`chip ${treeQuestion.has(r.id) ? "info" : "mute"}`}>{treeQuestion.has(r.id) ? t("dt.inTree", { n: String(treeQuestion.get(r.id)) }) : t("dt.notInTree")}</span>
          <span className={`rc-used${r.usedIn.length === 0 ? " none" : ""}`}>{r.usedIn.length === 0 ? t("r.usedIn0") : r.usedIn.length === 1 ? t("r.usedIn1") : t("r.usedIn", { n: r.usedIn.length })}</span>
          <span className="rc-v">v{rule.version}</span>
        </span>
      </button>
    );
  };

  const drawerOpen = creating || !!cur;
  return (
    <div>
      <header className="hero">
        <div className="hero-text">
          <h1>{t("r.title")}</h1>
          <p>{t("r.lead")}</p>
          <p className="small" style={{ opacity: 0.85 }}>{t("dt.rules.lead")}</p>
        </div>
        <div className="hero-actions">
          <dl className="hero-figs">
            <div><dd className="num">{rules.length}</dd><dt>{t("r.fig.total")}</dt></div>
            <div><dd className="num">{rules.filter((r) => r.status === "live").length}</dd><dt>{t("r.status.live")}</dt></div>
            <div><dd className="num">{attention}</dd><dt>{t("r.group.attention")}</dt></div>
          </dl>
          {canBuild && <button type="button" className="button" onClick={startNew}><Plus size={16} />{t("r.new")}</button>}
        </div>
      </header>
      <TodoBar items={todoItems} />

      <div className="rl-view" role="tablist">
        <button type="button" role="tab" aria-pressed={view === "rules"} onClick={() => setView("rules")}>{t("dt.tab.rules")}</button>
        <button type="button" role="tab" aria-pressed={view === "tree"} onClick={() => setView("tree")}>{t("dt.tab.tree")}</button>
      </div>

      {view === "tree" ? (
        <section className="rgroup">
          <h2>{t("dt.page.title")}</h2>
          <p className="muted" style={{ maxWidth: "70ch" }}>{t("dt.page.lead")}</p>
          <DecisionTree rules={{ title: (id) => { const r = rules.find((x) => x.id === id); return r ? bi(r.title) : undefined; }, open }} />
        </section>
      ) : (
        <>
      <div className="rl-bar">
        <div className="pillrow" role="tablist">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("r.f.all")} <span>{shown.length}</span></button>
          {allGroups.map((g) => g.items.length > 0 && (
            <button key={g.key} type="button" aria-pressed={filter === g.key} onClick={() => setFilter(g.key)}>{t(g.label)} <span>{g.items.length}</span></button>
          ))}
        </div>
        <label className="wl-search">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("r.search")} aria-label={t("r.search")} />
        </label>
      </div>

      {groups.map((g) => (
        <section key={g.key} className="rgroup">
          <h2>{t(g.label)} <span>{g.items.length}</span></h2>
          <div className="rgrid">{g.items.map(card)}</div>
        </section>
      ))}
      {groups.length === 0 && <p className="muted" style={{ padding: "2rem 0" }}>{t("todo.none")}</p>}
        </>
      )}

      {drawerOpen && (
        <>
          <div className="drawer-bg" onClick={close} />
          <aside className="drawer wide" role="dialog" aria-label={t("r.title")}>
            <button type="button" className="drawer-x icon-button" aria-label={t("r.close")} onClick={close}><XCircle size={18} /></button>
            <div className="drawer-scroll">
              {creating && editing ? (
                <Editor
                  entry={null}
                  body={editing}
                  facts={facts}
                  onChange={setEditing}
                  onCancel={close}
                  onSave={async () => {
                    const res = await run(() => api.createRule({ title: editing.title, plain: editing.plain, fix: editing.fix, severity: editing.severity, when: editing.when, pass: editing.pass }));
                    if (res) {
                      setRules((rs) => [...rs!, res]);
                      refreshTodo();
                      setCreating(false);
                      setEditing(null);
                      setFilter("all");
                      setSel(res.id);
                    }
                  }}
                  error={error}
                />
              ) : cur && editing ? (
                <Editor
                  entry={cur}
                  body={editing}
                  facts={facts}
                  onChange={setEditing}
                  onCancel={() => setEditing(null)}
                  onSave={async () => {
                    const res = await run(() => api.saveRuleDraft(cur.id, editing));
                    if (res) {
                      await after(res);
                      setEditing(null);
                    }
                  }}
                  error={error}
                />
              ) : cur ? (
                <Detail
                  entry={cur}
                  me={staff?.name ?? ""}
                  canBuild={canBuild}
                  sentences={sentences}
                  onEdit={() => startEdit(cur)}
                  onApprove={async () => after((await run(() => api.approveRule(cur.id))) as RuleEntry | undefined)}
                  onDiscard={async () => {
                    const res = await run(() => api.discardRule(cur.id));
                    if (res && "deleted" in res) {
                      setRules((rs) => rs!.filter((x) => x.id !== cur.id));
                      setSel(null);
                      refreshTodo();
                    } else await after(res as RuleEntry | undefined);
                  }}
                  onToggle={async () => after(await run(() => (cur.paused ? api.approveRule(cur.id) : api.revokeRule(cur.id))))}
                  error={error}
                  dateTime={dateTime}
                  date={date}
                />
              ) : null}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function Detail(props: {
  entry: RuleEntry;
  me: string;
  canBuild: boolean;
  sentences: (r: Rule) => { when: string[] | null; pass: string[] | null };
  onEdit: () => void;
  onApprove: () => void;
  onDiscard: () => void;
  onToggle: () => void;
  error: string | null;
  dateTime: (iso?: string) => string;
  date: (iso?: string) => string;
}) {
  const { t, bi } = useI18n();
  const { entry: r, me } = props;
  const shown: RuleVersionView = (r.draft ?? r.live)!;
  const rule = shown.rule;
  const s = props.sentences(rule);
  const tests = shown.tests ?? [];
  const passed = tests.filter((x) => x.ok).length;
  const ownChange = r.draft?.author === me;
  const testsFail = passed !== tests.length;
  const before = r.draft && r.live ? props.sentences(r.live.rule) : null;

  return (
    <section className="rd">
      <div className="rd-head">
        <div>
          <div className="row" style={{ gap: "0.45rem" }}>
            <span className={`badge ${r.status === "live" ? "ok" : r.status === "paused" ? "muted" : "warn"}`}>{t(`r.status.${r.status}` as MessageKey)}</span>
            <span className="badge muted">{rule.scope === "federal" ? t("office.rules.scope.federal") : t("office.rules.scope.office")}</span>
            {rule.draftedByAi && <span className="badge new"><Sparkles size={12} />{t("r.ai")}</span>}
          </div>
          <h2>{bi(rule.title)}</h2>
          <div className="meta-line">
            <span>{r.id} · {t("r.version", { v: rule.version })}</span>
            <span><Workflow size={13} />{r.usedIn.length === 0 ? t("r.usedIn0") : r.usedIn.map((u) => u.name).join(", ")}</span>
            <span><User size={13} />{t("r.writtenBy", { by: shown.author, date: props.date(shown.createdAt) })}</span>
            {r.live?.approvedBy && <span><CheckCircle2 size={13} />{t("r.approvedBy", { by: r.live.approvedBy, date: props.date(r.live.approvedAt) })}</span>}
            <SourceLink source={rule.source} />
          </div>
        </div>
        {props.canBuild ? (
          <div className="row">
            <button type="button" className="button button-ghost button-small" onClick={props.onEdit}><Pencil size={14} />{t("r.edit")}</button>
            {r.live && !r.draft && <button type="button" className="button button-ghost button-small" onClick={props.onToggle}><Power size={14} />{r.paused ? t("r.switchOn") : t("r.switchOff")}</button>}
          </div>
        ) : (
          <span className="reason"><Lock size={13} />{t("r.noRights")}</span>
        )}
      </div>

      {r.draft && (
        <div className="pending-box">
          <h3><Clock size={15} style={{ verticalAlign: "-2px" }} /> {t("r.pending", { v: r.draft.rule.version, by: r.draft.author })}</h3>
          <p className="small" style={{ margin: "0 0 0.8rem" }}>{r.live ? t("r.pending.lead") : t("r.pending.leadNew")}</p>
          {before && (
            <div className="diff" style={{ marginBottom: "0.9rem" }}>
              <div className="before">
                <h4>{t("r.before")} · v{r.live!.rule.version}</h4>
                <div>{bi(r.live!.rule.plain)}</div>
                <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1rem" }}>{(before.pass ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
              <div className="after">
                <h4>{t("r.after")} · v{r.draft.rule.version}</h4>
                <div>{bi(r.draft.rule.plain)}</div>
                <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1rem" }}>{(s.pass ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            </div>
          )}
          {ownChange && <p className="reason" style={{ marginBottom: "0.6rem" }}><Lock size={13} />{t("r.youWrote")}</p>}
          {testsFail && <p className="reason" style={{ marginBottom: "0.6rem", color: "var(--bad)" }}><XCircle size={13} />{t("r.testsFail")}</p>}
          {props.canBuild && (
            <div className="row">
              <button type="button" className="button button-small" disabled={ownChange || testsFail} onClick={props.onApprove}><CheckCircle2 size={14} />{r.live ? t("r.approve") : t("r.approveNew")}</button>
              {(r.live || r.scope === "office") && <button type="button" className="button button-ghost button-small" onClick={props.onDiscard}>{r.live ? t("r.discard") : t("r.withdraw")}</button>}
            </div>
          )}
        </div>
      )}

      <p className="rd-lead">{bi(rule.plain)}</p>

      {s.when === null || s.pass === null ? (
        <pre className="code">{rule.when ? `${describeCheck(rule.when)}\n` : ""}{describeCheck(rule.pass)}</pre>
      ) : (
        <div className="flow">
          <div className="fl-block if">
            <span className="fl-tag">{t("r.flow.if")}</span>
            {s.when.length === 0 ? <p>{t("r.always")}</p> : s.when.map((x, i) => <p key={i}><CircleDot size={14} />{x}</p>)}
          </div>
          <span className="fl-arrow" aria-hidden>↓</span>
          <div className="fl-block chk">
            <span className="fl-tag">{t("r.flow.check")}</span>
            <small>{t("r.passesWhen")}</small>
            {s.pass.map((x, i) => <p key={i}><CheckCircle2 size={14} />{x}</p>)}
          </div>
          <span className="fl-arrow" aria-hidden>↓</span>
          <div className="fl-block oth">
            <span className="fl-tag">{t("r.flow.otherwise")}</span>
            <small>{t(rule.severity === "blocker" ? "r.severity.blocker" : "r.severity.warning")}</small>
            <p>{bi(rule.fix)}</p>
          </div>
        </div>
      )}
      <details style={{ marginTop: "0.6rem" }}>
        <summary className="small muted">{t("r.technical")}</summary>
        <pre className="code">{rule.when ? `when: ${describeCheck(rule.when)}\n` : ""}pass: {describeCheck(rule.pass)}</pre>
      </details>

      <div>
        <h3>{t("r.tests")} · {t("r.testsOk", { n: passed, m: tests.length })}</h3>
        {tests.map((x) => (
          <div className="test-row" key={x.name}>
            {x.ok ? <CheckCircle2 size={16} color="var(--ok)" /> : <XCircle size={16} color="var(--bad)" />}
            <span className="nm">{x.name}</span>
            <span className="small muted">{x.expectPass ? t("office.rules.expect.pass") : t("office.rules.expect.fail")}</span>
          </div>
        ))}
      </div>

      <div>
        <h3>{t("r.history")}</h3>
        {r.history.length === 0 && !r.live ? <p className="small muted">{t("r.historyEmpty")}</p> : (
          <ul className="hist">
            {[...(r.live ? [r.live] : []), ...[...r.history].reverse()].map((h, i) => (
              <li key={i}>
                <span className="v">v{h.rule.version}</span>
                <span style={{ flex: 1 }}>{t("r.writtenBy", { by: h.author, date: props.date(h.createdAt) })}{h.approvedBy ? ` · ${t("r.approvedBy", { by: h.approvedBy, date: props.date(h.approvedAt) })}` : ""}</span>
                {i === 0 && r.live && <span className="badge ok">{t("r.status.live")}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {props.error && <p className="error-text" role="alert">{props.error}</p>}
    </section>
  );
}

/** The sample cases for a brand-new rule, the same ones the server makes. */
function newRuleTests(pass: Condition[]) {
  const tests: Rule["tests"] = [{ name: "Complete application", facts: {}, expectPass: true }];
  const first = pass[0];
  if (first?.op === "present") {
    const facts = first.path.split(".").reduceRight<unknown>((inner, key, i, all) => (i === all.length - 1 ? { [key]: false } : { [key]: inner }), undefined) as Record<string, unknown>;
    tests.push({ name: "Without the required item", facts, expectPass: false });
  }
  return tests;
}

function Step({ title, hint, children }: { n?: number; title: string; hint?: string; children: ReactNode; done?: boolean }) {
  return (
    <section className="re-step">
      <header>
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
      </header>
      <div className="re-body">{children}</div>
    </section>
  );
}

function Bi({ label, de, en, rows = 3, onDe, onEn, multiline = true }: { label: string; de: string; en: string; rows?: number; onDe: (v: string) => void; onEn: (v: string) => void; multiline?: boolean }) {
  return (
    <div className="bi">
      <div className="bi-label">{label}</div>
      <div className="bi-pair">
        <label><span className="lang-tag">DE</span>{multiline ? <textarea rows={rows} value={de} onChange={(e) => onDe(e.target.value)} /> : <input value={de} onChange={(e) => onDe(e.target.value)} />}</label>
        <label><span className="lang-tag en">EN</span>{multiline ? <textarea rows={rows} value={en} onChange={(e) => onEn(e.target.value)} /> : <input value={en} onChange={(e) => onEn(e.target.value)} />}</label>
      </div>
    </div>
  );
}

function Editor(props: {
  entry: RuleEntry | null;
  body: RuleDraftBody;
  facts: ReturnType<typeof factCatalog>;
  onChange: (b: RuleDraftBody) => void;
  onCancel: () => void;
  onSave: () => void;
  error: string | null;
}) {
  const { t, lang } = useI18n();
  const { body, onChange } = props;
  const isNew = props.entry === null;
  const base: Rule = useMemo(
    () => (props.entry ? (props.entry.draft ?? props.entry.live)!.rule : ({ id: "R-OFFICE-NEW", version: 1, scope: "office", title: body.title, plain: body.plain, source: { label: "", url: "" }, pass: { all: [] }, severity: body.severity, fix: body.fix, tests: [] } as unknown as Rule)),
    [props.entry, body.title, body.plain, body.fix, body.severity],
  );
  const advanced = !isNew && (fromCheck(base.pass) === null || fromCheck(base.when) === null);
  // The sample cases run on every change, so the person sees right away what the new check does.
  const preview = useMemo(() => {
    const tests = isNew ? newRuleTests(body.pass) : base.tests.map((x) => ({ ...x, expectPass: body.tests.find((y) => y.name === x.name)?.expectPass ?? x.expectPass }));
    const rule: Rule = { ...base, when: toCheck(body.when), pass: toCheck(body.pass) ?? base.pass, tests };
    return body.pass.length === 0 && isNew ? [] : runRuleTests(rule, baselineFacts() as unknown as Record<string, unknown>);
  }, [base, body, isNew]);
  const text = (k: "title" | "plain" | "fix", l: "de" | "en", v: string) => onChange({ ...body, [k]: { ...body[k], [l]: v } });
  const set = (patch: Partial<RuleDraftBody>) => onChange({ ...body, ...patch });
  const words = (c: Condition[]) => c.map((x) => describeRuleCondition(x, props.facts, lang));

  const okName = Boolean(body.title.de.trim() && body.title.en.trim());
  const okPlain = Boolean(body.plain.de.trim() && body.plain.en.trim());
  const okCond = body.pass.length > 0 || advanced;
  const okMsg = Boolean(body.fix.de.trim() && body.fix.en.trim());
  const testsOk = preview.every((x) => x.ok);
  const ready = isNew ? okName && okPlain && okCond && okMsg : okCond;
  const checklist: [boolean, MessageKey][] = isNew
    ? [[okName, "r.ck.name"], [okPlain, "r.ck.plain"], [okCond, "r.ck.cond"], [okMsg, "r.ck.msg"], [preview.length > 0 && testsOk, "r.ck.tests"]]
    : [[okCond, "r.ck.cond"], [testsOk, "r.ck.tests"]];

  return (
    <div className="re">
      <div className="re-main">
        <div className="re-intro">
          <h2>{isNew ? t("r.new.title") : t("r.ed.title")}</h2>
          <p>{isNew ? t("r.new.lead") : t("r.ed.lead")}</p>
        </div>

        <Step n={1} title={t("r.step.name")} hint={t("r.step.name.hint")} done={okName && okPlain}>
          <Bi label={t("r.ed.name")} de={body.title.de} en={body.title.en} multiline={false} onDe={(v) => text("title", "de", v)} onEn={(v) => text("title", "en", v)} />
          <Bi label={t("r.ed.plain")} de={body.plain.de} en={body.plain.en} onDe={(v) => text("plain", "de", v)} onEn={(v) => text("plain", "en", v)} />
        </Step>

        {advanced ? (
          <p className="banner banner-info small" style={{ margin: 0 }}>{t("r.ed.advanced")}</p>
        ) : (
          <>
            <Step n={2} title={t("r.step.when")} hint={t("r.step.when.hint")} done={body.when.length > 0}>
              <ConditionBuilder facts={props.facts} lines={body.when} onChange={(when: Condition[]) => set({ when })} />
              {body.when.length === 0 && <p className="re-empty"><CircleDot size={13} />{t("r.always")}</p>}
            </Step>
            <Step n={3} title={t("r.step.pass")} hint={t("r.step.pass.hint")} done={body.pass.length > 0}>
              <ConditionBuilder facts={props.facts} lines={body.pass} onChange={(pass: Condition[]) => set({ pass })} />
              {body.pass.length === 0 && <p className="re-empty warn"><AlertTriangle size={13} />{t("r.step.pass.empty")}</p>}
            </Step>
          </>
        )}

        <Step n={4} title={t("r.step.msg")} hint={t("r.step.msg.hint")} done={okMsg}>
          <Bi label={t("r.ed.message")} de={body.fix.de} en={body.fix.en} onDe={(v) => text("fix", "de", v)} onEn={(v) => text("fix", "en", v)} />
          <div className="bi-label">{t("r.ed.severity")}</div>
          <div className="sev-pick" role="radiogroup" aria-label={t("r.ed.severity")}>
            {(["blocker", "warning"] as const).map((sv) => (
              <button key={sv} type="button" role="radio" aria-checked={body.severity === sv} className={sv} onClick={() => set({ severity: sv })}>
                {sv === "blocker" ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
                <span><strong>{t(sv === "blocker" ? "r.severity.blocker" : "r.severity.warning")}</strong><small>{t(sv === "blocker" ? "r.sev.blocker.hint" : "r.sev.warning.hint")}</small></span>
              </button>
            ))}
          </div>
        </Step>

        <Step n={5} title={t("r.ed.tests")} hint={isNew ? t("r.step.tests.auto") : t("r.step.tests.hint")} done={preview.length > 0 && testsOk}>
          {preview.length === 0 && <p className="re-empty"><CircleDot size={13} />{t("r.step.tests.wait")}</p>}
          {preview.map((x) => (
            <div className="test-row" key={x.name}>
              {x.ok ? <CheckCircle2 size={16} color="var(--ok)" /> : <XCircle size={16} color="var(--bad)" />}
              <span className="nm">{x.name}</span>
              <span className="small muted">{t("r.ed.expect")}</span>
              {isNew ? (
                <span className="badge muted">{x.expectPass ? t("r.ed.pass1") : t("r.ed.fail1")}</span>
              ) : (
                <select value={x.expectPass ? "pass" : "fail"} style={{ width: "auto", padding: "0.3rem 0.5rem", fontSize: "0.82rem" }} onChange={(e) => set({ tests: body.tests.map((y) => (y.name === x.name ? { ...y, expectPass: e.target.value === "pass" } : y)) })}>
                  <option value="pass">{t("r.ed.pass1")}</option>
                  <option value="fail">{t("r.ed.fail1")}</option>
                </select>
              )}
            </div>
          ))}
        </Step>
      </div>

      <aside className="re-side">
        <div className="re-card">
          <h4>{t("r.ed.preview")}</h4>
          <strong className="re-title">{(lang === "de" ? body.title.de : body.title.en) || t("r.ed.untitled")}</strong>
          {words(body.when).length > 0 && (
            <>
              <p className="re-k">{t("r.appliesWhen")}</p>
              {words(body.when).map((x, i) => <div className="sentence" key={`w${i}`}><CircleDot size={14} />{x}</div>)}
            </>
          )}
          <p className="re-k">{t("r.passesWhen")}</p>
          {words(body.pass).length === 0 ? <p className="small muted" style={{ margin: 0 }}>–</p> : words(body.pass).map((x, i) => <div className="sentence" key={`p${i}`}><CheckCircle2 size={14} />{x}</div>)}
          <p className="re-k">{t("r.message")}</p>
          <p className="small" style={{ margin: 0 }}>{(lang === "de" ? body.fix.de : body.fix.en) || "–"}</p>
        </div>
        <div className="re-card">
          <h4>{t("r.ed.checklist")}</h4>
          <ul className="re-check">
            {checklist.map(([ok, k]) => <li key={k} className={ok ? "ok" : ""}>{ok ? <CheckCircle2 size={15} /> : <CircleDot size={15} />}{t(k)}</li>)}
          </ul>
          <p className="small muted" style={{ margin: "0.6rem 0 0.8rem" }}><Lock size={12} style={{ verticalAlign: "-1px" }} /> {t("r.ed.twoPerson")}</p>
          {props.error && <p className="error-text" role="alert">{props.error}</p>}
          <div className="stack" style={{ gap: "0.5rem" }}>
            <button type="button" className="button" style={{ width: "100%" }} disabled={!ready} onClick={props.onSave}>{isNew ? t("r.new.save") : t("r.ed.save")}</button>
            <button type="button" className="button button-ghost" style={{ width: "100%" }} onClick={props.onCancel}>{t("r.ed.cancel")}</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
