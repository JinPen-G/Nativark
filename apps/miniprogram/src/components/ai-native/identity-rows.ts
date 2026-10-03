/** Bounded display identities are rejected, never truncated into a different resource. */
export function identityRows(input: unknown, fields: readonly string[], limit = 128): Record<string, unknown>[] {
  if (!Array.isArray(input)) return [];
  const rows = input.slice(0, 50).filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === "object" && !Array.isArray(item) &&
    fields.every(field => typeof item[field] === "string" && item[field].length > 0 &&
      item[field].length <= limit && !/[\s\u0000-\u001f\u007f]/.test(item[field])));
  const key = (item: Record<string, unknown>) => JSON.stringify(fields.map(field => item[field]));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return rows.filter(row => counts.get(key(row)) === 1);
}
