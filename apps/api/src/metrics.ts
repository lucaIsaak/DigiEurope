import type { Application, ApplicationStatus, Metrics } from "@digieurope/shared";

const DAY = 86_400_000;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

export function computeMetrics(apps: Application[], now = new Date()): Metrics {
  const totals = { draft: 0, submitted: 0, in_review: 0, info_requested: 0, id_check: 0, approved: 0, rejected: 0 } as Record<ApplicationStatus, number>;
  for (const a of apps) totals[a.status]++;

  const submitted = apps.filter((a) => a.submittedAt);
  const decided = submitted.filter((a) => a.decidedAt && (a.status === "approved" || a.status === "rejected"));
  const durations = decided.map((a) => (Date.parse(a.decidedAt!) - Date.parse(a.submittedAt!)) / DAY);
  const firstTime = decided.filter((a) => !a.history.some((h) => h.status === "info_requested")).length;

  const languages: Record<string, number> = {};
  for (const a of submitted) languages[a.language] = (languages[a.language] ?? 0) + 1;

  const thisWeek = mondayOf(now);
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(thisWeek.getTime() - (7 - i) * 7 * DAY);
    const end = start.getTime() + 7 * DAY;
    const inWeek = (iso?: string) => !!iso && Date.parse(iso) >= start.getTime() && Date.parse(iso) < end;
    return {
      weekStart: start.toISOString().slice(0, 10),
      submitted: submitted.filter((a) => inWeek(a.submittedAt)).length,
      decided: decided.filter((a) => inWeek(a.decidedAt)).length,
    };
  });

  return {
    generatedAt: now.toISOString(),
    totals,
    submittedLast30Days: submitted.filter((a) => now.getTime() - Date.parse(a.submittedAt!) <= 30 * DAY).length,
    decided: decided.length,
    completeAtFirstSubmission: decided.length ? firstTime / decided.length : 0,
    medianDaysToDecision: round1(median(durations)),
    averageDaysToDecision: round1(durations.length ? durations.reduce((s, x) => s + x, 0) / durations.length : null),
    approvedByMethod: {
      eid: decided.filter((a) => a.status === "approved" && a.identityMethod === "eid").length,
      passport: decided.filter((a) => a.status === "approved" && a.identityMethod === "passport").length,
    },
    digitalLandlordShare: submitted.length ? submitted.filter((a) => a.landlord.status === "confirmed").length / submitted.length : 0,
    languages,
    weekly,
  };
}
