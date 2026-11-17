"use client";

import { CheckCircle2, Lock, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Spinner, useAsyncError } from "@/components/ui";
import { api, type ExtractionSettings, type OfficeConfigResponse } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { useStaff } from "@/lib/staff";

export default function Settings() {
  const { t, bi } = useI18n();
  const { staff } = useStaff();
  const [cfg, setCfg] = useState<OfficeConfigResponse | null>(null);
  const [ex, setEx] = useState<ExtractionSettings | null>(null);
  const [sla, setSla] = useState(5);
  const [saved, setSaved] = useState(false);
  const { error, run } = useAsyncError();
  const owner = Boolean(staff?.isAdmin || staff?.canApproveTemplates);

  const load = useCallback(async () => {
    const c = await api.config();
    setCfg(c);
    setSla(c.config.slaDays);
    setEx(await api.extraction());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!cfg || !ex) return <Spinner label={t("common.loading")} />;
  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <span className="eyebrow"><SlidersHorizontal size={14} />{t("side.admin")}</span>
          <h1>{t("set.title")}</h1>
          <p>{t("set.lead")}</p>
        </div>
        {saved && <span className="badge ok"><CheckCircle2 size={13} />{t("set.saved")}</span>}
      </div>

      <section className="panel" style={{ padding: "1.4rem", display: "grid", gap: "1.2rem" }}>
        <label className="field">{t("office.inputs.sla")}
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input type="number" min={1} max={60} value={sla} onChange={(e) => setSla(Number(e.target.value))} style={{ maxWidth: 120 }} />
            <button className="button button-small" type="button" onClick={async () => { const r = await run(() => api.saveConfig({ slaDays: sla })); if (r) flash(); }}>{t("common.save")}</button>
          </div>
        </label>
        <label className="field">{t("set.default")}
          <select disabled={!owner} value={ex.config.defaultMethod} onChange={async (e) => { const r = await run(() => api.setExtraction("default", e.target.value as ExtractionSettings["config"]["defaultMethod"])); if (r) { await load(); flash(); } }}>
            {ex.methods.map((m) => <option key={m.id} value={m.id}>{bi(m.name)} · {t(`read.status.${m.status}` as MessageKey)}</option>)}
          </select>
          {!owner && <span className="reason"><Lock size={13} />{t("t2.reading.owner")}</span>}
        </label>
        <div className="kv" style={{ fontSize: "0.92rem" }}>
          <dt className="muted">{t("office.inputs.languages")}</dt><dd>{cfg.config.languages.map((l) => l.toUpperCase()).join(" · ")}</dd>
          <dt className="muted">{t("office.inputs.fileTypes")}</dt><dd>PDF</dd>
          <dt className="muted">{t("office.inputs.workflow")}</dt><dd>{cfg.config.workflow.join(" → ")}</dd>
        </div>
        {!ex.aiKey && <p className="small muted" style={{ margin: 0 }}>{t("read.aiNote")}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
      </section>
    </div>
  );
}
