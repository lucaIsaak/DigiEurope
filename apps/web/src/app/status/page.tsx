"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, TextInput } from "@/components/ui";
import { api, myApplications } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function StatusLookup() {
  const { t } = useI18n();
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [error, setError] = useState(false);
  const [mine, setMine] = useState<{ id: string; reference: string }[]>([]);
  useEffect(() => setMine(myApplications.list()), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(false);
    try {
      const { id } = await api.lookup(reference, birthDate);
      router.push(`/status/${id}`);
    } catch {
      setError(true);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>{t("lookup.title")}</h1>
      <p className="lead">{t("lookup.lead")}</p>
      <form className="card stack" onSubmit={submit}>
        <TextInput label={t("lookup.reference")} value={reference} onChange={setReference} hint="MS-2026-00001" />
        <TextInput label={t("person.birthDate")} type="date" value={birthDate} onChange={setBirthDate} />
        {error && <Alert kind="error">{t("lookup.notFound")}</Alert>}
        <button className="button" type="submit" disabled={!reference || !birthDate}>{t("lookup.submit")}</button>
      </form>
      {mine.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2>{t("lookup.mine")}</h2>
          <ul>
            {mine.map((a) => (
              <li key={a.id}><Link href={`/status/${a.id}`} className="mono">{a.reference}</Link></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
