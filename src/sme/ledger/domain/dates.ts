/** Days without activity after which an account is shown as stale (W2-05). */
export const STALE_AFTER_DAYS = 14;

/** Today's date in Jordan, as YYYY-MM-DD. */
export function todayInAmman(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function isStale(lastValueDate: string | null, today: string): boolean {
  return lastValueDate === null || daysBetween(lastValueDate, today) > STALE_AFTER_DAYS;
}
