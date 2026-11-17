// Helpers for SQLite JSON string fields (Prisma stores Json as text in SQLite)
// When reading from DB, parse string to object. When writing, stringify object.

export function parseJsonField<T = unknown>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return raw as T; // already parsed (e.g. in-memory test)
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export function stringifyJsonField(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value; // already a string
  return JSON.stringify(value);
}
