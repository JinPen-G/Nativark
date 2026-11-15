/** In-memory draft protection for live server snapshots. No browser storage,
 * request, permission decision or business conflict resolution occurs here. */
export function formSnapshotFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) => field && typeof field === "object" && !Array.isArray(field)
    ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a.localeCompare(b))) : field) ?? "undefined";
}

export class ServerFormSnapshot {
  private source: unknown;
  private baseline: string | undefined;
  private saved: string | undefined;

  savedValues(fingerprint: string) { this.saved = fingerprint; }
  isCurrent(source: unknown) { return this.source === source; }

  sync(source: unknown, current: string, apply: () => string): boolean {
    if (source == null) return false;
    if (this.saved !== undefined) {
      // A successful save must not discard edits typed while awaiting it.
      if (this.saved === current) this.baseline = current;
      this.saved = undefined;
    }
    if (source === this.source || this.baseline !== undefined && current !== this.baseline) return false;
    this.baseline = apply();
    this.source = source;
    return true;
  }
}

const savedListeners = new WeakMap<object, Set<(fingerprint: string) => void>>();
export function subscribeFormSave(form: object, listener: (fingerprint: string) => void) {
  const listeners = savedListeners.get(form) ?? new Set();
  listeners.add(listener); savedListeners.set(form, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) savedListeners.delete(form); };
}
export function notifyFormSaved(form: object, fingerprint: string) {
  savedListeners.get(form)?.forEach(listener => listener(fingerprint));
}
