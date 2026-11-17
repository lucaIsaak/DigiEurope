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
  useEffect(() => {
    api.staffList().then(setList).catch(() => setList([]));
  }, []);

  if (!list) return <Spinner label={t("common.loading")} />;
  if (!me?.isAdmin) return <p className="banner banner-warn">{t("staff.forbidden")}</p>;
  return (
    <div className="stack">
      <div>
        <h1>{t("staff.access.title")}</h1>
        <p className="lead" style={{ maxWidth: "70ch" }}>{t("staff.access.lead")}</p>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{t("staff.access.name")}</th><th>{t("staff.access.role")}</th><th>{t("staff.access.builder")}</th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.name}</strong><br /><small className="muted">{m.title}</small></td>
                <td><span className={`pill ${m.isAdmin ? "pill-ok" : m.canBuild ? "" : "pill-muted"}`}>{m.isAdmin ? t("staff.role.admin") : m.canBuild ? t("staff.role.builder") : t("staff.role.caseworker")}</span></td>
                <td>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={m.isAdmin || m.canBuild}
                      disabled={m.isAdmin}
                      onChange={async (e) => {
                        const r = await run(() => api.setBuildAccess(m.id, e.target.checked));
                        if (r) setList(r);
                      }}
                    />
                    <span className="small muted">{t("staff.access.builder")}</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
