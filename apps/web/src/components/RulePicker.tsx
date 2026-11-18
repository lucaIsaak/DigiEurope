"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type RuleEntry } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Choose which approved rules a "Run approved rules" step applies. An undefined value is a step saved before the choice existed: it ran every live rule. */
export function RulePicker({ value, onChange }: { value: string | undefined; onChange: (next: string) => void }) {
  const { t, bi } = useI18n();
  const [rules, setRules] = useState<RuleEntry[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    api.rules().then(setRules).catch(() => setRules([]));
  }, []);

  const usable = useMemo(() => (rules ?? []).filter((r) => r.live), [rules]);
  const ticked = useMemo(() => new Set(value === undefined ? usable.map((r) => r.id) : value.split(",").map((x) => x.trim()).filter(Boolean)), [value, usable]);
  const write = (next: Set<string>) => onChange([...next].join(","));
  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    write(next);
  };

  if (!rules) return <p className="small muted">{t("common.loading")}</p>;
  const term = q.trim().toLowerCase();
  const visible = (rules ?? []).filter((r) => !term || bi(r.title).toLowerCase().includes(term) || r.id.toLowerCase().includes(term));
  const groups = [
    { key: "federal", label: t("r.group.federal"), items: visible.filter((r) => r.scope === "federal") },
    { key: "office", label: t("r.group.office"), items: visible.filter((r) => r.scope === "office") },
  ].filter((g) => g.items.length > 0);
  const selectable = visible.filter((r) => r.live).map((r) => r.id);
  const count = usable.filter((r) => ticked.has(r.id)).length;

  return (
    <div className="rpick">
      <div className="rpick-head">
        <strong>{t("rp.count", { n: count, m: usable.length })}</strong>
        <span>
          <button type="button" className="link-button small" onClick={() => write(new Set([...ticked, ...selectable]))}>{t("rp.all")}</button>
          <button type="button" className="link-button small" onClick={() => write(new Set([...ticked].filter((id) => !selectable.includes(id))))}>{t("rp.none")}</button>
        </span>
      </div>
      {count === 0 && <p className="rpick-warn">{t("rp.empty")}</p>}
      <label className="wl-search" style={{ width: "100%" }}>
        <Search size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("r.search")} aria-label={t("r.search")} />
      </label>
      {groups.map((g) => (
        <fieldset key={g.key} className="rpick-group">
          <legend>{g.label}</legend>
          {g.items.map((r) => {
            const off = !r.live;
            return (
              <label key={r.id} className={`rpick-row${off ? " off" : ""}`}>
                <input type="checkbox" checked={!off && ticked.has(r.id)} disabled={off} onChange={() => toggle(r.id)} />
                <span>
                  <b>{bi(r.title)}</b>
                  <small>
                    <span className="mono">{r.id}</span>
                    {off ? ` · ${t("rp.notApproved")}` : r.paused ? ` · ${t("r.status.paused")}` : ""}
                  </small>
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
