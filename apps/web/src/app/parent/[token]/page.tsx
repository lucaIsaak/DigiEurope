"use client";

import { CheckCircle2, Circle, Clock, Users } from "lucide-react";
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
  useEffect(() => {
    void load();
  }, [load]);

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

  const okForm = Boolean(form && form.signed !== false);
  const okTax = Boolean(tax && !(tax.taxYear && Number(tax.taxYear) !== v.incomeYear));
  return (
    <div className="center-card stack">
      <span className="icon-badge"><Users size={24} /></span>
      <div>
        <h1 style={{ marginBottom: "0.4rem" }}>{t("parent.title", { name: v.studentName })}</h1>
        <p className="muted" style={{ margin: 0 }}>{t("parent.lead")}</p>
        <p className="small muted" style={{ marginTop: "0.5rem" }}><Clock size={13} style={{ verticalAlign: "-2px" }} /> {t("par.time")}</p>
      </div>
      <section className="card">
        <h3>{t("par.steps")}</h3>
        <ul className="need-list" style={{ marginBottom: "1rem" }}>
          <li>{okForm ? <CheckCircle2 size={18} color="var(--ok)" /> : <Circle size={18} />}{t("par.s1")}</li>
          <li>{okTax ? <CheckCircle2 size={18} color="var(--ok)" /> : <Circle size={18} />}{t("par.s2", { year: v.incomeYear })}</li>
          <li>{done ? <CheckCircle2 size={18} color="var(--ok)" /> : <Circle size={18} />}{t("par.s3")}</li>
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
