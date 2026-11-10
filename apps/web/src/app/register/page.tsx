"use client";

import type { DemoPersona } from "@digieurope/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui";
import { api, myApplications } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function StartRegistration() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [personas, setPersonas] = useState<DemoPersona[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.personas().then(setPersonas).catch((e: Error) => setError(e.message));
  }, []);

  async function start(identityMethod: "eid" | "passport", personaId?: string) {
    setBusy(true);
    setError(null);
    try {
      const app = await api.create({ identityMethod, personaId, language: lang });
      myApplications.add(app.id, app.reference);
      router.push(`/register/${app.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{t("start.title")}</h1>
      <p className="lead">{t("start.lead")}</p>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grid-2" style={{ marginTop: 24 }}>
        <section className="card stack">
          <div className="row">
            <h2 style={{ margin: 0 }}>{t("start.passport.title")}</h2>
            <span className="pill pill-neutral">{t("start.passport.badge")}</span>
          </div>
          <p>{t("start.passport.text")}</p>
          <button className="button button-large" disabled={busy} onClick={() => start("passport")}>
            {t("start.passport.use")}
          </button>
        </section>
        <section className="card stack">
          <div className="row">
            <h2 style={{ margin: 0 }}>{t("start.eid.title")}</h2>
            <span className="pill pill-ok">{t("start.eid.badge")}</span>
          </div>
          <p>{t("start.eid.text")}</p>
          <Alert kind="info">{t("start.eid.demo")}</Alert>
          <div className="stack">
            {personas.map((p) => (
              <button key={p.id} className="button button-secondary" style={{ width: "100%", justifyContent: "space-between" }} disabled={busy} onClick={() => start("eid", p.id)}>
                <span>{t("start.eid.use", { name: p.label })}</span>
                <small className="muted" style={{ fontWeight: 400 }}>{p.description}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="hint" style={{ marginTop: 24 }}>{t("start.privacy")}</p>
    </>
  );
}
