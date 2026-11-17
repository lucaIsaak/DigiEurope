"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, useAsyncError } from "@/components/ui";
import { api, myApplications } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function Status() {
  const { t } = useI18n();
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [mine, setMine] = useState<{ id: string; reference: string }[]>([]);
  const { error, run } = useAsyncError();
  useEffect(() => setMine(myApplications.list()), []);

  return (
    <div className="narrow stack">
      <h1>{t("lookup.title")}</h1>
      <p className="lead">{t("lookup.lead")}</p>
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await run(() => api.lookup(reference, birthDate).catch(() => Promise.reject(new Error(t("lookup.notFound")))));
          if (res) router.push(`/case/${res.id}`);
        }}
      >
        <div className="form-grid">
          <Field label={t("common.reference")}><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="MS-2026-00001" required /></Field>
          <Field label={t("apply.birthDate")}><input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required /></Field>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div><button className="button" type="submit">{t("lookup.button")}</button></div>
      </form>
      {mine.length > 0 && (
        <section className="card">
          <h2>{t("lookup.mine")}</h2>
          <ul>{mine.map((m) => <li key={m.id}><Link href={`/case/${m.id}`}>{m.reference}</Link></li>)}</ul>
        </section>
      )}
    </div>
  );
}
