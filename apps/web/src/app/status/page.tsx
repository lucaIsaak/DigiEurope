"use client";

import { ArrowRight, FileText, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, useAsyncError } from "@/components/ui";
import { api, myApplications } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function Status() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [mine, setMine] = useState<{ id: string; reference: string }[]>([]);
  const { error, run } = useAsyncError();
  useEffect(() => {
    setMine(myApplications.list());
  }, []);

  return (
    <div className="center-card">
      <span className="icon-badge"><Search size={24} /></span>
      <h1>{t("st.title")}</h1>
      <p className="muted">{t("st.lead")}</p>

      {mine.length > 0 && (
        <section style={{ margin: "1.5rem 0" }}>
          <h3 className="small muted" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("st.mine")}</h3>
          <div className="stack" style={{ gap: "0.5rem" }}>
            {mine.map((m) => (
              <Link key={m.id} href={`/case/${m.id}`} className="account" style={{ textDecoration: "none" }}>
                <span className="av" style={{ background: "var(--primary)" }}><FileText size={18} /></span>
                <span style={{ flex: 1 }}><strong className="num">{m.reference}</strong><small>{t("nav.status")}</small></span>
                <ArrowRight size={16} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await run(() => api.lookup(reference, birthDate).catch(() => Promise.reject(new Error(t("lookup.notFound")))));
          if (res) router.push(`/case/${res.id}`);
        }}
      >
        <Field label={t("common.reference")}><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="MS-2026-00001" required /></Field>
        <Field label={t("apply.birthDate")}><input type="date" lang={lang} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required /></Field>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="button" type="submit">{t("lookup.button")} <ArrowRight size={16} /></button>
      </form>
    </div>
  );
}
