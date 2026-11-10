/** Non-secret credit operation locators, not authority, a draft store or a ledger.
 * New references reuse the verified settings journal. Original full allocation
 * and plain decision markers remain readable/clearable only by exact snapshot;
 * corrupt storage or another editor's marker never means permission to resend. */
import { retainSettingsReference, SettingsReferenceUnavailable, type SettingsReferenceStorage } from './settings-operation-reference';

export type CreditReferenceStorage = SettingsReferenceStorage;
export type CreditReferenceState<T> = Readonly<{ reference: T | null; marker: string | null; blocked: boolean }>;
export function emptyCreditReference<T>(): CreditReferenceState<T> {
  return { reference: null, marker: null, blocked: false };
}
export function readCreditOperationReference<T>(storage: CreditReferenceStorage | undefined, storageKey: string,
  parse: (value: unknown) => T | null): CreditReferenceState<T> {
  let marker: string | null = null;
  try {
    if (!storage || !storageKey) throw new SettingsReferenceUnavailable();
    marker = storage.getItem(storageKey);
    if (marker === null) return emptyCreditReference<T>();
    // The old allocation page stored up to 64 workspace/amount entries. Keep
    // those original locators usable without rewriting or retaining new drafts.
    if (!marker || marker.length > 24576) throw new SettingsReferenceUnavailable();
    let value: unknown;
    try { value = JSON.parse(marker); } catch { value = marker; }
    const reference = parse(value);
    if (!reference) throw new SettingsReferenceUnavailable();
    return { reference, marker, blocked: false };
  } catch { return { reference: null, marker, blocked: true }; }
}
export function retainCreditOperationReference<T extends object>(storage: CreditReferenceStorage | undefined,
  storageKey: string, reference: T): CreditReferenceState<T> {
  const snapshot = structuredClone(reference);
  retainSettingsReference(storage, storageKey, snapshot);
  return { reference: snapshot, marker: JSON.stringify(snapshot), blocked: false };
}
export function clearCreditOperationReference<T>(storage: CreditReferenceStorage | undefined, storageKey: string,
  original: CreditReferenceState<T>): void {
  try {
    if (!storage || !storageKey || original.marker === null || !original.reference
      || storage.getItem(storageKey) !== original.marker) throw new SettingsReferenceUnavailable();
    storage.removeItem(storageKey);
    if (storage.getItem(storageKey) !== null) throw new SettingsReferenceUnavailable();
  } catch { throw new SettingsReferenceUnavailable(); }
}
