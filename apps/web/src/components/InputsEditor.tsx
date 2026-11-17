"use client";

import { KNOWN_INFO, knownInfoLabel, type DocumentTemplate, type FieldType, type InputCondition, type ProcessInput } from "@digieurope/shared";
import { FileText, HelpCircle, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

type CondKey = "always" | "study" | "internship" | "tuition" | `info:${string}`;

const toKey = (w?: InputCondition): CondKey => (!w ? "always" : w.kind === "stay_type" ? w.value : w.kind === "tuition" ? "tuition" : `info:${w.key}`);
const fromKey = (k: CondKey): InputCondition | undefined =>
  k === "always" ? undefined : k === "study" || k === "internship" ? { kind: "stay_type", value: k } : k === "tuition" ? { kind: "tuition" } : { kind: "info", key: k.slice(5), equals: "yes" };

/** Edits what the applicant has to provide for a process: forms (templates) and information, each required or optional, with a condition. */
export function InputsEditor({ inputs, templates, onChange }: { inputs: ProcessInput[]; templates: DocumentTemplate[]; onChange: (next: ProcessInput[]) => void }) {
  const { t, bi } = useI18n();
  const [addForm, setAddForm] = useState("");
  const [addInfo, setAddInfo] = useState("");
  const [q, setQ] = useState<{ de: string; en: string; type: FieldType; help: string } | null>(null);

  const yesNoQuestions = inputs.filter((i) => i.type === "info" && i.question?.type === "yesno");
  const nameOf = (i: ProcessInput) =>
    i.type === "document" ? bi(templates.find((x) => x.id === i.ref)?.name ?? { de: i.ref, en: i.ref }) : bi(knownInfoLabel(i.ref) ?? i.question?.label ?? { de: i.ref, en: i.ref });
  const patch = (id: string, p: Partial<ProcessInput>) => onChange(inputs.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const usedDocs = new Set(inputs.filter((i) => i.type === "document").map((i) => i.ref));
  const usedInfo = new Set(inputs.filter((i) => i.type === "info").map((i) => i.ref));

  return (
    <div className="stack" style={{ gap: "0.9rem" }}>
      <p className="small muted" style={{ margin: 0 }}>{t("inputs.lead")}</p>
      {inputs.length === 0 && <p className="small muted">{t("inputs.none")}</p>}
      <div>
        {inputs.map((i) => (
          <div key={i.id} style={{ borderTop: "1px solid var(--line)", padding: "0.55rem 0" }}>
            <div className="row" style={{ flexWrap: "nowrap", gap: "0.5rem" }}>
              <span className="ico" style={{ ["--c" as string]: i.type === "document" ? "#3b82f6" : "#14a3b8" }}>{i.type === "document" ? <FileText size={15} /> : <HelpCircle size={15} />}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{nameOf(i)}</div>
                <div className="small muted">{i.type === "document" ? t("inputs.document") : t("inputs.info")}</div>
              </div>
              <button type="button" className="icon-button" title={t("inputs.remove")} aria-label={t("inputs.remove")} onClick={() => onChange(inputs.filter((x) => x.id !== i.id))}><X size={15} /></button>
            </div>
            <div className="row" style={{ marginTop: "0.35rem", gap: "0.4rem", flexWrap: "nowrap" }}>
              <select value={i.required ? "req" : "opt"} onChange={(e) => patch(i.id, { required: e.target.value === "req" })} aria-label={t("inputs.required")} style={{ fontSize: "0.82rem", padding: "0.3rem" }}>
                <option value="req">{t("inputs.required")}</option>
                <option value="opt">{t("inputs.optional")}</option>
              </select>
              <select value={toKey(i.when)} onChange={(e) => patch(i.id, { when: fromKey(e.target.value as CondKey) })} aria-label={t("inputs.when")} style={{ fontSize: "0.82rem", padding: "0.3rem" }}>
                <option value="always">{t("inputs.when.always")}</option>
                <option value="study">{t("inputs.when.study")}</option>
                <option value="internship">{t("inputs.when.internship")}</option>
                <option value="tuition">{t("inputs.when.tuition")}</option>
                {yesNoQuestions.filter((x) => x.id !== i.id).map((x) => <option key={x.id} value={`info:${x.ref}`}>{t("inputs.when.info")}: {x.question ? bi(x.question.label) : x.ref}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>

      <div className="stack" style={{ gap: "0.5rem" }}>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <select value={addForm} onChange={(e) => setAddForm(e.target.value)} aria-label={t("inputs.addForm")} style={{ fontSize: "0.85rem", padding: "0.4rem" }}>
            <option value="">{t("inputs.chooseForm")}</option>
            {templates.filter((x) => !usedDocs.has(x.id)).map((x) => <option key={x.id} value={x.id}>{bi(x.name)}</option>)}
          </select>
          <button className="button button-small" type="button" disabled={!addForm} onClick={() => { onChange([...inputs, { id: `doc:${addForm}`, type: "document", ref: addForm, required: true }]); setAddForm(""); }}>{t("inputs.add")}</button>
        </div>
        <Link className="small" href="/office/templates?new=1">{t("inputs.proposeTemplate")} →</Link>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <select value={addInfo} onChange={(e) => setAddInfo(e.target.value)} aria-label={t("inputs.addInfo")} style={{ fontSize: "0.85rem", padding: "0.4rem" }}>
            <option value="">{t("inputs.chooseInfo")}</option>
            {KNOWN_INFO.filter((k) => !usedInfo.has(k.key)).map((k) => <option key={k.key} value={k.key}>{bi(k.label)}</option>)}
          </select>
          <button className="button button-small" type="button" disabled={!addInfo} onClick={() => { onChange([...inputs, { id: `info:${addInfo}`, type: "info", ref: addInfo, required: true }]); setAddInfo(""); }}>{t("inputs.add")}</button>
        </div>
        {!q ? (
          <button type="button" className="link-button small" style={{ textAlign: "left" }} onClick={() => setQ({ de: "", en: "", type: "yesno", help: "" })}>+ {t("inputs.addQuestion")}</button>
        ) : (
          <div className="card stack" style={{ gap: "0.5rem", padding: "0.8rem" }}>
            <label className="field">{t("inputs.question.de")}<input value={q.de} onChange={(e) => setQ({ ...q, de: e.target.value })} /></label>
            <label className="field">{t("inputs.question.en")}<input value={q.en} onChange={(e) => setQ({ ...q, en: e.target.value })} /></label>
            <label className="field">{t("inputs.question.type")}
              <select value={q.type} onChange={(e) => setQ({ ...q, type: e.target.value as FieldType })}>
                {(["yesno", "text", "number", "date"] as const).map((x) => <option key={x} value={x}>{t(`prop.type.${x}` as MessageKey)}</option>)}
              </select>
            </label>
            <label className="field">{t("inputs.question.help")}<input value={q.help} onChange={(e) => setQ({ ...q, help: e.target.value })} /></label>
            <div className="row">
              <button
                className="button button-small"
                type="button"
                disabled={!q.de.trim() && !q.en.trim()}
                onClick={() => {
                  const ref = `q_${Date.now().toString(36)}`;
                  onChange([...inputs, { id: `info:${ref}`, type: "info", ref, required: false, question: { label: { de: q.de.trim() || q.en.trim(), en: q.en.trim() || q.de.trim() }, type: q.type, ...(q.help.trim() ? { help: { de: q.help.trim(), en: q.help.trim() } } : {}) } }]);
                  setQ(null);
                }}
              >
                {t("inputs.add")}
              </button>
              <button type="button" className="link-button small" onClick={() => setQ(null)}>{t("common.cancel")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
