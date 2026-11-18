"use client";

import { Lock, Plug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAsyncError } from "@/components/ui";
import { api, type ConnectionView } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";

/** The office's connections to its systems. They belong to the office, so they keep working when the person who set them up leaves. */
export function ConnectionsPanel() {
  const { t, bi, dateTime } = useI18n();
  const { staff } = useStaff();
  const [list, setList] = useState<ConnectionView[] | null>(null);
  const { error, run } = useAsyncError();
  const admin = Boolean(staff?.isAdmin);
  const load = useCallback(async () => setList(await api.connections()), []);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  if (!list) return null;
  return (
    <section className="as" aria-labelledby="cn-h">
      <h2 id="cn-h">{t("conn.title")}</h2>
      <p className="muted">{t("conn.lead")}</p>
      {!admin && <p className="reason"><Lock size={13} />{t("conn.adminOnly")}</p>}
      <div className="conn-grid">
        {list.map((c) => (
          <div key={c.system} className={`conn${c.enabled ? "" : " off"}`}>
            <div className="conn-head"><Plug size={16} /><strong>{bi(c.name)}</strong><span className={`chip ${c.enabled ? "ok" : "mute"}`}>{c.enabled ? t("conn.on") : t("conn.off")}</span></div>
            <p className="small muted">{c.actions.map((a) => bi(a.label)).join(" · ")}</p>
            <p className="small">{t("conn.owner")}: {c.owner}</p>
            <p className="small">{c.usedIn.length ? `${t("conn.usedIn")}: ${c.usedIn.map((u) => u.name).join(", ")}` : t("conn.unused")}</p>
            <p className="small muted">{c.lastTest ? `${t("conn.tested")}: ${dateTime(c.lastTest.at)} · ${c.lastTest.by} · ${c.lastTest.ok ? t("conn.ok") : t("conn.failed")}` : t("conn.neverTested")}</p>
            {admin && (
              <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
                <label className="row small"><input type="checkbox" checked={c.enabled} onChange={async (e) => { await run(() => api.setConnection(c.system, { enabled: e.target.checked })); await load(); }} />{t("conn.enabled")}</label>
                <select value={c.mode} aria-label={t("conn.mode")} onChange={async (e) => { await run(() => api.setConnection(c.system, { mode: e.target.value as "sandbox" | "live" })); await load(); }}>
                  <option value="sandbox">{t("conn.sandbox")}</option>
                  <option value="live">{t("conn.live")}</option>
                </select>
                <button type="button" className="button button-ghost button-small" onClick={async () => { await run(() => api.testConnection(c.system)); await load(); }}>{t("conn.test")}</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
