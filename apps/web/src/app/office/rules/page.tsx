"use client";

import {
  BUILTIN_TEMPLATES,
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
import { CheckCircle2, CircleDot, Clock, Lock, Pencil, Power, Search, ShieldCheck, Sparkles, User, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConditionBuilder } from "@/components/ConditionBuilder";
import { TodoBar, refreshTodo, useTodo, type TodoItem } from "@/components/TodoBar";
import { SourceLink, Spinner, useAsyncError } from "@/components/ui";
import { api, type RuleDraftBody, type RuleEntry, type RuleVersionView } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { useStaff } from "@/lib/staff";

type Filter = "attention" | "live" | "paused" | "all";
const needsAttention = (r: RuleEntry) => r.status === "draft" || r.status === "changed";

export default function Rules() {
  const { t, bi, lang, dateTime, date } = useI18n();
  const { staff, canBuild } = useStaff();
  const todo = useTodo();
  const [rules, setRules] = useState<RuleEntry[] | null>(null);
  const [templates, setTemplates] = useState<DocumentTemplate[]>(BUILTIN_TEMPLATES);
  const [filter, setFilter] = useState<Filter>("attention");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<RuleDraftBody | null>(null);
  const { error, setError, run } = useAsyncError();

  const load = useCallback(async () => {
    const list = await api.rules();
    setRules(list);
    return list;
  }, []);
  useEffect(() => {
    void load().then((list) => {
      if (!list.some(needsAttention)) setFilter("all");
    });
    api.templates().then((l) => setTemplates(l.templates)).catch(() => undefined);
  }, [load]);

  const facts = useMemo(() => factCatalog(templates), [templates]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rules ?? [])
      .filter((r) => filter === "all" || (filter === "attention" ? needsAttention(r) : filter === "paused" ? r.status === "paused" : r.status === "live"))
      .filter((r) => !term || bi(r.title).toLowerCase().includes(term) || r.id.toLowerCase().includes(term))
      .sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
  }, [rules, filter, q, bi]);

  useEffect(() => {
    if (shown.length && (!sel || !shown.some((r) => r.id === sel))) setSel(shown[0]!.id);
  }, [shown, sel]);

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

  const filters: [Filter, MessageKey][] = [["attention", "r.filter.attention"], ["live", "r.filter.live"], ["paused", "r.filter.paused"], ["all", "r.filter.all"]];
  const count = (f: Filter) => rules.filter((r) => f === "all" || (f === "attention" ? needsAttention(r) : f === "paused" ? r.status === "paused" : r.status === "live")).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow"><ShieldCheck size={14} />{t("side.configure")}</span>
          <h1>{t("r.title")}</h1>
          <p>{t("r.lead")}</p>
        </div>
      </div>
      <TodoBar items={todoItems} />

      <div className="rl">
        <aside className="rl-list">
          <div className="rl-tools">
            <label className="wl-search" style={{ width: "100%" }}>
              <Search size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("r.search")} aria-label={t("r.search")} />
            </label>
            <div className="seg" role="group" style={{ flexWrap: "wrap" }}>
              {filters.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{t(label)} <span className="n">{count(k)}</span></button>
              ))}
            </div>
          </div>
          <div className="rl-rows">
            {shown.map((r) => (
              <button key={r.id} type="button" className="rl-row" aria-current={r.id === sel} onClick={() => { setSel(r.id); setEditing(null); }}>
                <span className={`sdot ${r.status}`} aria-hidden />
                <span style={{ minWidth: 0 }}>
                  <strong>{bi(r.title)}</strong>
                  <small>{r.id} · {t(`r.status.${r.status}` as MessageKey)}</small>
                </span>
                {r.draft?.rule.draftedByAi && <Sparkles size={14} color="var(--accent)" />}
              </button>
            ))}
            {shown.length === 0 && <p className="muted small" style={{ padding: "1rem" }}>{t("todo.none")}</p>}
          </div>
        </aside>

        {!cur ? (
          <div className="panel preview-empty">{t("r.select")}</div>
        ) : editing ? (
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
        ) : (
          <Detail
            entry={cur}
            me={staff?.name ?? ""}
            canBuild={canBuild}
            sentences={sentences}
            onEdit={() => startEdit(cur)}
            onApprove={async () => after(await run(() => api.approveRule(cur.id)))}
            onDiscard={async () => after(await run(() => api.discardRule(cur.id)))}
            onToggle={async () => after(await run(() => (cur.paused ? api.approveRule(cur.id) : api.revokeRule(cur.id))))}
            error={error}
            dateTime={dateTime}
            date={date}
          />
        )}
      </div>
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
    <section className="panel rd" style={{ padding: "1.4rem" }}>
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
              {r.live && <button type="button" className="button button-ghost button-small" onClick={props.onDiscard}>{t("r.discard")}</button>}
            </div>
          )}
        </div>
      )}

      <div>
        <h3>{t("office.rules.plain")}</h3>
        <p style={{ fontSize: "1.02rem", margin: 0 }}>{bi(rule.plain)}</p>
      </div>

      <div>
        <h3>{t("r.whatChecked")}</h3>
        {s.when === null || s.pass === null ? (
          <pre className="code">{rule.when ? `${describeCheck(rule.when)}\n` : ""}{describeCheck(rule.pass)}</pre>
        ) : (
          <>
            <p className="small muted" style={{ margin: "0 0 0.35rem" }}>{s.when.length ? t("r.appliesWhen") : t("r.always")}</p>
            {s.when.map((x, i) => <div className="sentence" key={`w${i}`}><CircleDot size={14} />{x}</div>)}
            <p className="small muted" style={{ margin: "0.7rem 0 0.35rem" }}>{t("r.passesWhen")}</p>
            {s.pass.map((x, i) => <div className="sentence" key={`p${i}`}><CheckCircle2 size={14} />{x}</div>)}
          </>
        )}
        <details style={{ marginTop: "0.5rem" }}>
          <summary className="small muted">{t("r.technical")}</summary>
          <pre className="code">{rule.when ? `when: ${describeCheck(rule.when)}\n` : ""}pass: {describeCheck(rule.pass)}</pre>
        </details>
      </div>

      <div>
        <h3>{t("r.message")} <span className={`badge ${rule.severity === "blocker" ? "bad" : "warn"}`} style={{ marginLeft: 6 }}>{t(rule.severity === "blocker" ? "r.severity.blocker" : "r.severity.warning")}</span></h3>
        <p className="small" style={{ margin: 0 }}>{bi(rule.fix)}</p>
      </div>

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

function Editor(props: {
  entry: RuleEntry;
  body: RuleDraftBody;
  facts: ReturnType<typeof factCatalog>;
  onChange: (b: RuleDraftBody) => void;
  onCancel: () => void;
  onSave: () => void;
  error: string | null;
}) {
  const { t } = useI18n();
  const { body, onChange } = props;
  const base = (props.entry.draft ?? props.entry.live)!.rule;
  const advanced = fromCheck(base.pass) === null || fromCheck(base.when) === null;
  // The sample cases run on every change, so the person sees right away what the new check does.
  const preview = useMemo(() => {
    const rule: Rule = { ...base, when: toCheck(body.when), pass: toCheck(body.pass) ?? base.pass, tests: base.tests.map((x) => ({ ...x, expectPass: body.tests.find((y) => y.name === x.name)?.expectPass ?? x.expectPass })) };
    return runRuleTests(rule, baselineFacts() as unknown as Record<string, unknown>);
  }, [base, body]);
  const text = (k: "title" | "plain" | "fix", l: "de" | "en", v: string) => onChange({ ...body, [k]: { ...body[k], [l]: v } });
  const set = (patch: Partial<RuleDraftBody>) => onChange({ ...body, ...patch });

  return (
    <section className="panel rd" style={{ padding: "1.4rem" }}>
      <div>
        <h2 style={{ margin: 0 }}>{t("r.ed.title")}</h2>
        <p className="small muted" style={{ margin: "0.3rem 0 0" }}>{t("r.ed.lead")}</p>
      </div>
      <div className="form-grid">
        <label className="field">{t("r.ed.name")} · {t("r.ed.de")}<input value={body.title.de} onChange={(e) => text("title", "de", e.target.value)} /></label>
        <label className="field">{t("r.ed.name")} · {t("r.ed.en")}<input value={body.title.en} onChange={(e) => text("title", "en", e.target.value)} /></label>
        <label className="field">{t("r.ed.plain")} · {t("r.ed.de")}<textarea rows={3} value={body.plain.de} onChange={(e) => text("plain", "de", e.target.value)} /></label>
        <label className="field">{t("r.ed.plain")} · {t("r.ed.en")}<textarea rows={3} value={body.plain.en} onChange={(e) => text("plain", "en", e.target.value)} /></label>
      </div>
      {advanced ? (
        <p className="banner banner-info small" style={{ margin: 0 }}>{t("r.ed.advanced")}</p>
      ) : (
        <>
          <div>
            <h3>{t("r.ed.when")}</h3>
            <ConditionBuilder facts={props.facts} lines={body.when} onChange={(when: Condition[]) => set({ when })} />
          </div>
          <div>
            <h3>{t("r.ed.pass")}</h3>
            <ConditionBuilder facts={props.facts} lines={body.pass} onChange={(pass: Condition[]) => set({ pass })} />
          </div>
        </>
      )}
      <div className="form-grid">
        <label className="field">{t("r.ed.message")} · {t("r.ed.de")}<textarea rows={3} value={body.fix.de} onChange={(e) => text("fix", "de", e.target.value)} /></label>
        <label className="field">{t("r.ed.message")} · {t("r.ed.en")}<textarea rows={3} value={body.fix.en} onChange={(e) => text("fix", "en", e.target.value)} /></label>
        <label className="field">{t("r.ed.severity")}
          <select value={body.severity} onChange={(e) => set({ severity: e.target.value as RuleDraftBody["severity"] })}>
            <option value="blocker">{t("r.severity.blocker")}</option>
            <option value="warning">{t("r.severity.warning")}</option>
          </select>
        </label>
      </div>
      <div>
        <h3>{t("r.ed.tests")} · {t("r.testsOk", { n: preview.filter((x) => x.ok).length, m: preview.length })}</h3>
        {preview.map((x) => (
          <div className="test-row" key={x.name}>
            {x.ok ? <CheckCircle2 size={16} color="var(--ok)" /> : <XCircle size={16} color="var(--bad)" />}
            <span className="nm">{x.name}</span>
            <span className="small muted">{t("r.ed.expect")}</span>
            <select value={x.expectPass ? "pass" : "fail"} style={{ width: "auto", padding: "0.3rem 0.5rem", fontSize: "0.82rem" }} onChange={(e) => set({ tests: body.tests.map((y) => (y.name === x.name ? { ...y, expectPass: e.target.value === "pass" } : y)) })}>
              <option value="pass">{t("r.ed.pass1")}</option>
              <option value="fail">{t("r.ed.fail1")}</option>
            </select>
          </div>
        ))}
      </div>
      {props.error && <p className="error-text" role="alert">{props.error}</p>}
      <div className="row">
        <button type="button" className="button" disabled={body.pass.length === 0} onClick={props.onSave}>{t("r.ed.save")}</button>
        <button type="button" className="button button-ghost" onClick={props.onCancel}>{t("r.ed.cancel")}</button>
      </div>
    </section>
  );
}
