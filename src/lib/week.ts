/**
 * Week boundaries in a named time zone. The agent quota resets Monday 00:00 local time, so a
 * member can predict when they have room again – a rolling window cannot be reasoned about.
 * Pure (Intl only) so it works in the worker and can be unit tested.
 */

/** Milliseconds the zone is ahead of UTC at that instant (DST aware). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // "24" appears for midnight in some ICU versions – normalise it to 0.
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Start of the ISO week (Monday 00:00) containing `now`, as the UTC instant it corresponds to. */
export function weekStart(now: Date, timeZone: string): Date {
  const offset = zoneOffsetMs(now, timeZone);
  const local = new Date(now.getTime() + offset);
  // getUTC* on the shifted instant reads the local wall clock.
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday, 0, 0, 0);
  // The offset can differ at the week's start (DST switch mid-week), so resolve it there.
  const guess = new Date(localMidnight - offset);
  return new Date(localMidnight - zoneOffsetMs(guess, timeZone));
}

/** Start of the following week – the moment the quota is free again. */
export function nextWeekStart(now: Date, timeZone: string): Date {
  const start = weekStart(now, timeZone);
  // Adding 7×24 h can land at 23:00 or 01:00 across a DST switch; re-resolve from the local date.
  const offset = zoneOffsetMs(start, timeZone);
  const local = new Date(start.getTime() + offset);
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 7, 0, 0, 0);
  const guess = new Date(localMidnight - offset);
  return new Date(localMidnight - zoneOffsetMs(guess, timeZone));
}
