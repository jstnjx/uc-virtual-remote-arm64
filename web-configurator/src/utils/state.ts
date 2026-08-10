/**
 * Return a stable lowercase state identifier without assuming the API value
 * is already a string. Some integrations expose nested state/value objects.
 */
export function normalizeState(value: unknown): string {
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).toLowerCase();
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nested = record.state ?? record.value ?? record.status;
    if (nested !== undefined && nested !== value) {
      return normalizeState(nested);
    }
    return "";
  }
  return String(value).toLowerCase();
}
