"use client";

import type { StaffMember } from "@digieurope/shared";
import { useEffect, useState } from "react";
import { Spinner, useAsyncError } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";

export default function StaffAccess() {
  const { t } = useI18n();
  const { staff: me } = useStaff();
  const [list, setList] = useState<StaffMember[] | null>(null);
  const { error, run } = useAsyncError();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [takes, setTakes] = useState(true);
  const [builder, setBuilder] = useState(false);
  useEffect(() => {
    api.staffList().then(setList).catch(() => setList([]));
  }, []);

  if (!list) return <Spinner label={t("common.loading")} />;
  if (!me?.isAdmin) return <p className="banner banner-warn">{t("staff.forbidden")}</p>;
  return (
    <div className="stack">
      <div className="ins-head">
        <h1>{t("staff.access.title")}</h1>
        <p className="lead" style={{ maxWidth: "70ch" }}>{t("staff.access.lead")}</p>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{t("staff.access.name")}</th><th>{t("staff.access.role")}</th><th>{t("staff.access.builder")}</th><th>{t("staff.access.templates")}</th><th>{t("staff.access.cases")}</th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.name}</strong><br /><small className="muted">{m.title}</small></td>
                <td><span>{m.isAdmin ? t("staff.role.admin") : m.isOversight ? t("oversight.label") : m.canApproveTemplates ? t("staff.role.owner") : m.canBuild ? t("staff.role.builder") : t("staff.role.caseworker")}</span></td>
                <td>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={m.isAdmin || m.canBuild}
                      disabled={m.isAdmin}
                      onChange={async (e) => {
                        const r = await run(() => api.setAccess(m.id, { canBuild: e.target.checked }));
                        if (r) setList(r);
                      }}
                    />
                    <span className="small muted">{t("staff.access.builder")}</span>
                  </label>
                </td>
                <td>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={m.isAdmin || Boolean(m.canApproveTemplates)}
                      disabled={m.isAdmin}
                      onChange={async (e) => {
                        const r = await run(() => api.setAccess(m.id, { canApproveTemplates: e.target.checked }));
                        if (r) setList(r);
                      }}
                    />
                    <span className="small muted">{t("staff.access.templates")}</span>
                  </label>
                </td>
                <td>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={Boolean(m.isCaseworker)}
                      disabled={Boolean(m.isOversight)}
                      onChange={async (e) => {
                        const r = await run(() => api.setAccess(m.id, { isCaseworker: e.target.checked }));
                        if (r) setList(r);
                      }}
                    />
                    <span className="small muted">{t("staff.access.cases")}</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="add-person"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const r = await run(() => api.addStaff({ name, title, isCaseworker: takes, canBuild: builder }));
          if (r) {
            setList(r);
            setName("");
            setTitle("");
            setTakes(true);
            setBuilder(false);
          }
        }}
      >
        <h2>{t("staff.add.title")}</h2>
        <div className="add-person-row">
          <label className="field">{t("staff.add.name")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Frau Beispielname" /></label>
          <label className="field">{t("staff.add.jobTitle")}<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sachbearbeitung Ausland" /></label>
        </div>
        <div className="row">
          <label className="row"><input type="checkbox" checked={takes} onChange={(e) => setTakes(e.target.checked)} /><span className="small">{t("staff.access.cases")}</span></label>
          <label className="row"><input type="checkbox" checked={builder} onChange={(e) => setBuilder(e.target.checked)} /><span className="small">{t("staff.access.builder")}</span></label>
          <button className="button" type="submit" disabled={!name.trim()}>{t("staff.add.button")}</button>
        </div>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
