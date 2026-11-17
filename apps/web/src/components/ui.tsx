"use client";

import type { CaseStatus } from "@digieurope/shared";
import { useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";

export function StatusPill({ status }: { status: CaseStatus }) {
  const { t } = useI18n();
  const tone = status === "approved" ? "pill-ok" : status === "rejected" ? "pill-bad" : status === "info_requested" ? "pill-warn" : status === "draft" ? "pill-muted" : "";
  return <span className={`pill ${tone}`}>{t(`status.${status}` as MessageKey)}</span>;
}

export function SourceLink({ source }: { source: { label: string; url: string } }) {
  const { t } = useI18n();
  return (
    <a href={source.url} target="_blank" rel="noreferrer" className="small">
      {t("common.source")}: {source.label} ↗
    </a>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

/** Drop area for PDFs. Calls onFiles with all dropped files; the caller uploads them. */
export function DropZone(props: { label: string; multiple?: boolean; busy?: boolean; busyLabel?: string; onFiles: (files: File[]) => void; accept?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <label
      className={`dropzone${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) props.onFiles(props.multiple === false ? files.slice(0, 1) : files);
      }}
    >
      {props.busy ? <Spinner label={props.busyLabel ?? "…"} /> : <strong>{props.label}</strong>}
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        multiple={props.multiple !== false}
        accept={props.accept ?? "application/pdf,image/png,image/jpeg"}
        disabled={props.busy}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) props.onFiles(files);
          if (input.current) input.current.value = "";
        }}
      />
    </label>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${props.className ?? ""}`}>
      {props.label}
      {props.children}
      {props.hint && <span className="hint">{props.hint}</span>}
    </label>
  );
}

export const useAsyncError = () => {
  const [error, setError] = useState<string | null>(null);
  return { error, setError, run: async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  } };
};
