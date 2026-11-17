export const DAY_MS = 86_400_000;

export function parseDate(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function addDays(iso: string, days: number): string {
  const d = parseDate(iso) ?? new Date();
  return isoDate(new Date(d.getTime() + days * DAY_MS));
}
