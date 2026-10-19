import { config } from "../config.js";

/** Converts minor units to EUR cents. Only EUR and USD are expected in Phase 1. */
export function toEurCents(amountCents: number, currency: string): number {
  const c = currency.toUpperCase();
  if (c === "EUR") return amountCents;
  if (c === "USD") return Math.round(amountCents * config.budget.usdToEur);
  throw new Error(`No conversion rate configured for ${currency}`);
}

export function formatEur(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const amount = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}€${amount}`;
}

/** Start of "today" in the configured timezone, as a UTC Date. */
export function startOfDay(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date); // YYYY-MM-DD
  return zonedMidnight(parts, timeZone);
}

export function startOfMonth(date: Date, timeZone: string): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return zonedMidnight(`${ymd.slice(0, 7)}-01`, timeZone);
}

function zonedMidnight(ymd: string, timeZone: string): Date {
  // Guess UTC midnight, then correct by the zone's offset at that instant.
  const guess = new Date(`${ymd}T00:00:00Z`);
  const offsetMs = zoneOffsetMs(guess, timeZone);
  const result = new Date(guess.getTime() - offsetMs);
  // Re-check in case the offset changed across a DST boundary.
  const offset2 = zoneOffsetMs(result, timeZone);
  return offset2 === offsetMs ? result : new Date(guess.getTime() - offset2);
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - date.getTime();
}
