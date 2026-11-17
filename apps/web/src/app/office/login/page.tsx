"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Spinner, useAsyncError } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";

export default function StaffLogin() {
  const { t } = useI18n();
  const { staff, login } = useStaff();
  const router = useRouter();
  const [accounts, setAccounts] = useState<{ id: string; name: string; title: string }[] | null>(null);
  const { error, run } = useAsyncError();
  useEffect(() => void api.staffAccounts().then(setAccounts), []);
  useEffect(() => {
    if (staff) router.replace("/office");
  }, [staff, router]);

  if (!accounts) return <Spinner label={t("common.loading")} />;
  return (
    <div className="narrow stack">
      <h1>{t("staff.login.title")}</h1>
      <p className="lead">{t("staff.login.lead")}</p>
      <div className="list-select">
        {accounts.map((a) => (
          <button key={a.id} type="button" onClick={() => void run(() => login(a.id))}>
            <strong>{a.name}</strong>
            <small>{a.title}</small>
          </button>
        ))}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <p className="small muted">{t("staff.login.demo")}</p>
    </div>
  );
}
