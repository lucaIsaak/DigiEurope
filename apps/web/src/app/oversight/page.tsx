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
        <div key={n.id} className={`cat-group d${depth}`}>
          {depth === 0 ? <h2>{bi(n.title)}</h2> : <h3>{bi(n.title)}</h3>}
          {rows(n.children, depth + 1)}
        </div>
      ) : (
        <div key={n.id} className="cat-leaf">
          <span>{bi(n.title)} <span className="small muted mono">{n.id}</span></span>
          {(cov[n.id] ?? []).length === 0 ? (
            <span className="small muted">{t("oversight.noOffice")}</span>
          ) : (
            <span className="row" style={{ gap: "1.25rem" }}>
              <span className="q-status ok"><i />{t("oversight.offices", { n: cov[n.id]!.length })}</span>
              <Link href={`/oversight/${n.id}`}>{t("oversight.compare")} →</Link>
            </span>
          )}
        </div>
      ),
    );

  return (
    <div className="ovs">
      <div className="ins-head">
        <h1>{t("oversight.title")}</h1>
        <p>{t("oversight.lead")}</p>
      </div>
      <div className="cat-tree">{rows(PROCESS_CATALOG, 0)}</div>
    </div>
  );
}
