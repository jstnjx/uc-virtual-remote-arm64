import { getCurrentLocale } from "@/composables/translatedProperty";

export function formatDate(
  dateInput: string | Date,
  timeFormat24h = true,
): string {
  if (!dateInput) return "";

  const locale = getCurrentLocale().replace("_", "-");

  const date: Date =
    dateInput instanceof Date ? dateInput : new Date(dateInput);

  if (isNaN(date.getTime())) return "";

  // Check if the input contains time info
  const raw = typeof dateInput === "string" ? dateInput : "";
  const hasTime =
    raw.includes("T") ||
    raw.includes(":") ||
    date.getHours() !== 0 ||
    date.getMinutes() !== 0 ||
    date.getSeconds() !== 0;

  return hasTime
    ? date.toLocaleString(locale, { hour12: !timeFormat24h })
    : date.toLocaleDateString(locale);
}

export function formatDateFromTimestamp(
  timestamp: number | string,
  timeFormat24h = true,
): string {
  if (timestamp === null || timestamp === undefined) return "";

  const num = typeof timestamp === "string" ? Number(timestamp) : timestamp;

  if (isNaN(num)) return "";

  // Detect seconds vs milliseconds
  const isSeconds = num < 1_000_000_000_000;
  const ms = isSeconds ? num * 1000 : num;

  const date = new Date(ms);
  if (isNaN(date.getTime())) return "";

  return formatDate(date, timeFormat24h);
}
