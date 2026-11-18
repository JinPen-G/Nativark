import { clientRecoveryKey, minimizeClientRecoveryRecord } from '@rental-os/shared';

export async function withClientRecoveryLock(scope: string, work: () => Promise<void>, wait = false) {
  if (!navigator.locks) throw Error('client_recovery_lock_unavailable');
  await navigator.locks.request(`ai-client-goal:${scope}`, { mode: 'exclusive', ifAvailable: !wait }, async lock => {
    if (!lock) throw Error('client_recovery_in_use');
    await work();
  });
}

export async function minimizeClientRecoveryStorage(storage: Storage) {
  for (const key of Object.keys(storage)) {
    const identity = clientRecoveryKey(key);
    if (!identity) continue;
    const clean = async () => {
      const raw = storage.getItem(key);
      if (raw === null) return;
      let value: unknown;
      try { value = JSON.parse(raw); } catch { value = null; }
      const minimal = JSON.stringify(minimizeClientRecoveryRecord(key, value));
      if (minimal !== raw && storage.getItem(key) === raw) storage.setItem(key, minimal);
    };
    try {
      if (identity.scope && navigator.locks) await withClientRecoveryLock(identity.scope, clean, true);
      else await clean();
    } catch { console.warn('client_recovery_storage_cleanup_unavailable'); }
  }
}
