// Shared YYYY-MM-DD parser used by both display formatting and sort ordering.
// Returns a UTC Date on success, null when the string does not match the
// expected format or the components do not round-trip (e.g. 2026-02-30).

/**
 * Parse a strict YYYY-MM-DD date string into a UTC Date.
 * Returns null when the regex does not match or the calendar components do
 * not round-trip (which catches impossible dates such as 2026-02-30).
 */
export function parseSlowupDateUTC(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const parsedYear = Number.parseInt(year, 10);
  const parsedMonth = Number.parseInt(month, 10);
  const parsedDay = Number.parseInt(day, 10);
  const parsedDate = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay));
  const isValidDate =
    parsedDate.getUTCFullYear() === parsedYear &&
    parsedDate.getUTCMonth() === parsedMonth - 1 &&
    parsedDate.getUTCDate() === parsedDay;

  if (!isValidDate) {
    return null;
  }

  return parsedDate;
}
