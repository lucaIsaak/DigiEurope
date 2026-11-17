"use client";

import {
  DOCUMENT_KINDS,
  describeCondition,
  knownInfoLabel,
  type ProcessInput,
  RULES,
  compareSettings,
  diffProcesses,
  signatureLabel,
  systemsOf,
  type DocumentKind,
  type OfficeSettings,
  type ProcessDef,
} from "@digieurope/shared";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { ProcessViewer } from "@/components/FlowKit";
import { Spinner } from "@/components/ui";
import { api, type CompareResult } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

type Tab = "overview" | "structure" | "inputs" | "settings" | "metrics";

interface Column {
  id: string;
  name: string;
  def: ProcessDef;
  settings: OfficeSettings;
  isRef?: boolean;
}

function Score({ value }: { value: number }) {
  const tone = value >= 80 ? "ok" : value >= 60 ? "warn" : "bad";
  return (
    <span className={`score ${tone}`} aria-label={`${value} %`}>
      <b className="num">{value} %</b>
      <i aria-hidden><span style={{ width: `${value}%` }} /></i>
    </span>
  );
}

export default function Compare({ params }: { params: Promise<{ category: string }> }) {
  const { category } = use(params);
  const { t, bi, tk } = useI18n();
  const [data, setData] = useState<CompareResult | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");

  useEffect(() => {
    api.compare(decodeURIComponent(category)).then((d) => {
      setData(d);
      setLeft(d.reference ? "reference" : d.offices[0]?.id ?? "");
      setRight(d.offices[0]?.id ?? "");
    });
  }, [category]);

  const columns: Column[] = useMemo(() => {
    if (!data) return [];
    return [
      ...(data.reference ? [{ id: "reference", name: t("cmp.reference"), def: data.reference.def, settings: data.reference.settings, isRef: true }] : []),
      ...data.offices.map((o) => ({ id: o.id, name: o.name, def: o.def, settings: o.settings })),
    ];
  }, [data, t]);

  if (!data) return <Spinner label={t("common.loading")} />;
  const ref = columns.find((c) => c.isRef);
  const colById = (id: string) => columns.find((c) => c.id === id) ?? columns[0]!;
  const L = colById(left);
  const R = colById(right);
  const diff = diffProcesses(L.def, R.def);

  const stepText = (sig: string) => {
    const l = signatureLabel(sig);
    return `${bi(l.title)}${l.detail ? ` (${l.detail})` : ""}`;
  };
  const edgeText = (e: string) => {
    const [src, rest] = e.split("#");
    const [handle, tgt] = rest!.split(">");
    return `${stepText(src!)} —${handle}→ ${stepText(tgt!)}`;
  };
  const title = data.variant ? data.variant.path.map((x) => bi(x)).join(" › ") : data.category;

  const tabs: [Tab, MessageKey][] = [["overview", "cmp.tab.overview"], ["structure", "cmp.tab.structure"], ["inputs", "cmp.tab.inputs"], ["settings", "cmp.tab.settings"], ["metrics", "cmp.tab.metrics"]];

  // ---- settings matrix ----
  const ruleRows = RULES.filter((r) => columns.some((c) => c.settings.approvedRules.includes(r.id)) || true);
  const allSystems = [...new Set(columns.flatMap((c) => systemsOf(c.def)))].sort();
  const cell = (val: string, refVal: string | undefined, c: Column) => <td key={c.id} className={c.isRef ? "cell-ref" : ref && refVal !== undefined && val !== refVal ? "cell-diff" : ""}>{val}</td>;
  const method = (s: OfficeSettings, k: DocumentKind) => s.extractionByType[k]?.method ?? s.extractionDefault;

  // ---- metrics ----
  const metrics: { key: string; label: MessageKey; get: (o: CompareResult["offices"][number]) => number | null; lower: boolean; fmt: (n: number) => string }[] = [
    { key: "days", label: "cmp.metric.days", get: (o) => o.metrics.medianDaysToDecision, lower: true, fmt: (n) => t("cmp.days", { n }) },
    { key: "complete", label: "cmp.metric.complete", get: (o) => o.metrics.firstTimeComplete, lower: false, fmt: (n) => `${n} %` },
    { key: "review", label: "cmp.metric.review", get: (o) => o.metrics.reviewShare, lower: false, fmt: (n) => `${n} %` },
    { key: "rounds", label: "cmp.metric.rounds", get: (o) => o.metrics.documentRounds, lower: true, fmt: (n) => String(n) },
    { key: "volume", label: "cmp.metric.volume", get: (o) => o.metrics.casesPerMonth, lower: false, fmt: (n) => String(n) },
  ];

  return (
    <div className="stack ovs">
      <div>
        <p className="small"><Link href="/oversight">← {t("cmp.back")}</Link></p>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <span className="muted small">{t("cmp.demo")}</span>
        </div>
        <p className="muted small" style={{ marginTop: "0.4rem" }}>{ref ? `${t("cmp.referenceNote")} ${t("cmp.harmonyBreakdown")}` : t("cmp.noRef")}</p>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(label)}</button>)}
      </div>

      {tab === "overview" && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("cmp.office")}</th><th>{t("cmp.harmony")}</th><th>{t("cmp.structure")}</th><th>{t("cmp.settings")}</th><th>{t("cmp.inputs")}</th>
                <th>{t("cmp.steps")}</th><th>{t("cmp.systems")}</th><th>{t("cmp.metric.days")}</th><th>{t("cmp.metric.complete")}</th>
              </tr>
            </thead>
            <tbody>
              {ref && (
                <tr style={{ background: "var(--bg)" }}>
                  <td><strong>{t("cmp.reference")}</strong><br /><small className="muted">v{ref.def.version}</small></td>
                  <td>–</td><td>–</td><td>–</td><td>{ref.def.inputs?.length ?? 0}</td>
                  <td>{ref.def.nodes.filter((n) => n.kind !== "end").length}</td><td>{systemsOf(ref.def).length}</td><td>–</td><td>–</td>
                </tr>
              )}
              {[...data.offices].sort((a, b) => (b.harmony?.total ?? 0) - (a.harmony?.total ?? 0)).map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong><br /><small className="muted">v{o.def.version} · {o.live ? t("cmp.liveData") : t("cmp.demo")}</small></td>
                  <td>{o.harmony ? <Score value={o.harmony.total} /> : "–"}</td>
                  <td>{o.harmony ? `${o.harmony.structure} %` : "–"}</td>
                  <td>{o.harmony ? `${o.harmony.settings} %` : "–"}</td>
                  <td>{o.harmony ? `${o.harmony.inputs} %` : "–"}</td>
                  <td>{o.def.nodes.filter((n) => n.kind !== "end").length}</td>
                  <td>{systemsOf(o.def).length}</td>
                  <td>{o.metrics.medianDaysToDecision ?? "–"}</td>
                  <td>{o.metrics.firstTimeComplete === null ? "–" : `${o.metrics.firstTimeComplete} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "structure" && (
        <div className="stack">
          <div className="row">
            <label className="field" style={{ minWidth: 240 }}>{t("cmp.left")}
              <select value={left} onChange={(e) => setLeft(e.target.value)}>{columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <label className="field" style={{ minWidth: 240 }}>{t("cmp.right")}
              <select value={right} onChange={(e) => setRight(e.target.value)}>{columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <span className="small muted">{t("cmp.similar", { p: Math.round(diff.structure * 100) })}</span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{t("cmp.onlyHere")}</p>
          <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <section><h3>{L.name}</h3><ProcessViewer def={L.def} only={diff.unmatchedA} /></section>
            <section><h3>{R.name}</h3><ProcessViewer def={R.def} only={diff.unmatchedB} /></section>
          </div>
          <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {([[L.name, diff.stepsOnlyInA, diff.edgesOnlyInA], [R.name, diff.stepsOnlyInB, diff.edgesOnlyInB]] as const).map(([name, steps, edges]) => (
              <section className="card" key={name}>
                <h3>{t("cmp.stepsOnlyIn", { x: name })}</h3>
                {steps.length === 0 ? <p className="muted small">{t("cmp.identical")}</p> : <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>{steps.map((s, i) => <li key={i}>{stepText(s)}</li>)}</ul>}
                <h3 style={{ marginTop: "1rem" }}>{t("cmp.edgesOnlyIn", { x: name })}</h3>
                {edges.length === 0 ? <p className="muted small">{t("cmp.identical")}</p> : <ul style={{ margin: 0, paddingLeft: "1.1rem" }} className="small">{edges.map((s, i) => <li key={i}>{edgeText(s)}</li>)}</ul>}
              </section>
            ))}
          </div>
        </div>
      )}

      {tab === "inputs" && (() => {
        const keyOf = (i: ProcessInput) => `${i.type}:${i.ref}`;
        const rows: { key: string; label: string; type: ProcessInput["type"] }[] = [];
        for (const c of columns) for (const i of c.def.inputs ?? []) if (!rows.some((r) => r.key === keyOf(i))) {
          const label = i.type === "document" ? tk(`doc.${i.ref}`) : bi(knownInfoLabel(i.ref) ?? i.question?.label ?? { de: i.ref, en: i.ref });
          rows.push({ key: keyOf(i), label, type: i.type });
        }
        const text = (i: ProcessInput | undefined) => (i ? `${i.required ? t("cmp.req") : t("cmp.opt")} · ${bi(describeCondition(i.when))}` : "–");
        const find = (c: Column, key: string) => (c.def.inputs ?? []).find((i) => keyOf(i) === key);
        return (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>{t("cmp.inputsHint")} {t("cmp.harmonyBreakdown")}</p>
            <div className="table-wrap" style={{ overflowX: "auto" }}>
              <table className="matrix">
                <thead><tr><th style={{ minWidth: 260 }} />{columns.map((c) => <th key={c.id}>{c.name}</th>)}</tr></thead>
                <tbody>
                  {(["document", "info"] as const).map((type) => (
                    <>
                      <tr className="group" key={`g-${type}`}><td colSpan={columns.length + 1}>{t(type === "document" ? "inputs.document" : "inputs.info")}</td></tr>
                      {rows.filter((r) => r.type === type).map((r) => (
                        <tr key={r.key}>
                          <td>{r.label}</td>
                          {columns.map((c) => cell(text(find(c, r.key)), ref ? text(find(ref, r.key)) : undefined, c))}
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {tab === "settings" && (
        <div className="stack">
          {ref && <p className="small muted" style={{ margin: 0 }}>{t("cmp.differs")}</p>}
          <div className="table-wrap" style={{ overflowX: "auto" }}>
            <table className="matrix">
              <thead><tr><th style={{ minWidth: 260 }} />{columns.map((c) => <th key={c.id}>{c.name}</th>)}</tr></thead>
              <tbody>
                <tr className="group"><td colSpan={columns.length + 1}>{t("cmp.systemsUsed")}</td></tr>
                {allSystems.map((sys) => {
                  const refHas = ref ? systemsOf(ref.def).includes(sys) : undefined;
                  const l = signatureLabel(`connector|${sys}`);
                  return (
                    <tr key={sys}>
                      <td>{l.detail}</td>
                      {columns.map((c) => cell(systemsOf(c.def).includes(sys) ? "✓" : "–", refHas === undefined ? undefined : refHas ? "✓" : "–", c))}
                    </tr>
                  );
                })}
                <tr className="group"><td colSpan={columns.length + 1}>{t("cmp.extraction")}</td></tr>
                {DOCUMENT_KINDS.filter((k) => k !== "unknown").map((k) => (
                  <tr key={k}>
                    <td>{tk(`doc.${k}`)}</td>
                    {columns.map((c) => cell(tk(`cmp.method.${method(c.settings, k)}`), ref ? tk(`cmp.method.${method(ref.settings, k)}`) : undefined, c))}
                  </tr>
                ))}
                <tr className="group"><td colSpan={columns.length + 1}>{t("cmp.rules")}</td></tr>
                {ruleRows.map((r) => (
                  <tr key={r.id}>
                    <td>{bi(r.title)} <span className="small muted">{r.id}</span></td>
                    {columns.map((c) => cell(c.settings.approvedRules.includes(r.id) ? "✓" : "–", ref ? (ref.settings.approvedRules.includes(r.id) ? "✓" : "–") : undefined, c))}
                  </tr>
                ))}
                <tr className="group"><td colSpan={columns.length + 1}>{t("cmp.settings")}</td></tr>
                <tr><td>{t("cmp.sla")}</td>{columns.map((c) => cell(t("cmp.days", { n: c.settings.slaDays }), ref ? t("cmp.days", { n: ref.settings.slaDays }) : undefined, c))}</tr>
                <tr><td>{t("cmp.langs")}</td>{columns.map((c) => cell(c.settings.languages.map((l) => l.toUpperCase()).join(" · "), ref ? ref.settings.languages.map((l) => l.toUpperCase()).join(" · ") : undefined, c))}</tr>
              </tbody>
            </table>
          </div>
          {ref && (
            <p className="small muted">
              {data.offices.map((o) => `${o.name}: ${Math.round(compareSettings({ settings: o.settings, def: o.def }, { settings: ref.settings, def: ref.def }).score * 100)} %`).join(" · ")}
            </p>
          )}
        </div>
      )}

      {tab === "metrics" && (
        <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {metrics.map((m) => {
            const vals = data.offices.map((o) => m.get(o));
            const present = vals.filter((v): v is number => v !== null);
            const max = Math.max(1, ...present);
            const best = present.length ? (m.lower ? Math.min(...present) : Math.max(...present)) : null;
            return (
              <section className="card" key={m.key}>
                <h3>{t(m.label)} <span className="small muted" style={{ fontWeight: 400 }}>· {t(m.lower ? "cmp.lowerBetter" : "cmp.higherBetter")}</span></h3>
                <div className="bars">
                  {data.offices.map((o) => {
                    const v = m.get(o);
                    return (
                      <div key={o.id}>
                        <div className="row" style={{ justifyContent: "space-between" }}>
                          <span>{o.name}</span>
                          <span className="small" style={{ fontWeight: v === best ? 700 : 400, color: v === best ? "var(--ok)" : undefined }}>{v === null ? t("cmp.noData") : m.fmt(v)}</span>
                        </div>
                        <div className="bar-track"><div className="bar" style={{ width: v === null ? 0 : `${(v / max) * 100}%`, background: v === best ? "var(--ok)" : undefined }} /></div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
