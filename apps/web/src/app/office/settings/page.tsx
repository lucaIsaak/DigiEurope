"use client";

import { Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AssignmentTable } from "@/components/AssignmentTable";
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
    <div className="set">
      <div className="page-head">
        <div>
          <h1>{t("set.title")}</h1>
          <p>{t("set.lead")}</p>
        </div>
        {saved && <span className="q-status ok"><i />{t("set.saved")}</span>}
      </div>

      <div className="set-row">
        <div>
          <label htmlFor="set-sla">{t("office.inputs.sla")}</label>
        </div>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id="set-sla" type="number" min={1} max={60} value={sla} onChange={(e) => setSla(Number(e.target.value))} style={{ maxWidth: 100 }} />
          <button className="button button-small" type="button" onClick={async () => { const r = await run(() => api.saveConfig({ slaDays: sla })); if (r) flash(); }}>{t("common.save")}</button>
        </div>
      </div>
      <div className="set-row">
        <div>
          <label htmlFor="set-default">{t("set.default")}</label>
          {!owner && <p className="reason"><Lock size={13} />{t("t2.reading.owner")}</p>}
        </div>
        <select id="set-default" disabled={!owner} value={ex.config.defaultMethod} onChange={async (e) => { const r = await run(() => api.setExtraction("default", e.target.value as ExtractionSettings["config"]["defaultMethod"])); if (r) { await load(); flash(); } }}>
          {ex.methods.map((m) => <option key={m.id} value={m.id}>{bi(m.name)} · {t(`read.status.${m.status}` as MessageKey)}</option>)}
        </select>
      </div>
      <div className="set-row"><div>{t("office.inputs.languages")}</div><div>{cfg.config.languages.map((l) => l.toUpperCase()).join(" · ")}</div></div>
      <div className="set-row"><div>{t("office.inputs.fileTypes")}</div><div>PDF</div></div>
      <div className="set-row"><div>{t("office.inputs.workflow")}</div><div>{cfg.config.workflow.join(" → ")}</div></div>
      <AssignmentTable />
      {!ex.aiKey && <p className="small muted" style={{ marginTop: "1rem" }}>{t("read.aiNote")}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
