"use client";

import type { ApplicationStatus, PrecheckSeverity } from "@digieurope/shared";
import { useId, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const { tk } = useI18n();
  return <span className={`badge badge-${status}`}>{tk(`status.${status}`)}</span>;
}

const ICON: Record<PrecheckSeverity, string> = { ok: "✓", warning: "!", blocker: "×" };
export function SeverityIcon({ severity }: { severity: PrecheckSeverity }) {
  return <span className={`sev sev-${severity}`} aria-hidden>{ICON[severity]}</span>;
}

interface FieldProps {
  label: string;
  hint?: string;
  children: (id: string, describedBy?: string) => ReactNode;
  className?: string;
}

export function Field({ label, hint, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      {children(id, hintId)}
      {hint && <p className="hint" id={hintId}>{hint}</p>}
    </div>
  );
}

export function TextInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  type?: string;
  readOnly?: boolean;
  className?: string;
  autoComplete?: string;
  max?: string;
}) {
  return (
    <Field label={props.label} hint={props.hint} className={props.className}>
      {(id, describedBy) => (
        <input
          id={id}
          type={props.type ?? "text"}
          value={props.value}
          readOnly={props.readOnly}
          aria-describedby={describedBy}
          autoComplete={props.autoComplete}
          max={props.max}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function Select(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Field label={props.label} hint={props.hint} className={props.className}>
      {(id, describedBy) => (
        <select id={id} value={props.value} disabled={props.disabled} aria-describedby={describedBy} onChange={(e) => props.onChange(e.target.value)}>
          {props.placeholder !== undefined && <option value="">{props.placeholder}</option>}
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function RadioGroup<T extends string>(props: {
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description?: string }[];
}) {
  const name = useId();
  return (
    <fieldset className="radio-group">
      <legend>{props.legend}</legend>
      {props.options.map((o) => (
        <label key={o.value} className={`radio-card ${props.value === o.value ? "selected" : ""}`}>
          <input type="radio" name={name} value={o.value} checked={props.value === o.value} onChange={() => props.onChange(o.value)} />
          <span>
            <strong>{o.label}</strong>
            {o.description && <small>{o.description}</small>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function Alert({ kind, title, children }: { kind: "info" | "success" | "warning" | "error"; title?: string; children?: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {title && <strong className="alert-title">{title}</strong>}
      {children}
    </div>
  );
}

export function Loading() {
  return <div className="loading" aria-busy="true">…</div>;
}
