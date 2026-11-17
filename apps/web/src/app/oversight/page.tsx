"use client";

import { PROCESS_CATALOG, type CatalogNode } from "@digieurope/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function Catalogue() {
  const { t, bi } = useI18n();
  const [cov, setCov] = useState<Record<string, { id: string; name: string }[]> | null>(null);
  useEffect(() => {
    api.catalogue().then((c) => setCov(Object.fromEntries(c.coverage.map((x) => [x.id, x.offices]))));
  }, []);
  if (!cov) return <Spinner label={t("common.loading")} />;

  const rows = (nodes: CatalogNode[], depth: number): React.ReactNode =>
    nodes.map((n) =>
      n.children ? (
        <div key={n.id}>
          <div style={{ padding: "0.6rem 1rem", paddingLeft: `${1 + depth * 1.4}rem`, fontWeight: depth === 0 ? 700 : 600, background: depth === 0 ? "var(--bg)" : undefined, borderTop: "1px solid var(--line)" }}>{bi(n.title)}</div>
          {rows(n.children, depth + 1)}
        </div>
      ) : (
        <div key={n.id} className="row" style={{ padding: "0.6rem 1rem", paddingLeft: `${1 + depth * 1.4}rem`, justifyContent: "space-between", borderTop: "1px solid var(--line)" }}>
          <span>
            {bi(n.title)} <span className="small muted">{n.id}</span>
          </span>
          <span className="row" style={{ gap: "0.5rem" }}>
            {(cov[n.id] ?? []).length === 0 ? <span className="small muted">{t("oversight.noOffice")}</span> : <span className="pill">{t("oversight.offices", { n: cov[n.id]!.length })}</span>}
            {(cov[n.id] ?? []).length > 0 && <Link className="button button-small button-ghost" href={`/oversight/${n.id}`}>{t("oversight.compare")}</Link>}
          </span>
        </div>
      ),
    );

  return (
    <div className="stack">
      <div>
        <h1>{t("oversight.title")}</h1>
        <p className="lead" style={{ maxWidth: "78ch" }}>{t("oversight.lead")}</p>
      </div>
      <div className="table-wrap">{rows(PROCESS_CATALOG, 0)}</div>
    </div>
  );
}
