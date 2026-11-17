"use client";

import { opLabel, type CondOp, type Condition, type Fact } from "@digieurope/shared";
import { Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const OPS_BY_TYPE: Record<Fact["type"], CondOp[]> = {
  bool: ["present", "absent"],
  yesno: ["eq", "ne", "present", "absent"],
  stayType: ["eq", "ne"],
  text: ["present", "absent", "eq", "ne"],
  number: ["gte", "lte", "eq", "ne", "present"],
  date: ["lte", "gte", "eq", "present"],
};

/** "[fact] [operator] [value or other fact]" lines. All lines must hold. */
export function ConditionBuilder({ facts, lines, onChange }: { facts: Fact[]; lines: Condition[]; onChange: (next: Condition[]) => void }) {
  const { t, bi } = useI18n();
  const groups = [...new Map(facts.map((f) => [bi(f.group), f.group])).values()];
  const set = (i: number, patch: Partial<Condition>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <div>
      {lines.map((l, i) => {
        const fact = facts.find((f) => f.path === l.path);
        const ops = fact ? OPS_BY_TYPE[fact.type] : (["present", "absent", "eq", "ne", "gte", "lte"] as CondOp[]);
        const needsValue = l.op !== "present" && l.op !== "absent";
        const peers = facts.filter((f) => f.path !== l.path && fact && f.type === fact.type);
        return (
          <div className="cond" key={i}>
            <select value={l.path} aria-label="fact" onChange={(e) => {
              const nf = facts.find((f) => f.path === e.target.value);
              const op = nf ? OPS_BY_TYPE[nf.type][0]! : l.op;
              set(i, { path: e.target.value, op, value: nf?.type === "yesno" ? "Ja" : nf?.type === "stayType" ? "study" : undefined, valueRef: undefined });
            }}>
              {!fact && <option value={l.path}>{l.path}</option>}
              {groups.map((g) => (
                <optgroup key={bi(g)} label={bi(g)}>
                  {facts.filter((f) => bi(f.group) === bi(g)).map((f) => <option key={f.path} value={f.path}>{bi(f.label)}</option>)}
                </optgroup>
              ))}
            </select>
            <select value={l.op} aria-label="operator" onChange={(e) => set(i, { op: e.target.value as CondOp })}>
              {ops.map((o) => <option key={o} value={o}>{bi(opLabel(o))}</option>)}
            </select>
            {!needsValue ? <span /> : (
              <div className="row" style={{ flexWrap: "nowrap", gap: "0.35rem" }}>
                {l.valueRef ? (
                  <select value={l.valueRef} aria-label={t("r.ed.compareWith")} onChange={(e) => set(i, e.target.value === "__value" ? { valueRef: undefined, value: "" } : { valueRef: e.target.value })}>
                    <option value="__value">{t("r.ed.fixedValue")}</option>
                    {peers.map((f) => <option key={f.path} value={f.path}>{bi(f.label)}</option>)}
                  </select>
                ) : fact?.type === "yesno" ? (
                  <select value={l.value ?? "Ja"} aria-label={t("r.ed.value")} onChange={(e) => set(i, { value: e.target.value })}><option>Ja</option><option>Nein</option></select>
                ) : fact?.type === "stayType" ? (
                  <select value={l.value ?? "study"} aria-label={t("r.ed.value")} onChange={(e) => set(i, { value: e.target.value })}>
                    <option value="study">{t("stay.study")}</option>
                    <option value="internship">{t("stay.internship")}</option>
                  </select>
                ) : (
                  <input value={l.value ?? ""} type={fact?.type === "number" ? "number" : fact?.type === "date" ? "date" : "text"} aria-label={t("r.ed.value")} onChange={(e) => set(i, { value: e.target.value })} />
                )}
                {!l.valueRef && peers.length > 0 && (
                  <select value="" aria-label={t("r.ed.compareWith")} style={{ maxWidth: 40, padding: "0.5rem 0.2rem" }} title={t("r.ed.compareWith")} onChange={(e) => e.target.value && set(i, { valueRef: e.target.value, value: undefined })}>
                    <option value="">⇄</option>
                    {peers.map((f) => <option key={f.path} value={f.path}>{bi(f.label)}</option>)}
                  </select>
                )}
              </div>
            )}
            <button type="button" className="icon-button" aria-label="remove" onClick={() => onChange(lines.filter((_, k) => k !== i))}><X size={15} /></button>
          </div>
        );
      })}
      <button type="button" className="button button-ghost button-small" onClick={() => onChange([...lines, { path: "docs.application_form.present", op: "present" }])}><Plus size={14} />{t("r.ed.add")}</button>
    </div>
  );
}
