"use client";

import { BUILTIN_TEMPLATES, DESTINATIONS, defaultInputs, type StayType } from "@digieurope/shared";
import { ArrowLeft, ArrowRight, Briefcase, CheckCircle2, Clock, FileText, GraduationCap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Field, useAsyncError } from "@/components/ui";
import { api, myApplications } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Apply() {
  const { t, bi, lang, country } = useI18n();
  const router = useRouter();
  const { error, setError, run } = useAsyncError();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ firstName: "", lastName: "", birthDate: "", email: "", university: "Universität Musterstadt", course: "", type: "" as StayType | "", country: "CA", city: "", institution: "", startDate: "", endDate: "", tuition: "0" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  // What the standard process will ask for, so nothing comes as a surprise.
  const needs = useMemo(() => {
    if (!f.type) return [];
    return defaultInputs()
      .filter((i) => i.type === "document")
      .filter((i) => !i.when || (i.when.kind === "stay_type" && i.when.value === f.type) || (i.when.kind === "tuition" && Number(f.tuition) > 0))
      .map((i) => BUILTIN_TEMPLATES.find((x) => x.id === i.ref))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [f.type, f.tuition]);

  function fillSample() {
    const later = new Date(Date.now() + 140 * 86_400_000);
    const start = new Date(Date.UTC(later.getUTCFullYear(), later.getUTCMonth() + 1, 1));
    setF((x) => ({ ...x, firstName: "Mira", lastName: "Sommer", birthDate: "2003-05-17", email: "mira.sommer@example.org", university: "Universität Musterstadt", course: "Politikwissenschaft (B.A.)", type: "study", country: "CA", city: "Toronto", institution: "Lakeshore University", startDate: iso(start), endDate: iso(new Date(start.getTime() + 28 * 7 * 86_400_000)), tuition: "4200" }));
    setStep(2);
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

  const stepOk = step === 0 ? Boolean(f.type) : step === 1 ? Boolean(f.startDate && f.endDate && f.endDate > f.startDate && f.city && f.institution) : Boolean(f.firstName && f.lastName && f.birthDate);

  async function create() {
    if (!stepOk) return setError(t("apply.invalid"));
    setBusy(true);
    const created = await run(() =>
      api.create({
        language: lang,
        student: { firstName: f.firstName, lastName: f.lastName, birthDate: f.birthDate, email: f.email, university: f.university, course: f.course },
        stay: { type: f.type as StayType, country: f.country, city: f.city, institution: f.institution, startDate: f.startDate, endDate: f.endDate, tuitionFees: f.type === "study" ? Number(f.tuition) || 0 : 0 },
      }),
    );
    setBusy(false);
    if (created) {
      myApplications.add(created.id, created.reference);
      router.push(`/case/${created.id}`);
    }
  }

  const titles = [["wz.1.title", "wz.1.lead"], ["wz.2.title", "wz.2.lead"], ["wz.3.title", "wz.3.lead"]] as const;

  return (
    <div className="wizard" style={{ paddingTop: "1rem" }}>
      <section>
        <span className="eyebrow">{t("wz.step", { n: step + 1 })}</span>
        <div className="wz-progress" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className={i <= step ? "on" : ""} />)}</div>
        <h1 style={{ marginBottom: "0.3rem" }}>{t(titles[step]![0])}</h1>
        <p className="muted" style={{ marginBottom: "1.5rem" }}>{t(titles[step]![1])}</p>

        {step === 0 && (
          <div className="choice-cards">
            {([["study", GraduationCap, "apply.type.study", "wz.study.d"], ["internship", Briefcase, "apply.type.internship", "wz.intern.d"]] as const).map(([k, Icon, label, desc]) => (
              <button key={k} type="button" className="choice" aria-pressed={f.type === k} onClick={() => { setF((x) => ({ ...x, type: k })); setStep(1); }}>
                {f.type === k && <CheckCircle2 className="check" size={20} />}
                <span className="ci"><Icon size={22} /></span>
                <strong>{t(label)}</strong>
                <span>{t(desc)}</span>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="card form-grid">
            <Field label={t("apply.country")}>
              <select value={f.country} onChange={set("country")}>{DESTINATIONS.map((c) => <option key={c} value={c}>{country(c)}</option>)}</select>
            </Field>
            <Field label={t("apply.city")}><input value={f.city} onChange={set("city")} /></Field>
            <Field label={f.type === "study" ? t("apply.institution.study") : t("apply.institution.internship")} className="full"><input value={f.institution} onChange={set("institution")} /></Field>
            <Field label={t("apply.start")}><input type="date" lang={lang} value={f.startDate} onChange={set("startDate")} /></Field>
            <Field label={t("apply.end")}><input type="date" lang={lang} value={f.endDate} onChange={set("endDate")} /></Field>
            {f.type === "study" && <Field label={t("apply.tuition")} hint={t("apply.tuition.hint")} className="full"><input type="number" min="0" step="100" value={f.tuition} onChange={set("tuition")} /></Field>}
          </div>
        )}

        {step === 2 && (
          <div className="card form-grid">
            <Field label={t("apply.firstName")}><input value={f.firstName} onChange={set("firstName")} autoComplete="given-name" /></Field>
            <Field label={t("apply.lastName")}><input value={f.lastName} onChange={set("lastName")} autoComplete="family-name" /></Field>
            <Field label={t("apply.birthDate")}><input type="date" lang={lang} value={f.birthDate} onChange={set("birthDate")} /></Field>
            <Field label={t("apply.email")}><input type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
            <Field label={t("apply.university")}><input value={f.university} onChange={set("university")} /></Field>
            <Field label={t("apply.course")}><input value={f.course} onChange={set("course")} /></Field>
          </div>
        )}

        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="wz-nav">
          {step > 0 ? <button type="button" className="button button-ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={16} />{t("wz.back")}</button> : <span />}
          {step > 0 && step < 2 && <button type="button" className="button" disabled={!stepOk} onClick={() => { setError(null); setStep(step + 1); }}>{t("wz.next")} <ArrowRight size={16} /></button>}
          {step === 2 && <button type="button" className="button button-accent button-lg" disabled={busy || !stepOk} onClick={() => void create()}>{t("wz.create")} <ArrowRight size={18} /></button>}
        </div>
      </section>

      <aside className="card" style={{ position: "sticky", top: 90 }}>
        <div className="row small muted" style={{ marginBottom: "0.8rem" }}><Clock size={15} />{t("wz.time")}</div>
        <h3>{t("wz.need")}</h3>
        {needs.length === 0 ? (
          <p className="small muted">{t("wz.1.lead")}</p>
        ) : (
          <ul className="need-list">{needs.map((x) => <li key={x.id}><FileText size={16} />{bi(x.name)}</li>)}</ul>
        )}
        <p className="small muted" style={{ marginTop: "1rem", marginBottom: 0 }}>{t("wz.need.note")}</p>
      </aside>
    </div>
  );
}
