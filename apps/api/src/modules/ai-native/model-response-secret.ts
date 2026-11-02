/** Inspect decoded keys and values before serialization can escape credential
 * characters. Keep the serialized check for existing cross-field detection. */
export function modelResponseContainsSecret(value: unknown, credential: string): boolean {
  if (!credential) return false;
  const seen = new Set<object>();
  const visit = (item: unknown): boolean => {
    if (typeof item === 'string') return item.includes(credential);
    if (!item || typeof item !== 'object' || seen.has(item)) return false;
    seen.add(item);
    return Object.entries(item).some(([key, child]) => key.includes(credential) || visit(child));
  };
  if (visit(value)) return true;
  return JSON.stringify(value)?.includes(credential) ?? false;
}
