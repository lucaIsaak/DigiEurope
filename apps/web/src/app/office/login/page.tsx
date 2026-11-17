"use client";

import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Spinner, useAsyncError } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";

function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 45%)`;
}

export default function StaffLogin() {
  const { t, lang, setLang } = useI18n();
  const { staff, login } = useStaff();
  const router = useRouter();
  const [accounts, setAccounts] = useState<{ id: string; name: string; title: string }[] | null>(null);
  const { error, run } = useAsyncError();
  useEffect(() => {
    api.staffAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);
  useEffect(() => {
    if (staff) router.replace(staff.isOversight ? "/oversight" : "/office");
  }, [staff, router]);

  return (
    <div className="login-split">
      <div className="login-art">
        <div className="row" style={{ gap: "0.6rem" }}>
          <span className="brand-mark" aria-hidden>SM</span>
          <strong>{t("brand.name")}</strong>
        </div>
        <div>
          <ShieldCheck size={36} style={{ opacity: 0.8 }} />
          <h2>{t("login.art.title")}</h2>
          <p style={{ opacity: 0.8, maxWidth: "38ch" }}>{t("login.art.lead")}</p>
        </div>
        <small style={{ opacity: 0.6 }}>{t("footer.note")}</small>
      </div>
      <div className="login-form">
        <div style={{ width: "min(420px, 100%)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: "2rem" }}>
            <Link href="/" className="small" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ArrowLeft size={14} />{t("login.back")}</Link>
            <div className="lang-switch" role="group" aria-label={t("lang.label")}>
              {(["de", "en"] as const).map((l) => <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
            </div>
          </div>
          <h1 style={{ fontSize: "1.8rem" }}>{t("staff.login.title")}</h1>
          <p className="muted">{t("staff.login.lead")}</p>
          {!accounts ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <div className="stack" style={{ gap: "0.55rem", marginTop: "1.4rem" }}>
              {accounts.map((a) => (
                <button key={a.id} type="button" className="account" onClick={() => void run(() => login(a.id))}>
                  <span className="av" style={{ background: hue(a.name) }}>{a.name.split(" ").pop()?.[0]}</span>
                  <span style={{ flex: 1 }}><strong>{a.name}</strong><small>{a.title}</small></span>
                  <ArrowRight size={16} color="var(--muted)" />
                </button>
              ))}
            </div>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
          <p className="small muted" style={{ marginTop: "1.4rem" }}>{t("staff.login.demo")}</p>
        </div>
      </div>
    </div>
  );
}
