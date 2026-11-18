"use client";

import { paramsOf } from "@digieurope/shared";
import { useMemo } from "react";
import { TokenField, type TokenFieldHandle, type TokenInfo } from "@/components/TokenField";
import type { MessageEntry } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Pick an approved message template for a step, and put outputs of earlier steps (as tiles) into its parameters. */
export function TemplateParams({
  templates, template, params, onTemplate, onParams, resolve, sig, register, onFocusKey, onEditFn,
}: {
  templates: MessageEntry[];
  template: string;
  params: string;
  onTemplate: (id: string) => void;
  onParams: (json: string) => void;
  resolve: (raw: string) => TokenInfo | null;
  sig: string;
  register: (key: string, h: TokenFieldHandle | null) => void;
  onFocusKey: (key: string) => void;
  onEditFn?: (raw: string, apply: (next: string) => void) => void;
}) {
  const { t, lang } = useI18n();
  const live = useMemo(() => templates.filter((x) => x.live), [templates]);
  const tpl = live.find((x) => x.id === template)?.live?.tpl;
  const names = tpl ? paramsOf(tpl) : [];
  const bound = useMemo(() => {
    try {
      return JSON.parse(params || "{}") as Record<string, string>;
    } catch {
      return {} as Record<string, string>;
    }
  }, [params]);
  return (
    <div className="tp">
      <label className="field">
        {t("builder.template")}
        <select value={template} onChange={(e) => onTemplate(e.target.value)}>
          <option value="">{t("builder.template.none")}</option>
          {live.map((x) => <option key={x.id} value={x.id}>{x.name} · v{x.live!.tpl.version}</option>)}
          {template && !tpl && <option value={template}>{template} ({t("builder.template.missing")})</option>}
        </select>
      </label>
      {template && !tpl && <p className="banner banner-warn small" style={{ margin: 0 }}>{t("builder.template.missing")}</p>}
      {tpl && (
        <div className="tp-preview">
          <strong>{tpl.subject[lang]}</strong>
          <p>{tpl.body[lang]}</p>
        </div>
      )}
      {tpl && names.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t("builder.template.noParams")}</p>}
      {names.map((p) => (
        <label className="field" key={p}>
          <span><code>{`{${p}}`}</code> {t("builder.template.param")}</span>
          <TokenField
            key={`${template}:${p}`}
            ref={(h) => register(`params:${p}`, h)}
            value={bound[p] ?? ""}
            multiline
            rows={2}
            resolve={resolve}
            sig={sig}
            label={p}
            onFocus={() => onFocusKey(`params:${p}`)}
            onEditFn={onEditFn}
            onChange={(v) => onParams(JSON.stringify({ ...bound, [p]: v }))}
          />
        </label>
      ))}
    </div>
  );
}
