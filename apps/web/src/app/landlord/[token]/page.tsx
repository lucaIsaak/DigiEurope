"use client";

import type { LandlordView } from "@digieurope/shared";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Loading, RadioGroup, TextInput } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function LandlordConfirm() {
  const { token } = useParams<{ token: string }>();
  const { t, date } = useI18n();
  const [view, setView] = useState<LandlordView | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [role, setRole] = useState<"owner" | "agent">("owner");
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.landlord(token).then((v) => {
      setView(v);
      setName(v.landlordName);
    }).catch(() => setInvalid(true));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.landlordConfirm(token, { landlordName: name, landlordAddress: address, landlordIsOwner: role === "owner", confirm });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (invalid) return <Alert kind="error">{t("ll.invalid")}</Alert>;
  if (!view) return <Loading />;
  const a = view.address;

  return (
    <div style={{ maxWidth: 680 }}>
      <h1>{t("ll.title")}</h1>
      <p className="lead">{t("ll.lead")}</p>
      <section className="card" style={{ marginBottom: 20 }}>
        <dl className="kv">
          <dt>{t("ll.tenant")}</dt><dd><strong>{view.tenantName}</strong></dd>
          <dt>{t("ll.address")}</dt><dd>{a.street} {a.houseNumber}{a.addressExtra ? `, ${a.addressExtra}` : ""}, {a.postalCode} {a.city}</dd>
          <dt>{t("ll.moveIn")}</dt><dd>{view.moveInDate ? date(view.moveInDate) : t("ll.notSet")}</dd>
          <dt>{t("wizard.reference")}</dt><dd className="mono">{view.reference}</dd>
        </dl>
      </section>
      {done || view.status === "confirmed" ? (
        <Alert kind="success">{done ? t("ll.done") : t("ll.already")}</Alert>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <div className="form-grid">
            <TextInput label={t("ll.yourName")} value={name} onChange={setName} className="span-6" autoComplete="name" />
            <TextInput label={t("ll.yourAddress")} value={address} onChange={setAddress} className="span-6" autoComplete="street-address" />
          </div>
          <RadioGroup legend={t("ll.role")} value={role} onChange={setRole} options={[{ value: "owner", label: t("ll.owner") }, { value: "agent", label: t("ll.agent") }]} />
          <label className="checkbox">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            <span>{t("ll.confirm")}</span>
          </label>
          <p className="hint">{t("ll.warning")}</p>
          {error && <Alert kind="error">{error}</Alert>}
          <button className="button button-large" type="submit" disabled={!confirm || !name.trim() || !address.trim()}>{t("ll.submit")}</button>
        </form>
      )}
    </div>
  );
}
