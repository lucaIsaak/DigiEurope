"use client";

import { use, useCallback, useEffect, useState } from "react";
import { DropZone, Spinner } from "@/components/ui";
import { api, type ParentView } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function ParentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { t } = useI18n();
  const [v, setV] = useState<ParentView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setV(await api.parent(token));
    } catch {
      setMissing(true);
    }
  }, [token]);
  useEffect(() => void load(), [load]);

  if (missing) return <p className="error-text narrow">{t("parent.notFound")}</p>;
  if (!v) return <Spinner label={t("common.loading")} />;

  const form = v.documents.find((d) => d.kind === "parent_form" && d.readable);
  const tax = v.documents.find((d) => d.kind === "parent_tax" && d.readable);
  const problems: string[] = [];
  if (form && form.signed === false) problems.push(t("parent.problem"));
  if (tax && tax.taxYear && Number(tax.taxYear) !== v.incomeYear) problems.push(t("parent.wrongYear", { year: tax.taxYear, need: v.incomeYear }));
  const done = Boolean(form && tax) && problems.length === 0;

  async function upload(files: File[]) {
    setBusy(true);
    const errs: string[] = [];
    for (const f of files) {
      try {
        setV(await api.parentUpload(token, f));
      } catch (e) {
        errs.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setErrors(errs);
    setBusy(false);
  }

  return (
    <div className="narrow stack">
      <h1>{t("parent.title", { name: v.studentName })}</h1>
      <p className="lead">{t("parent.lead")}</p>
      <section className="card">
        <h2>{t("parent.need")}</h2>
        <ul>
          <li>{t("parent.need.form")} {form && (form.signed === false ? "✗" : "✓")}</li>
          <li>{t("parent.need.tax", { year: v.incomeYear })} {tax && (tax.taxYear && Number(tax.taxYear) !== v.incomeYear ? "✗" : "✓")}</li>
        </ul>
        {done ? <p className="banner banner-ok" style={{ marginBottom: 0 }}>✓ {t("parent.done")}</p> : <DropZone label={t("parent.upload")} busy={busy} busyLabel={t("case.docs.reading")} onFiles={upload} />}
        {problems.map((p) => <p key={p} className="banner banner-warn" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{p}</p>)}
        {done === false && problems.length > 0 && <div style={{ marginTop: "0.75rem" }}><DropZone label={t("parent.upload")} busy={busy} busyLabel={t("case.docs.reading")} onFiles={upload} /></div>}
        {errors.map((e) => <p key={e} className="error-text">{e}</p>)}
      </section>
      <p className="small muted">{t("parent.privacy")}</p>
    </div>
  );
}
