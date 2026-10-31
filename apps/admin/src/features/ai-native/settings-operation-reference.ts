/** Browser journal for non-secret operation references only. Persistence is not
 * business authority; unavailable/corrupt storage must not start a new save. */
export type SettingsReferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class SettingsReferenceUnavailable extends Error {
  constructor() { super('AI_SETTINGS_REFERENCE_UNAVAILABLE'); }
}
export function readSettingsReference<T>(storage: SettingsReferenceStorage | undefined, storageKey: string,
  parse: (value: unknown) => T | null): { pending: T | null; blocked: boolean } {
  try {
    if (!storage || !storageKey) throw new SettingsReferenceUnavailable();
    const raw = storage.getItem(storageKey);
    if (raw === null) return { pending: null, blocked: false };
    if (raw.length > 1024) throw new SettingsReferenceUnavailable();
    const pending = parse(JSON.parse(raw));
    if (!pending) throw new SettingsReferenceUnavailable();
    return { pending, blocked: false };
  } catch { return { pending: null, blocked: true }; }
}
export function retainSettingsReference(storage: SettingsReferenceStorage | undefined, storageKey: string, reference: object): void {
  try {
    if (!storage || !storageKey) throw new SettingsReferenceUnavailable();
    const serialized = JSON.stringify(reference), previous = storage.getItem(storageKey);
    // A new operation must not replace an older unknown one, even if this
    // editor was opened before another instance retained its reference.
    if (serialized.length > 1024 || previous !== null && previous !== serialized) throw new SettingsReferenceUnavailable();
    storage.setItem(storageKey, serialized);
    if (storage.getItem(storageKey) !== serialized) throw new SettingsReferenceUnavailable();
  } catch { throw new SettingsReferenceUnavailable(); }
}
export function clearSettingsReference(storage: SettingsReferenceStorage | undefined, storageKey: string, reference: object): void {
  try {
    if (!storage || !storageKey) throw new SettingsReferenceUnavailable();
    const current = storage.getItem(storageKey);
    if (current !== null && current !== JSON.stringify(reference)) throw new SettingsReferenceUnavailable();
    storage.removeItem(storageKey);
    if (storage.getItem(storageKey) !== null) throw new SettingsReferenceUnavailable();
  } catch { throw new SettingsReferenceUnavailable(); }
}
