import { RULES, type Application, type Bilingual } from "@digieurope/shared";
import { DAY_MS } from "@digieurope/shared";

export interface Insights {
  total: number;
  open: number;
  byStatus: Record<string, number>;
  /** Share of cases without blocking findings at the first check, in percent. */
  firstTimeComplete: number;
  medianDaysToDecision: number | null;
  perWeek: { week: string; count: number }[];
  missing: { ruleId: string; title: Bilingual; count: number; share: number; recommendation?: Bilingual; documentKind?: string }[];
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null);

export function computeInsights(apps: Application[], now: Date): Insights {
  const real = apps.filter((a) => a.status !== "draft");
  const byStatus: Record<string, number> = {};
  for (const a of apps) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  const counts = new Map<string, number>();
  for (const a of real) for (const id of a.firstFindings) counts.set(id, (counts.get(id) ?? 0) + 1);
  const complete = real.filter((a) => a.firstFindings.length === 0).length;
  const days = real.filter((a) => a.decision && a.submittedAt).map((a) => (Date.parse(a.decision!.decidedAt) - Date.parse(a.submittedAt!)) / DAY_MS);
  const perWeek: Insights["perWeek"] = [];
  for (let w = 7; w >= 0; w--) {
    const to = now.getTime() - w * 7 * DAY_MS;
    const from = to - 7 * DAY_MS;
    perWeek.push({
      week: new Date(from).toISOString().slice(5, 10),
      count: real.filter((a) => a.submittedAt && Date.parse(a.submittedAt) > from && Date.parse(a.submittedAt) <= to).length,
    });
  }
  const missing = [...counts.entries()]
    .map(([ruleId, count]) => {
      const rule = RULES.find((r) => r.id === ruleId);
      return { ruleId, title: rule?.title ?? { de: ruleId, en: ruleId }, count, share: real.length ? Math.round((count / real.length) * 100) : 0, recommendation: rule?.recommendation, documentKind: rule?.documentKind };
    })
    .sort((a, b) => b.count - a.count);
  return {
    total: real.length,
    open: real.filter((a) => ["submitted", "in_review", "info_requested"].includes(a.status)).length,
    byStatus,
    firstTimeComplete: real.length ? Math.round((complete / real.length) * 100) : 0,
    medianDaysToDecision: median(days) === null ? null : Math.round(median(days)! * 10) / 10,
    perWeek,
    missing,
  };
}
