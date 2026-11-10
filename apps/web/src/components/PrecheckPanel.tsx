"use client";

import type { PrecheckItem, PrecheckResult, PrecheckStep } from "@digieurope/shared";
import { useI18n } from "@/lib/i18n";
import { SeverityIcon } from "./ui";

/** Turns a pre-check item into a sentence, translating field lists. */
export function usePrecheckText() {
  const { tk } = useI18n();
  return (item: PrecheckItem) => {
    const params = { ...(item.params ?? {}) };
    if (typeof params.fields === "string") params.fields = params.fields.split(",").map((f) => tk(`field.${f}`)).join(", ");
    return tk(`precheck.${item.code}`, params);
  };
}

const ORDER = { blocker: 0, warning: 1, ok: 2 };

export function PrecheckPanel({ result, onGoto, compact }: { result: PrecheckResult; onGoto?: (step: PrecheckStep) => void; compact?: boolean }) {
  const { t } = useI18n();
  const text = usePrecheckText();
  const items = [...result.items].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  return (
    <section className="precheck card" aria-live="polite">
      <header className="precheck-head">
        <h2>{t("precheck.title")}</h2>
        {result.ready ? (
          <span className="pill pill-ok">✓ {t("precheck.ready")}</span>
        ) : (
          <span className="pill pill-blocker">{t("precheck.blockers", { n: result.blockers })}</span>
        )}
        {result.warnings > 0 && <span className="pill pill-warning">{t("precheck.warnings", { n: result.warnings })}</span>}
      </header>
      {!compact && <p className="hint">{t("precheck.explain")}</p>}
      <ul className="precheck-list">
        {items.map((item) => (
          <li key={item.code} className={`precheck-item sev-row-${item.severity}`}>
            <SeverityIcon severity={item.severity} />
            {onGoto && item.severity !== "ok" ? (
              <button type="button" className="link-button" onClick={() => onGoto(item.step)}>{text(item)}</button>
            ) : (
              <span>{text(item)}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
