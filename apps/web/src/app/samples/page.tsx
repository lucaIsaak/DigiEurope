"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { api, sampleUrl, type SampleList } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function Samples() {
  const { t, bi } = useI18n();
  const [list, setList] = useState<SampleList | null>(null);
  useEffect(() => void api.samples().then(setList), []);
  if (!list) return <Spinner label={t("common.loading")} />;
  return (
    <div className="narrow stack">
      <h1>{t("samples.title")}</h1>
      <p className="lead">{t("samples.lead")}</p>
      {list.sets.map((s) => (
        <section className="card" key={s.id}>
          <h2>{bi(s.title)}</h2>
          <p className="muted">{bi(s.note)}</p>
          <h3>{t("samples.docs")}</h3>
          <ul>{s.docs.map((d) => <li key={d.name}><a href={sampleUrl(s.id, "docs", d.name)} download={d.name}>{d.name}</a> <span className="pill pill-muted">{t(d.audience === "parents" ? "samples.forParents" : "samples.forStudent")}</span></li>)}</ul>
          {s.fixes.length > 0 && (
            <>
              <h3>{t("samples.fixes")}</h3>
              <ul>{s.fixes.map((d) => <li key={d.name}><a href={sampleUrl(s.id, "fixes", d.name)} download={d.name}>{d.name}</a> <span className="pill pill-muted">{t(d.audience === "parents" ? "samples.forParents" : "samples.forStudent")}</span></li>)}</ul>
            </>
          )}
        </section>
      ))}
      <section className="card">
        <h2>{t("samples.letter")}</h2>
        <ul><li><a href={sampleUrl("letter", "docs", list.letter)} download={list.letter}>{list.letter}</a></li></ul>
      </section>
    </div>
  );
}
