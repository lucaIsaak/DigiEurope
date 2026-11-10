"use client";

import type { ApplicationStatus, CaseSummary } from "@digieurope/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Alert, Loading, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const TABS: Record<string, ApplicationStatus[] | null> = {
  open: ["submitted", "in_review", "id_check"],
  waiting: ["info_requested"],
  done: ["approved", "rejected"],
  all: null,
};

function waitingTime(fromIso: string | undefined, lang: string): { text: string; hours: number } {
  if (!fromIso) return { text: "–", hours: 0 };
  const hours = (Date.now() - Date.parse(fromIso)) / 3_600_000;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "always", style: "narrow" });
  const text = hours < 1 ? rtf.format(-Math.max(1, Math.round(hours * 60)), "minute") : hours < 48 ? rtf.format(-Math.round(hours), "hour") : rtf.format(-Math.round(hours / 24), "day");
  return { text, hours };
}

export default function Queue() {
  const { t, lang, country, dateTime } = useI18n();
  const router = useRouter();
  const [all, setAll] = useState<CaseSummary[] | null>(null);
  const [tab, setTab] = useState<keyof typeof TABS>("open");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.queue().then(setAll).catch((e: Error) => setError(e.message));
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    if (!all) return [];
    const filter = TABS[tab];
    const list = filter ? all.filter((c) => filter.includes(c.status)) : all;
    return tab === "done" || tab === "all" ? [...list].reverse() : list;
  }, [all, tab]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!all) return <Loading />;

  const open = all.filter((c) => TABS.open!.includes(c.status));
  const oldest = open.filter((c) => c.status !== "id_check")[0];

  return (
    <>
      <div className="row" style={{ alignItems: "baseline" }}>
        <h1 style={{ margin: 0 }}>{t("cw.title")}</h1>
        <span className="muted">{t("cw.office")}</span>
      </div>
      <p className="muted">{t("cw.lead")}</p>
      <p><strong>{t("cw.summary", { open: open.length, oldest: oldest ? waitingTime(oldest.submittedAt, lang).text : "–" })}</strong></p>

      <div className="tabs" role="tablist">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => {
          const f = TABS[k];
          const n = f ? all.filter((c) => f.includes(c.status)).length : all.length;
          return (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {t(`cw.tab.${k}` as "cw.tab.open")}<span className="count">{n}</span>
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="muted">{t("cw.empty")}</p>
      ) : (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t("cw.col.reference")}</th>
                <th>{t("cw.col.name")}</th>
                <th>{t("cw.col.nationality")}</th>
                <th>{t("cw.col.method")}</th>
                <th>{t("cw.col.waiting")}</th>
                <th>{t("cw.col.status")}</th>
                <th>{t("cw.col.notes")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const w = waitingTime(c.submittedAt, lang);
                const isOpen = TABS.open!.includes(c.status);
                return (
                  <tr key={c.id} onClick={() => router.push(`/caseworker/${c.id}`)}>
                    <td className="mono"><a href={`/caseworker/${c.id}`} onClick={(e) => e.preventDefault()}>{c.reference}</a></td>
                    <td>{c.name}</td>
                    <td>{country(c.nationality)}</td>
                    <td>{t(`cw.method.${c.identityMethod}`)}</td>
                    <td className={isOpen && w.hours > 48 ? "age-old" : ""}>{w.text}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>
                      {c.status === "id_check" && c.appointment ? dateTime(c.appointment.start) : null}
                      {c.warnings > 0 && <span className="pill pill-warning">! {c.warnings}</span>}
                      {c.language !== "de" && <span className="pill pill-neutral" style={{ marginLeft: 4 }}>{c.language.toUpperCase()}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
