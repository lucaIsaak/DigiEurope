"use client";

import { DESTINATIONS, type StayType } from "@digieurope/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, useAsyncError } from "@/components/ui";
import { api, myApplications } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const SAMPLE = {
  mira: { firstName: "Mira", lastName: "Sommer", birthDate: "2003-05-17", email: "mira.sommer@example.org", university: "Universität Musterstadt", course: "Politikwissenschaft (B.A.)", type: "study" as StayType, country: "CA", city: "Toronto", institution: "Lakeshore University", tuition: "4200", months: [4, 7] as const },
};

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function Apply() {
  const { t, lang, country } = useI18n();
  const router = useRouter();
  const { error, setError, run } = useAsyncError();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ firstName: "", lastName: "", birthDate: "", email: "", university: "Universität Musterstadt", course: "", type: "study" as StayType, country: "CA", city: "", institution: "", startDate: "", endDate: "", tuition: "0" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  function fillSample() {
    // Matches the downloadable sample documents: starts a few months from today, runs 28 weeks.
    const later = new Date(Date.now() + 140 * 86_400_000);
    const start = new Date(Date.UTC(later.getUTCFullYear(), later.getUTCMonth() + 1, 1));
    const s = SAMPLE.mira;
    setF({ ...f, firstName: s.firstName, lastName: s.lastName, birthDate: s.birthDate, email: s.email, university: s.university, course: s.course, type: s.type, country: s.country, city: s.city, institution: s.institution, startDate: iso(start), endDate: iso(new Date(start.getTime() + 28 * 7 * 86_400_000)), tuition: s.tuition });
  }

  // Hidden demo shortcut: Shift+Alt+D fills in the sample student that matches the sample documents.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.altKey && e.code === "KeyD") fillSample();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.firstName || !f.lastName || !f.birthDate || !f.startDate || !f.endDate || f.endDate <= f.startDate) return setError(t("apply.invalid"));
    setBusy(true);
    const created = await run(() =>
      api.create({
        language: lang,
        student: { firstName: f.firstName, lastName: f.lastName, birthDate: f.birthDate, email: f.email, university: f.university, course: f.course },
        stay: { type: f.type, country: f.country, city: f.city, institution: f.institution, startDate: f.startDate, endDate: f.endDate, tuitionFees: f.type === "study" ? Number(f.tuition) || 0 : 0 },
      }),
    );
    setBusy(false);
    if (created) {
      myApplications.add(created.id, created.reference);
      router.push(`/case/${created.id}`);
    }
  }

  return (
    <div className="narrow">
      <h1>{t("apply.title")}</h1>
      <p className="lead">{t("apply.lead")}</p>
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label={t("apply.firstName")}><input value={f.firstName} onChange={set("firstName")} autoComplete="given-name" required /></Field>
          <Field label={t("apply.lastName")}><input value={f.lastName} onChange={set("lastName")} autoComplete="family-name" required /></Field>
          <Field label={t("apply.birthDate")}><input type="date" value={f.birthDate} onChange={set("birthDate")} required /></Field>
          <Field label={t("apply.email")}><input type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
          <Field label={t("apply.university")}><input value={f.university} onChange={set("university")} /></Field>
          <Field label={t("apply.course")}><input value={f.course} onChange={set("course")} /></Field>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{t("apply.type")}</legend>
          <div className="radio-cards">
            {(["study", "internship"] as const).map((k) => (
              <label className="radio-card" key={k}>
                <input type="radio" name="type" checked={f.type === k} onChange={() => setF((x) => ({ ...x, type: k }))} />
                {t(`apply.type.${k}` as const)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-grid">
          <Field label={t("apply.country")}>
            <select value={f.country} onChange={set("country")}>
              {DESTINATIONS.map((c) => <option key={c} value={c}>{country(c)}</option>)}
            </select>
          </Field>
          <Field label={t("apply.city")}><input value={f.city} onChange={set("city")} /></Field>
          <Field label={f.type === "study" ? t("apply.institution.study") : t("apply.institution.internship")} className="full"><input value={f.institution} onChange={set("institution")} /></Field>
          <Field label={t("apply.start")}><input type="date" value={f.startDate} onChange={set("startDate")} required /></Field>
          <Field label={t("apply.end")}><input type="date" value={f.endDate} onChange={set("endDate")} required /></Field>
          {f.type === "study" && (
            <Field label={t("apply.tuition")} hint={t("apply.tuition.hint")} className="full"><input type="number" min="0" step="100" value={f.tuition} onChange={set("tuition")} /></Field>
          )}
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="row">
          <button className="button" type="submit" disabled={busy}>{t("apply.submit")}</button>
        </div>
      </form>
    </div>
  );
}
