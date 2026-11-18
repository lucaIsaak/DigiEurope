"use client";

import type { OfficeAssignment } from "@digieurope/shared";
import { Lock, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAsyncError } from "@/components/ui";
import { api, type AssignmentView } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStaff } from "@/lib/staff";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** The office-wide table: which caseworker gets which family-name letters, who is away, and who takes the rest. */
export function AssignmentTable({ embedded = false }: { embedded?: boolean }) {
  const { t } = useI18n();
  const { staff } = useStaff();
  const [view, setView] = useState<AssignmentView | null>(null);
  const [draft, setDraft] = useState<OfficeAssignment | null>(null);
  const [saved, setSaved] = useState(false);
  const { error, run } = useAsyncError();
  const admin = Boolean(staff?.isAdmin);

  useEffect(() => {
    api.assignment().then((v) => { setView(v); setDraft(v.assignment); }).catch(() => undefined);
  }, []);
  if (!view || !draft) return null;

  const problems = (() => {
    const owners = new Map<string, number>();
    for (const r of draft.ranges) for (const l of LETTERS) if (l >= r.from && l <= r.to) owners.set(l, (owners.get(l) ?? 0) + 1);
    return { overlaps: LETTERS.filter((l) => (owners.get(l) ?? 0) > 1), gaps: LETTERS.filter((l) => !owners.has(l)) };
  })();
  const range = (l: string[]) => (l.length > 6 ? `${l[0]}–${l[l.length - 1]}` : l.join(", "));
  const setRange = (i: number, patch: Partial<OfficeAssignment["ranges"][number]>) => setDraft({ ...draft, ranges: draft.ranges.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const save = async () => {
    const r = await run(() => api.saveAssignment(draft));
    if (r) {
      setDraft(r.assignment);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    }
  };
  const nameOf = (id: string) => view.staff.find((m) => m.id === id)?.name ?? id;
  const used = [...new Set(draft.ranges.map((r) => r.staffId))];

  return (
    <section className={`as${embedded ? " embedded" : ""}`} aria-labelledby="as-h">
      {embedded ? <p className="small muted" style={{ margin: 0 }}>{t("as.inBlock")}</p> : (<><h2 id="as-h">{t("as.title")}</h2><p className="muted">{t("as.lead")}</p></>)}
      {!admin && <p className="reason"><Lock size={13} />{t("as.adminOnly")}</p>}
      <fieldset disabled={!admin} className="as-fs">
        <div className="as-table">
          <div className="as-row as-head"><span>{t("as.from")}</span><span>{t("as.to")}</span><span>{t("as.who")}</span><span /></div>
          {draft.ranges.map((r, i) => (
            <div className="as-row" key={i}>
              <select value={r.from} onChange={(e) => setRange(i, { from: e.target.value })} aria-label={t("as.from")}>{LETTERS.map((l) => <option key={l}>{l}</option>)}</select>
              <select value={r.to} onChange={(e) => setRange(i, { to: e.target.value })} aria-label={t("as.to")}>{LETTERS.map((l) => <option key={l}>{l}</option>)}</select>
              <select value={r.staffId} onChange={(e) => setRange(i, { staffId: e.target.value })} aria-label={t("as.who")}>{view.caseworkers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <button type="button" className="icon-button" aria-label="Remove" onClick={() => setDraft({ ...draft, ranges: draft.ranges.filter((_, k) => k !== i) })}><X size={15} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="button button-ghost button-small" onClick={() => setDraft({ ...draft, ranges: [...draft.ranges, { from: "A", to: "A", staffId: view.caseworkers[0]!.id }] })}><Plus size={14} />{t("as.add")}</button>
        {problems.overlaps.length > 0 && <p className="as-warn bad">{t("as.overlaps", { l: range(problems.overlaps) })}</p>}
        {problems.gaps.length > 0 && <p className="as-warn">{t("as.gaps", { l: range(problems.gaps) })}</p>}

        <h3>{t("as.away")}</h3>
        <div className="as-table">
          {used.map((id) => (
            <div className="as-away" key={id}>
              <label><input type="checkbox" checked={id in draft.away} onChange={(e) => { const away = { ...draft.away }; if (e.target.checked) away[id] = view.staff.find((m) => m.id !== id)!.id; else delete away[id]; setDraft({ ...draft, away }); }} /> {nameOf(id)}</label>
              {id in draft.away && (
                <label className="as-cover">{t("as.cover")}
                  <select value={draft.away[id]} onChange={(e) => setDraft({ ...draft, away: { ...draft.away, [id]: e.target.value } })}>{view.staff.filter((m) => m.id !== id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                </label>
              )}
            </div>
          ))}
        </div>

        <label className="field" style={{ maxWidth: 340 }}>{t("as.fallback")}
          <select value={draft.fallbackId} onChange={(e) => setDraft({ ...draft, fallbackId: e.target.value })}>{view.staff.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <span className="small muted">{t("as.fallbackHint")}</span>
        </label>
        {admin && embedded && <a className="small" href="/office/staff">{t("as.addPerson")}</a>}
        {admin && <div className="row"><button type="button" className="button" disabled={problems.overlaps.length > 0} onClick={() => void save()}>{t("common.save")}</button>{saved && <span className="q-status ok"><i />{t("as.saved")}</span>}</div>}
      </fieldset>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
