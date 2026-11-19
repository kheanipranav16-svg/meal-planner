// Date helpers. We work with whole calendar days ("YYYY-MM-DD") so that time
// zones and clock times can never cause an off-by-one in a discount.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Convert 'YYYY-MM-DD' (or a Date) into a whole-day number since 1970-01-01. */
export function dayNumber(value) {
  if (value instanceof Date) {
    return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / MS_PER_DAY);
  }
  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error(`Invalid date "${text}", expected YYYY-MM-DD`);
  const [, year, month, day] = match.map(Number);
  const ms = Date.UTC(year, month - 1, day);
  // Reject things like 2026-02-31, which JavaScript would silently roll over.
  if (new Date(ms).toISOString().slice(0, 10) !== text) throw new Error(`Invalid date "${text}"`);
  return Math.floor(ms / MS_PER_DAY);
}

/** Whole days from `today` until `date` (negative = already in the past). */
export function daysUntil(date, today = new Date()) {
  return dayNumber(date) - dayNumber(today);
}

/** 'YYYY-MM-DD' for `date` shifted by `days` (can be negative). */
export function addDays(date, days) {
  return new Date((dayNumber(date) + days) * MS_PER_DAY).toISOString().slice(0, 10);
}
