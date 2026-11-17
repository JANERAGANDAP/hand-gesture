// Accept native PostgreSQL JSON values and legacy serialized values.

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
