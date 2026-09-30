import { DEFAULT_SOUND_PACK, resolveSoundPack } from "./soundPacks";

export const SOUND_PREFERENCES_KEY = "rental_admin_sound_preferences";
export const LEGACY_SOUND_KEY = "rental_admin_sound";
export interface SoundPreferences {
  version: 1;
  pack: string;
  interactionEnabled: boolean;
  notificationEnabled: boolean;
  volume: number;
}
export const DEFAULT_SOUND_PREFERENCES: Readonly<SoundPreferences> = Object.freeze({
  version: 1, pack: DEFAULT_SOUND_PACK, interactionEnabled: false, notificationEnabled: false, volume: 0.32
});

export function parseSoundPreferences(raw: string | null, legacy: string | null): SoundPreferences {
  const fallback = { ...DEFAULT_SOUND_PREFERENCES, interactionEnabled: legacy === "on" };
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || data.version !== 1) return fallback;
    return {
      version: 1,
      pack: resolveSoundPack(typeof data.pack === "string" ? data.pack : DEFAULT_SOUND_PACK).id,
      interactionEnabled: typeof data.interactionEnabled === "boolean" ? data.interactionEnabled : false,
      notificationEnabled: typeof data.notificationEnabled === "boolean" ? data.notificationEnabled : false,
      volume: typeof data.volume === "number" && Number.isFinite(data.volume) ? Math.min(1, Math.max(0, data.volume)) : 0.32
    };
  } catch { return fallback; }
}

/** storage 参数可替换供专项测试；运行时只有一个 store，所有设置和监听器共用。 */
export function createSoundPreferencesStore(storage: () => Pick<Storage, "getItem" | "setItem"> | null, target?: Window) {
  let snapshot: SoundPreferences | undefined;
  const listeners = new Set<() => void>();
  function read(): SoundPreferences {
    try {
      const store = storage();
      if (!store) return snapshot ?? { ...DEFAULT_SOUND_PREFERENCES };
      return parseSoundPreferences(store.getItem(SOUND_PREFERENCES_KEY), store.getItem(LEGACY_SOUND_KEY));
    } catch { return snapshot ?? { ...DEFAULT_SOUND_PREFERENCES }; }
  }
  function publish(next: SoundPreferences) {
    if (snapshot && JSON.stringify(snapshot) === JSON.stringify(next)) return;
    snapshot = next;
    listeners.forEach(listener => listener());
  }
  const getSnapshot = () => snapshot ?? (snapshot = read());
  const onStorage = (event: StorageEvent) => {
    if (event.key === SOUND_PREFERENCES_KEY || event.key === LEGACY_SOUND_KEY || event.key === null) publish(read());
  };
  return {
    getSnapshot,
    subscribe(listener: () => void) {
      if (!listeners.size) {
        target?.addEventListener("storage", onStorage);
        publish(read());
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) target?.removeEventListener("storage", onStorage);
      };
    },
    update(patch: Partial<Omit<SoundPreferences, "version">>) {
      const next = parseSoundPreferences(JSON.stringify({ ...getSnapshot(), ...patch, version: 1 }), null);
      try { storage()?.setItem(SOUND_PREFERENCES_KEY, JSON.stringify(next)); } catch { /* 本会话保留内存偏好 */ }
      publish(next);
    }
  };
}

export const soundPreferences = createSoundPreferencesStore(
  () => typeof window === "undefined" ? null : window.localStorage,
  typeof window === "undefined" ? undefined : window
);
