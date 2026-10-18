const DAY_MS = 86_400_000;

function calendarDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : NaN;
}

/** Visual cell offsets only; booking nights and availability stay date-based. */
export function getCalendarBarLayout(
  arrival: string,
  departure: string,
  calendarStart: string,
  visibleDays = 7,
): { start: number; end: number } | null {
  const from = calendarDate(arrival);
  const to = calendarDate(departure);
  const origin = calendarDate(calendarStart);
  if (![from, to, origin].every(Number.isFinite) || to <= from || !Number.isInteger(visibleDays) || visibleDays < 1) return null;

  // Shift both endpoints before clipping, so checkout on the first day remains visible.
  const start = Math.max(0, (from - origin) / DAY_MS + 0.5);
  const end = Math.min(visibleDays, (to - origin) / DAY_MS + 0.5);
  return end > start ? { start, end } : null;
}
