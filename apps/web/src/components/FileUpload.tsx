"use client";

import type { DocumentKind, DocumentRef } from "@digieurope/shared";
import { useRef, useState } from "react";
import { documentUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const ACCEPT = ["application/pdf", "image/png", "image/jpeg"];

export function FileUpload(props: {
  kind: DocumentKind;
  label: string;
  hint?: string;
  documents: DocumentRef[];
  onUpload: (kind: DocumentKind, file: File) => Promise<void>;
  onRemove: (docId: string) => Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docs = props.documents.filter((d) => d.kind === props.kind);

  async function handle(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!ACCEPT.includes(file.type)) return setError(t("upload.wrongType"));
    if (file.size > 5 * 1024 * 1024) return setError(t("upload.tooBig"));
    setBusy(true);
    try {
      await props.onUpload(props.kind, file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="upload">
      <div className="upload-head">
        <strong>{props.label}</strong>
        {props.hint && <p className="hint">{props.hint}</p>}
      </div>
      {docs.length > 0 && (
        <ul className="upload-list">
          {docs.map((d) => (
            <li key={d.id}>
              <span className="sev sev-ok" aria-hidden>✓</span>
              <a href={documentUrl(d.id)} target="_blank" rel="noreferrer">{d.filename}</a>
              <small>{Math.max(1, Math.round(d.size / 1024))} KB</small>
              {!props.disabled && (
                <button type="button" className="link-button" onClick={() => props.onRemove(d.id)}>{t("upload.remove")}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!props.disabled && (
        <label className="button button-secondary upload-button">
          {busy ? t("upload.uploading") : t("upload.choose")}
          <input ref={input} type="file" accept={ACCEPT.join(",")} className="visually-hidden" disabled={busy} onChange={(e) => handle(e.target.files?.[0])} />
        </label>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
