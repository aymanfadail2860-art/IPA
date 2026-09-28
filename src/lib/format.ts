/**
 * Danish formatting. Time zone is fixed so server and client render identical text.
 */
const TIME_ZONE = "Europe/Copenhagen";

const dateFormatter = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const shortDateFormatter = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  timeZone: TIME_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat("da-DK", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

function toDate(value: string): Date {
  // Plain dates are interpreted at noon to stay on the same calendar day in every zone.
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
}

/** "1. juli 2025" */
export function formatDate(value: string): string {
  return dateFormatter.format(toDate(value));
}

/** "1. jul." */
export function formatShortDate(value: string): string {
  return shortDateFormatter.format(toDate(value));
}

/** "09.12" */
export function formatTime(value: string): string {
  return timeFormatter.format(toDate(value));
}

/** "Dagen før" the given date, used for the end of a validity period (valid_to is exclusive). */
export function formatValidTo(value: string): string {
  const date = toDate(value);
  date.setDate(date.getDate() - 1);
  return dateFormatter.format(date);
}
