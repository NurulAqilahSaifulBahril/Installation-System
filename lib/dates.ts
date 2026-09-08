/**
 * Calendar dates in this app are plain `YYYY-MM-DD` strings. That is what the
 * date inputs produce, what the shared planning state stores, and what the
 * range filters compare with `<` and `>`.
 *
 * Postgres `date` columns do not survive the round trip in that shape: the
 * proxy serialises them as full UTC timestamps ("2026-08-24T00:00:00.000Z").
 * Handed back to the dashboard unchanged those break three ways at once —
 * `new Date(`${value}T00:00:00`)` becomes Invalid Date and crashes the render,
 * `<input type="date">` refuses the value, and a string compare against a
 * `YYYY-MM-DD` key sorts wrong because the timestamp is the longer string.
 *
 * So every date coming out of the database is narrowed here, at the API
 * boundary, rather than at each of the places that reads one.
 */
export function toDateOnly(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }

  if (typeof value !== 'string') return null;

  // Deliberately a text slice and not a Date round trip: a `date` column has no
  // timezone, and reparsing UTC midnight in a zone behind UTC would move it to
  // the previous day.
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
}

// Today in the timezone the business actually works in. The server may be
// anywhere, and every date this app compares against — an installation date,
// a payment date — is a Malaysian calendar day, so "today" has to be one too.
export function malaysiaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date());
}
