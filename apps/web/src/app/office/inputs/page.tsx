"use client";

import type { Extraction } from "@digieurope/shared";
import { useCallback, useEffect, useState } from "react";
import { DropZone, Spinner, useAsyncError } from "@/components/ui";
import { api, sampleUrl, type ExtractionSettings, type OfficeConfigResponse } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

export default function Inputs() {
  const { t, tk, bi, dateTime } = useI18n();
  const [cfg, setCfg] = useState<OfficeConfigResponse | null>(null);
  const [sla, setSla] = useState(5);
  const [read, setRead] = useState<{ kind: string; extraction: Extraction; name: string } | null>(null);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ex, setEx] = useState<ExtractionSettings | null>(null);
  const [exSaved, setExSaved] = useState(false);
  const { error, run } = useAsyncError();

  const load = useCallback(async () => {
    const c = await api.config();
    setCfg(c);
    setSla(c.config.slaDays);
    setEx(await api.extraction());
  }, []);
  useEffect(() => void load(), [load]);

  async function extract(file: File) {
    setBusy(true);
    setSaved(false);
    const r = await run(() => api.extractInput(file));
    if (r) {
      setRead({ ...r, name: file.name });
      setKeep(Object.fromEntries([...Object.keys(r.extraction.fields), ...Object.keys(r.extraction.signatures).map((k) => `sig:${k}`)].map((k) => [k, true])));
    }
    setBusy(false);
  }

  async function loadSample(value: string) {
    if (!value) return;
    const [set, folder, ...name] = value.split("|");
    const res = await fetch(sampleUrl(set!, folder as "docs" | "fixes", name.join("|")));
    await extract(new File([await res.blob()], name.join("|"), { type: "application/pdf" }));
  }

  const [samples, setSamples] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    void api.samples().then((s) => {
      const out = s.sets.flatMap((x) => x.docs.map((d) => ({ value: `${x.id}|docs|${d.name}`, label: `${x.id}: ${d.name}` })));
      out.push({ value: `letter|docs|${s.letter}`, label: s.letter });
      setSamples(out);
    });
  }, []);

  if (!cfg) return <Spinner label={t("common.loading")} />;
  const c = cfg.config;
  const typeOf = (kind: string) => cfg.documentTypes.find((d) => d.kind === kind);

  return (
    <div className="stack">
      <div>
        <h1>{t("office.inputs.title")}</h1>
        <p className="lead" style={{ maxWidth: "70ch" }}>{t("office.inputs.lead")}</p>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <section className="card stack">
          <h2>{t("office.inputs.sample")}</h2>
          <DropZone label={t("office.inputs.choose")} multiple={false} accept="application/pdf" busy={busy} busyLabel={t("case.docs.reading")} onFiles={(f) => void extract(f[0]!)} />
          <label className="field">{t("office.inputs.load")}
            <select defaultValue="" onChange={(e) => void loadSample(e.target.value)}>
              <option value="" />
              {samples.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          {error && <p className="error-text" role="alert">{error}</p>}
          {read && (
            <div>
              <h3>{t("office.inputs.read")} · {tk(`doc.${read.kind}`)}</h3>
              {!read.extraction.readable ? (
                <p className="banner banner-bad">{t("office.inputs.unreadable")}</p>
              ) : (
                <>
                  <table className="estimate-table">
                    <tbody>
                      {Object.entries(read.extraction.fields).map(([k, v]) => (
                        <tr key={k}>
                          <td><label className="row"><input type="checkbox" checked={keep[k] ?? false} onChange={(e) => setKeep({ ...keep, [k]: e.target.checked })} /> {tk(`field.${k}`)}</label></td>
                          <td>{v}</td>
                        </tr>
                      ))}
                      {Object.entries(read.extraction.signatures).map(([k, ok]) => (
                        <tr key={k}>
                          <td><label className="row"><input type="checkbox" checked={keep[`sig:${k}`] ?? false} onChange={(e) => setKeep({ ...keep, [`sig:${k}`]: e.target.checked })} /> {tk(`sig.${k}`)}</label></td>
                          <td>{ok ? `✓ ${t("office.inputs.signature")}` : "✗"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="small muted">{t("office.inputs.fieldOk")}</p>
                  <button className="button" type="button" onClick={async () => { await run(() => api.confirmInput(read.kind as never, Object.keys(keep).filter((k) => keep[k]))); setSaved(true); await load(); }}>{t("office.inputs.confirm")}</button>
                  {saved && <span className="pill pill-ok" style={{ marginLeft: "0.5rem" }}>✓ {t("office.inputs.saved")}</span>}
                </>
              )}
            </div>
          )}
        </section>

        <section className="card stack">
          <h2>{t("office.inputs.types")}</h2>
          {cfg.documentTypes.map((d) => {
            const conf = c.expectedInputs[d.kind];
            return (
              <div key={d.kind} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: "0.5rem" }}>
                <div><strong>{tk(`doc.${d.kind}`)}</strong><br /><small className="muted">{d.fields.length} {t("office.inputs.fieldOk").length ? "·" : ""} {d.signatures.length ? `${d.signatures.length} ✍` : ""}</small></div>
                {conf ? <span className="pill pill-ok" title={dateTime(conf.confirmedAt)}>✓ {t("office.inputs.confirmed")}</span> : <span className="pill pill-warn">{t("office.inputs.notConfirmed")}</span>}
              </div>
            );
          })}
          {read && typeOf(read.kind) ? null : null}
        </section>
      </div>


      {ex && (
        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{t("read.title")}</h2>
            {exSaved && <span className="pill pill-ok">✓ {t("read.saved")}</span>}
          </div>
          <p className="muted" style={{ margin: 0, maxWidth: "80ch" }}>{t("read.lead")}</p>
          <div className="grid-2" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {ex.methods.map((m) => (
              <div key={m.id} className="stat" style={{ display: "grid", gap: "0.35rem" }}>
                <strong style={{ fontSize: "1rem" }}>{bi(m.name)}</strong>
                <span className={`pill ${m.status === "connected" ? "pill-ok" : m.status === "simulated" ? "pill-warn" : "pill-muted"}`} style={{ width: "fit-content" }}>{t(`read.status.${m.status}` as MessageKey)}</span>
                <span className="small muted">{bi(m.description)}</span>
              </div>
            ))}
          </div>
          {!ex.aiKey && <p className="small muted" style={{ margin: 0 }}>{t("read.aiNote")}</p>}
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t("office.inputs.types")}</th><th>{t("read.method")}</th><th>{t("read.minConfidence")}</th></tr></thead>
              <tbody>
                {[{ kind: "default" as const, label: t("read.default") }, ...cfg.documentTypes.map((d) => ({ kind: d.kind, label: tk(`doc.${d.kind}`) }))].map((row) => {
                  const cur = row.kind === "default" ? { method: ex.config.defaultMethod, minConfidence: ex.defaultMinConfidence } : (ex.config.byType[row.kind] ?? { method: ex.config.defaultMethod, minConfidence: ex.defaultMinConfidence });
                  const save = async (method: typeof cur.method, min: number) => {
                    await run(() => api.setExtraction(row.kind, method, min));
                    setEx(await api.extraction());
                    setExSaved(true);
                  };
                  return (
                    <tr key={row.kind}>
                      <td>{row.label}</td>
                      <td>
                        <select value={cur.method} onChange={(e) => void save(e.target.value as typeof cur.method, cur.minConfidence)} aria-label={`${row.label}: ${t("read.method")}`}>
                          {ex.methods.map((m) => <option key={m.id} value={m.id}>{bi(m.name)}{m.status === "placeholder" ? " ·" : ""}</option>)}
                        </select>
                      </td>
                      <td>
                        {row.kind === "default" ? <span className="muted small">–</span> : (
                          <select value={String(cur.minConfidence)} onChange={(e) => void save(cur.method, Number(e.target.value))} aria-label={`${row.label}: ${t("read.minConfidence")}`}>
                            {[0.6, 0.7, 0.8, 0.9, 0.95].map((v) => <option key={v} value={v}>{Math.round(v * 100)} %</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h2>{t("office.inputs.local")}</h2>
        <div className="form-grid">
          <label className="field">{t("office.inputs.sla")}<input type="number" min={1} max={60} value={sla} onChange={(e) => setSla(Number(e.target.value))} /></label>
          <div><strong style={{ fontSize: "0.92rem" }}>{t("office.inputs.languages")}</strong><p style={{ marginBottom: 0 }}>{c.languages.map((l) => l.toUpperCase()).join(" · ")}</p></div>
          <div><strong style={{ fontSize: "0.92rem" }}>{t("office.inputs.fileTypes")}</strong><p style={{ marginBottom: 0 }}>PDF</p></div>
          <div><strong style={{ fontSize: "0.92rem" }}>{t("office.inputs.workflow")}</strong><p style={{ marginBottom: 0 }}>{c.workflow.join(" → ")}</p></div>
        </div>
        <button className="button button-ghost" style={{ marginTop: "0.75rem" }} type="button" onClick={async () => { await run(() => api.saveConfig({ slaDays: sla })); await load(); }}>{t("common.save")}</button>
      </section>
    </div>
  );
}
