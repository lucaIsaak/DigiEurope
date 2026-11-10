"use client";

import {
  COUNTRY_CODES,
  PILOT_MUNICIPALITY,
  isEditable,
  landlordCanBeAsked,
  needsResidenceTitle,
  runPrecheck,
  toDateString,
  type Address,
  type ApplicationWithPrecheck,
  type DocumentKind,
  type PrecheckStep,
} from "@digieurope/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUpload } from "@/components/FileUpload";
import { PrecheckPanel, usePrecheckText } from "@/components/PrecheckPanel";
import { Alert, Loading, RadioGroup, Select, SeverityIcon, TextInput } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Step = PrecheckStep | "review";
const STEPS: Step[] = ["person", "move", "landlord", "documents", "review"];

type Form = Pick<ApplicationWithPrecheck, "person" | "identityDocument" | "residenceTitle" | "move"> & {
  landlord: { landlordName: string; landlordEmail: string };
};

const toForm = (a: ApplicationWithPrecheck): Form => ({
  person: a.person,
  identityDocument: a.identityDocument,
  residenceTitle: a.residenceTitle,
  move: a.move,
  landlord: { landlordName: a.landlord.landlordName, landlordEmail: a.landlord.landlordEmail },
});

export default function Wizard() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const i18n = useI18n();
  const { t } = i18n;
  const [app, setApp] = useState<ApplicationWithPrecheck | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [step, setStep] = useState<Step>("person");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [loadError, setLoadError] = useState<string | null>(null);
  const dirty = useRef(false);
  const formRef = useRef<Form | null>(null);
  formRef.current = form;

  useEffect(() => {
    api
      .get(id)
      .then((a) => {
        if (!isEditable(a.status)) return router.replace(`/status/${id}`);
        setApp(a);
        setForm(toForm(a));
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [id, router]);

  const save = useCallback(async () => {
    if (!dirty.current || !formRef.current) return;
    dirty.current = false;
    setSaveState("saving");
    try {
      const updated = await api.patch(id, { ...formRef.current, language: i18n.lang });
      setApp(updated);
      setSaveState(dirty.current ? "saving" : "saved");
    } catch {
      dirty.current = true;
      setSaveState("error");
    }
  }, [id, i18n.lang]);

  // Autosave shortly after the user stops typing.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(save, 700);
    return () => clearTimeout(timer);
  }, [form, save]);

  // While waiting for the landlord, check every few seconds so the confirmation shows up live.
  useEffect(() => {
    if (app?.landlord.status !== "requested") return;
    const timer = setInterval(() => api.get(id).then(setApp).catch(() => undefined), 4000);
    return () => clearInterval(timer);
  }, [app?.landlord.status, id]);

  const update = (fn: (f: Form) => Form) => {
    dirty.current = true;
    setSaveState("saving");
    setForm((f) => (f ? fn(f) : f));
  };

  // Live pre-check on the local form, so feedback is instant.
  const precheck = useMemo(
    () => (app && form ? runPrecheck({ ...app, ...form, landlord: app.landlord }, PILOT_MUNICIPALITY) : null),
    [app, form],
  );

  const countryOptions = useMemo(
    () => COUNTRY_CODES.map((c) => ({ value: c, label: i18n.country(c) })).sort((a, b) => a.label.localeCompare(b.label, i18n.lang)),
    [i18n],
  );

  if (loadError) return <Alert kind="error" title={t("status.notFound")}>{loadError}</Alert>;
  if (!app || !form || !precheck) return <Loading />;

  const locked = (k: keyof Form["person"]) => app.verifiedFields.includes(k);
  const setPerson = (k: keyof Form["person"], v: string) => update((f) => ({ ...f, person: { ...f.person, [k]: v } }));
  const setIdDoc = (k: keyof Form["identityDocument"], v: string) => update((f) => ({ ...f, identityDocument: { ...f.identityDocument, [k]: v } }));
  const setMove = (k: keyof Form["move"], v: string) => update((f) => ({ ...f, move: { ...f.move, [k]: v } }));
  const setAddr = (which: "newAddress" | "previousAddress", k: keyof Address, v: string) =>
    update((f) => ({ ...f, move: { ...f.move, [which]: { ...f.move[which], [k]: v } } }));
  const eid = app.identityMethod === "eid";

  const stepState = (s: Step) =>
    s === "review" ? "" : precheck.items.some((i) => i.step === s && i.severity === "blocker") ? "todo" : "done";

  const goto = async (s: Step) => {
    await save();
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const stepIndex = STEPS.indexOf(step);

  const withSave = async (fn: () => Promise<ApplicationWithPrecheck>) => {
    await save();
    setApp(await fn());
  };
  const upload = (kind: DocumentKind, file: File) => withSave(() => api.upload(id, kind, file));
  const remove = (docId: string) => withSave(() => api.removeDocument(id, docId));

  const lastRequest = [...app.messages].reverse().find((m) => m.from === "caseworker");

  return (
    <>
      <div className="wizard-head">
        <h1 style={{ margin: 0 }}>{t("wizard.title")}</h1>
        <span className="muted">
          {t("wizard.reference")}: <span className="mono">{app.reference}</span>
        </span>
        <span className="spacer" />
        <span className="save-state" aria-live="polite">
          {saveState === "saving" ? t("wizard.saving") : saveState === "error" ? t("wizard.saveError") : `✓ ${t("wizard.saved")}`}
        </span>
      </div>

      {app.status === "info_requested" && (
        <Alert kind="warning" title={t("wizard.infoRequested.title")}>
          {lastRequest && <p>„{lastRequest.text}“</p>}
          <p>{t("wizard.infoRequested.text")}</p>
        </Alert>
      )}

      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s} className={stepState(s)}>
            <button type="button" aria-current={s === step ? "step" : undefined} onClick={() => goto(s)}>
              <span className="num">{stepState(s) === "done" && s !== step ? "✓" : i + 1}</span>
              {t(`wizard.step.${s}`)}
            </button>
          </li>
        ))}
      </ol>

      <div className="wizard">
        <div className="card">
          {step === "person" && (
            <div>
              {eid && (
                <Alert kind="success">
                  <span className="verified-banner">
                    <SeverityIcon severity="ok" /> {t("person.verified")}
                  </span>
                </Alert>
              )}
              <h2 className="section-title">{t("wizard.step.person")}</h2>
              <div className="form-grid">
                <TextInput label={t("person.firstName")} value={form.person.firstName} readOnly={locked("firstName")} onChange={(v) => setPerson("firstName", v)} autoComplete="given-name" />
                <TextInput label={t("person.lastName")} value={form.person.lastName} readOnly={locked("lastName")} onChange={(v) => setPerson("lastName", v)} autoComplete="family-name" />
                <TextInput label={t("person.birthName")} hint={t("person.birthName.hint")} value={form.person.birthName} readOnly={locked("birthName")} onChange={(v) => setPerson("birthName", v)} />
                <TextInput label={t("person.birthDate")} type="date" value={form.person.birthDate} readOnly={locked("birthDate")} onChange={(v) => setPerson("birthDate", v)} autoComplete="bday" />
                <TextInput label={t("person.birthPlace")} value={form.person.birthPlace} readOnly={locked("birthPlace")} onChange={(v) => setPerson("birthPlace", v)} />
                <Select label={t("person.nationality")} value={form.person.nationality} disabled={locked("nationality")} placeholder={t("select.choose")} options={countryOptions} onChange={(v) => setPerson("nationality", v)} />
                <Select
                  label={t("person.sex")} value={form.person.sex} className="span-2" onChange={(v) => setPerson("sex", v)}
                  options={(["female", "male", "diverse", "unspecified"] as const).map((v) => ({ value: v, label: t(`person.sex.${v}`) }))}
                />
                <Select
                  label={t("person.maritalStatus")} value={form.person.maritalStatus} className="span-2" onChange={(v) => setPerson("maritalStatus", v)}
                  options={(["single", "married", "partnership", "divorced", "widowed", "unknown"] as const).map((v) => ({ value: v, label: t(`person.marital.${v}`) }))}
                />
                <Select
                  label={t("person.religion")} value={form.person.religion} className="span-2" onChange={(v) => setPerson("religion", v)}
                  options={(["none", "roman_catholic", "protestant", "other"] as const).map((v) => ({ value: v, label: t(`person.religion.${v}`) }))}
                />
                <p className="hint" style={{ gridColumn: "span 6", marginTop: -6 }}>{t("person.religion.hint")}</p>
              </div>

              <h2 className="section-title">{t("person.idDoc")}</h2>
              <div className="form-grid">
                <Select
                  label={t("person.idDoc.type")} value={form.identityDocument.type} disabled={eid} placeholder={t("select.choose")} onChange={(v) => setIdDoc("type", v)}
                  options={(["passport", "id_card"] as const).map((v) => ({ value: v, label: t(`person.idDoc.${v}`) }))}
                />
                <TextInput label={t("person.idDoc.number")} value={form.identityDocument.number} readOnly={eid} onChange={(v) => setIdDoc("number", v.toUpperCase())} />
                <Select label={t("person.idDoc.issuingCountry")} value={form.identityDocument.issuingCountry} disabled={eid} placeholder={t("select.choose")} options={countryOptions} onChange={(v) => setIdDoc("issuingCountry", v)} />
                <TextInput label={t("person.idDoc.expiryDate")} type="date" value={form.identityDocument.expiryDate} readOnly={eid} onChange={(v) => setIdDoc("expiryDate", v)} />
              </div>
            </div>
          )}

          {step === "move" && (
            <div>
              <h2 className="section-title">{t("move.newAddress", { city: PILOT_MUNICIPALITY.name })}</h2>
              <div className="form-grid">
                <TextInput label={t("move.street")} className="span-4" value={form.move.newAddress.street} onChange={(v) => setAddr("newAddress", "street", v)} autoComplete="address-line1" />
                <TextInput label={t("move.houseNumber")} className="span-2" value={form.move.newAddress.houseNumber} onChange={(v) => setAddr("newAddress", "houseNumber", v)} />
                <TextInput label={t("move.addressExtra")} className="span-6" hint={t("move.addressExtra.hint")} value={form.move.newAddress.addressExtra} onChange={(v) => setAddr("newAddress", "addressExtra", v)} />
                <TextInput
                  label={t("move.postalCode")} className="span-2" value={form.move.newAddress.postalCode} autoComplete="postal-code"
                  hint={t("move.postalCode.hint", { city: PILOT_MUNICIPALITY.name, codes: PILOT_MUNICIPALITY.postalCodes.join(", ") })}
                  onChange={(v) => setAddr("newAddress", "postalCode", v.replace(/\D/g, "").slice(0, 5))}
                />
                <TextInput label={t("move.city")} className="span-4" value={form.move.newAddress.city} readOnly onChange={() => undefined} />
                <TextInput
                  label={t("move.moveInDate")} type="date" className="span-6" hint={t("move.moveInDate.hint")}
                  value={form.move.moveInDate} max={toDateString(new Date())} onChange={(v) => setMove("moveInDate", v)}
                />
              </div>

              <div className="section-title" />
              <RadioGroup
                legend={t("move.residenceType")} value={form.move.residenceType} onChange={(v) => setMove("residenceType", v)}
                options={[{ value: "main", label: t("move.residence.main") }, { value: "secondary", label: t("move.residence.secondary") }]}
              />

              <div className="section-title" />
              <RadioGroup
                legend={t("move.previous")} value={form.move.previousResidence} onChange={(v) => setMove("previousResidence", v)}
                options={(["abroad", "germany", "none"] as const).map((v) => ({ value: v, label: t(`move.previous.${v}`) }))}
              />
              {form.move.previousResidence === "abroad" && (
                <div className="form-grid" style={{ marginTop: 14 }}>
                  <Select label={t("move.previousCountry")} value={form.move.previousCountry} placeholder={t("select.choose")} options={countryOptions.filter((c) => c.value !== "DE")} onChange={(v) => setMove("previousCountry", v)} />
                </div>
              )}
              {form.move.previousResidence === "germany" && (
                <>
                  <h3 style={{ marginTop: 16 }}>{t("move.previousAddress")}</h3>
                  <div className="form-grid">
                    <TextInput label={t("move.street")} className="span-4" value={form.move.previousAddress.street} onChange={(v) => setAddr("previousAddress", "street", v)} />
                    <TextInput label={t("move.houseNumber")} className="span-2" value={form.move.previousAddress.houseNumber} onChange={(v) => setAddr("previousAddress", "houseNumber", v)} />
                    <TextInput label={t("move.postalCode")} className="span-2" value={form.move.previousAddress.postalCode} onChange={(v) => setAddr("previousAddress", "postalCode", v.replace(/\D/g, "").slice(0, 5))} />
                    <TextInput label={t("move.city")} className="span-4" value={form.move.previousAddress.city} onChange={(v) => setAddr("previousAddress", "city", v)} />
                  </div>
                </>
              )}
            </div>
          )}

          {step === "landlord" && <LandlordStep app={app} form={form} update={update} withSave={withSave} upload={upload} remove={remove} />}

          {step === "documents" && (
            <div className="stack">
              <h2>{t("wizard.step.documents")}</h2>
              {eid ? (
                <Alert kind="success">{t("docs.eidOk")}</Alert>
              ) : (
                <FileUpload kind="identity" label={t("docs.idUpload")} hint={t("docs.idUpload.hint")} documents={app.documents} onUpload={upload} onRemove={remove} />
              )}
              {needsResidenceTitle(form.person.nationality) && (
                <div className="card" style={{ boxShadow: "none" }}>
                  <h3>{t("docs.residence")}</h3>
                  <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>{t("docs.residence.intro")}</p>
                  <div className="form-grid" style={{ marginBottom: 14 }}>
                    <Select
                      label={t("docs.residence.type")} value={form.residenceTitle.type} placeholder={t("select.choose")}
                      onChange={(v) => update((f) => ({ ...f, residenceTitle: { ...f.residenceTitle, type: v as Form["residenceTitle"]["type"] } }))}
                      options={(["visa", "residence_permit", "blue_card"] as const).map((v) => ({ value: v, label: t(`docs.residence.${v}`) }))}
                    />
                    <TextInput
                      label={t("docs.residence.expiry")} type="date" value={form.residenceTitle.expiryDate}
                      onChange={(v) => update((f) => ({ ...f, residenceTitle: { ...f.residenceTitle, expiryDate: v } }))}
                    />
                  </div>
                  <FileUpload kind="residence_title" label={t("docs.residence.upload")} hint={t("docs.idUpload.hint")} documents={app.documents} onUpload={upload} onRemove={remove} />
                </div>
              )}
              <FileUpload kind="other" label={t("docs.other")} hint={t("docs.other.hint")} documents={app.documents} onUpload={upload} onRemove={remove} />
            </div>
          )}

          {step === "review" && <Review app={app} form={form} precheck={precheck} goto={goto} save={save} onSubmitted={() => router.push(`/status/${id}`)} />}

          {step !== "review" && (
            <div className="wizard-nav">
              {stepIndex > 0 ? (
                <button type="button" className="button button-secondary" onClick={() => goto(STEPS[stepIndex - 1]!)}>← {t("wizard.back")}</button>
              ) : <span />}
              <button type="button" className="button" onClick={() => goto(STEPS[stepIndex + 1]!)}>{t("wizard.next")} →</button>
            </div>
          )}
        </div>

        <aside className="wizard-aside">
          <PrecheckPanel result={precheck} onGoto={goto} />
        </aside>
      </div>
    </>
  );
}

function LandlordStep(props: {
  app: ApplicationWithPrecheck;
  form: Form;
  update: (fn: (f: Form) => Form) => void;
  withSave: (fn: () => Promise<ApplicationWithPrecheck>) => Promise<void>;
  upload: (kind: DocumentKind, file: File) => Promise<void>;
  remove: (docId: string) => Promise<void>;
}) {
  const { t, date } = useI18n();
  const { app, form, update } = props;
  const hasUpload = app.documents.some((d) => d.kind === "landlord_confirmation");
  const [mode, setMode] = useState<"digital" | "upload">(hasUpload ? "upload" : "digital");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const l = app.landlord;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await props.withSave(() => api.requestLandlord(app.id, form.landlord.landlordName, form.landlord.landlordEmail));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h2>{t("wizard.step.landlord")}</h2>
      <p>{t("landlord.intro")}</p>

      {l.status === "confirmed" ? (
        <Alert kind="success">
          <span className="verified-banner">
            <SeverityIcon severity="ok" /> {t("landlord.confirmed", { name: l.landlordName, date: date(l.confirmedAt) })}
          </span>
        </Alert>
      ) : (
        <>
          <RadioGroup
            legend=""
            value={mode}
            onChange={setMode}
            options={[
              { value: "digital", label: t("landlord.option.digital"), description: t("landlord.option.digital.text") },
              { value: "upload", label: t("landlord.option.upload"), description: t("landlord.option.upload.text") },
            ]}
          />
          {mode === "digital" && !landlordCanBeAsked(form) && <Alert kind="info">{t("landlord.needAddress")}</Alert>}
          {mode === "digital" && landlordCanBeAsked(form) && (
            <div className="stack">
              <div className="form-grid">
                <TextInput label={t("landlord.name")} value={form.landlord.landlordName} onChange={(v) => update((f) => ({ ...f, landlord: { ...f.landlord, landlordName: v } }))} />
                <TextInput label={t("landlord.email")} type="email" value={form.landlord.landlordEmail} onChange={(v) => update((f) => ({ ...f, landlord: { ...f.landlord, landlordEmail: v } }))} />
              </div>
              <div className="row">
                <button type="button" className="button" disabled={busy || !form.landlord.landlordEmail} onClick={send}>
                  {l.status === "requested" ? t("landlord.resend") : t("landlord.send")}
                </button>
              </div>
              {error && <p className="error-text" role="alert">{error}</p>}
              {l.status === "requested" && (
                <Alert kind="info">
                  <p>{t("landlord.pending", { email: l.landlordEmail })}</p>
                  {l.requestLink && (
                    <p>
                      <a href={l.requestLink.replace(/^https?:\/\/[^/]+/, "")} target="_blank" rel="noreferrer">{t("landlord.demoLink")} ↗</a>
                    </p>
                  )}
                </Alert>
              )}
            </div>
          )}
          {mode === "upload" && (
            <>
              <FileUpload kind="landlord_confirmation" label={t("landlord.option.upload")} hint={t("docs.idUpload.hint")} documents={app.documents} onUpload={props.upload} onRemove={props.remove} />
              {hasUpload && <Alert kind="success">{t("landlord.uploadedOk")}</Alert>}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Review(props: {
  app: ApplicationWithPrecheck;
  form: Form;
  precheck: ReturnType<typeof runPrecheck>;
  goto: (s: Step) => void;
  save: () => Promise<void>;
  onSubmitted: () => void;
}) {
  const { t, date, country } = useI18n();
  const text = usePrecheckText();
  const { app, form, precheck } = props;
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = form.person;
  const m = form.move;
  const addr = (a: Address) => [`${a.street} ${a.houseNumber}`.trim(), a.addressExtra, `${a.postalCode} ${a.city}`.trim()].filter(Boolean).join(", ");

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await props.save();
      await api.submit(app.id, note);
      props.onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const Section = ({ step, children }: { step: Step; children: React.ReactNode }) => (
    <section className="review-section">
      <header>
        <h3>{t(`wizard.step.${step}`)}</h3>
        <button type="button" className="link-button" onClick={() => props.goto(step)}>{t("review.edit")}</button>
      </header>
      <dl className="kv">{children}</dl>
    </section>
  );

  const blockers = precheck.items.filter((i) => i.severity === "blocker");
  const warnings = precheck.items.filter((i) => i.severity === "warning");

  return (
    <div>
      <h2>{t("review.title")}</h2>
      <Section step="person">
        <dt>{t("person.firstName")} / {t("person.lastName")}</dt><dd>{p.firstName} {p.lastName}</dd>
        <dt>{t("person.birthDate")}</dt><dd>{date(p.birthDate)}, {p.birthPlace}</dd>
        <dt>{t("person.nationality")}</dt><dd>{country(p.nationality)}</dd>
        <dt>{t("person.idDoc")}</dt><dd>{form.identityDocument.type ? t(`person.idDoc.${form.identityDocument.type}`) : "–"} {form.identityDocument.number} · {date(form.identityDocument.expiryDate)}</dd>
      </Section>
      <Section step="move">
        <dt>{t("move.newAddress", { city: PILOT_MUNICIPALITY.name })}</dt><dd>{addr(m.newAddress)}</dd>
        <dt>{t("move.moveInDate")}</dt><dd>{date(m.moveInDate)}</dd>
        <dt>{t("move.residenceType")}</dt><dd>{t(`move.residence.${m.residenceType}`)}</dd>
        <dt>{t("move.previous")}</dt>
        <dd>{m.previousResidence === "abroad" ? country(m.previousCountry) : m.previousResidence === "germany" ? addr(m.previousAddress) : t("move.previous.none")}</dd>
      </Section>
      <Section step="landlord">
        <dt>{t("wizard.step.landlord")}</dt>
        <dd>{text(precheck.items.find((i) => i.step === "landlord")!)}</dd>
      </Section>
      <Section step="documents">
        <dt>{t("wizard.step.documents")}</dt>
        <dd>{app.documents.length ? app.documents.map((d) => d.filename).join(", ") : t("docs.nothing")}</dd>
      </Section>

      <div style={{ marginTop: 24 }}>
        {precheck.ready ? (
          <Alert kind="success">{t("review.ready")}</Alert>
        ) : (
          <Alert kind="error" title={t("review.notReady")}>
            <ul className="precheck-list">
              {blockers.map((b) => (
                <li key={b.code} className="precheck-item">
                  <SeverityIcon severity="blocker" />
                  <button type="button" className="link-button" onClick={() => props.goto(b.step)}>{text(b)}</button>
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert kind="warning">
            <ul className="precheck-list" style={{ margin: 0 }}>
              {warnings.map((w) => (
                <li key={w.code} className="precheck-item"><SeverityIcon severity="warning" />{text(w)}</li>
              ))}
            </ul>
          </Alert>
        )}
      </div>

      {precheck.ready && (
        <div className="stack">
          <div className="field">
            <label htmlFor="note">{t("review.note")}</label>
            <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{t("review.confirm")}</span>
          </label>
          {error && <Alert kind="error">{error}</Alert>}
          <button type="button" className="button button-large" disabled={!confirmed || busy} onClick={submit}>
            {busy ? t("review.submitting") : app.status === "info_requested" ? t("review.resubmit") : t("review.submit")}
          </button>
        </div>
      )}
      <p className="hint" style={{ marginTop: 16 }}>
        <Link href={`/status/${app.id}`}>{t("nav.status")}</Link>
      </p>
    </div>
  );
}
