import { isAudioReady, playVoice, unlockAudio } from "./soundEngine";
import { soundPreferences } from "./soundPreferences";
import { resolveSoundPack, type InteractionSound, type NotificationSound, type SoundName } from "./soundPacks";

export interface SoundScope { key: string; epoch: number }
export interface SoundEvent extends SoundScope { id: string; type: NotificationSound }
let scope: SoundScope | null = null;
let lastNotificationAt = -Infinity;
const seen = new Map<string, number>();
const DEDUPE_MS = 60_000;
const MIN_GAP_MS = 700;

/** 由已验证会话的 UI 根组件提供范围，本模块不导入 authStore/queryClient。 */
export function setSoundScope(next: SoundScope | null): void {
  if (scope?.key === next?.key && scope?.epoch === next?.epoch) return;
  scope = next;
  seen.clear();
  lastNotificationAt = -Infinity;
}
export function captureSoundScope(): SoundScope | null { return scope ? { ...scope } : null; }

function play(name: SoundName): boolean {
  const preferences = soundPreferences.getSnapshot();
  return playVoice(resolveSoundPack(preferences.pack).sounds[name], preferences.volume);
}
export async function previewSound(name: SoundName): Promise<boolean> {
  if (!await unlockAudio()) return false;
  return play(name);
}
export async function playInteractionSound(name: InteractionSound): Promise<boolean> {
  if (!soundPreferences.getSnapshot().interactionEnabled || !await unlockAudio()) return false;
  return soundPreferences.getSnapshot().interactionEnabled && play(name);
}
export function unlockSoundFromGesture(): void {
  const preferences = soundPreferences.getSnapshot();
  if (preferences.interactionEnabled || preferences.notificationEnabled) void unlockAudio();
}

function focused(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
}

/** 显式结果入口。当前没有收件箱，不能把发送日志传入来模拟新消息。 */
export async function emitSoundEvent(event: SoundEvent): Promise<boolean> {
  const expectedScope = scope;
  if (!expectedScope || event.key !== expectedScope.key || event.epoch !== expectedScope.epoch || !event.id) return false;
  const now = Date.now();
  for (const [id, at] of seen) if (now - at > DEDUPE_MS) seen.delete(id);
  if (seen.has(event.id)) return false;
  seen.set(event.id, now);
  if (seen.size > 128) seen.delete(seen.keys().next().value!);

  // 即使关闭/未解锁也登记本页已见事件，不在以后开启时补响。
  const eligible = () => {
    const preferences = soundPreferences.getSnapshot();
    return scope === expectedScope && preferences.notificationEnabled && preferences.volume > 0 && isAudioReady();
  };
  if (!eligible()) return false;

  const deliver = (shared: boolean): boolean => {
    if (!eligible()) return false;
    const at = Date.now();
    if (shared) {
      try {
        const key = `rental_admin_sound_seen:${event.key}`;
        const stored = JSON.parse(window.localStorage.getItem(key) ?? "{}");
        const valid: Record<string, number> = Object.create(null);
        if (stored && typeof stored === "object") {
          for (const [id, value] of Object.entries(stored).slice(-128)) {
            if (typeof value === "number" && value <= at && at - value < DEDUPE_MS) valid[id] = value;
          }
        }
        if (Object.hasOwn(valid, event.id)) return false;
        valid[event.id] = at;
        window.localStorage.setItem(key, JSON.stringify(valid));
      } catch {
        if (!focused()) return false;
      }
    } else if (!focused()) return false;
    if (at - lastNotificationAt < MIN_GAP_MS) return false;
    lastNotificationAt = at;
    return play(event.type);
  };

  try {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request(`rental-sound:${event.key}`, { ifAvailable: true }, lock => lock ? deliver(true) : false);
    }
    return deliver(false);
  } catch { return false; }
}

export const INTERACTIVE_SELECTOR = "button, a[href], input:not([type='hidden']), textarea, select, summary, [role='button'], [role='checkbox'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='option'], [role='radio'], [role='switch'], [role='tab'], [role='combobox'], [aria-pressed]";
const CLOSE_RE = /close|dismiss|remove|delete|collapse|cancel|clear|关闭|取消|删除|移除|清除|收起/i;
const PULSE_RE = /send|save|submit|calculate|create|add|upgrade|replay|保存|提交|发送|新建|创建|添加|升级|确定|确认/i;
export function pickInteractionSound(element: Element): InteractionSound {
  const override = element.getAttribute("data-sound");
  if (override === "press" || override === "tick" || override === "release" || override === "page" || override === "pulse") return override;
  const text = `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`.replace(/\s+/g, "");
  if (CLOSE_RE.test(text)) return "release";
  if (element.matches("input[type='checkbox'], input[type='radio'], select, [role='checkbox'], [role='radio'], [role='switch'], [role='tab'], [role='option'], [role='combobox'], [role='menuitemcheckbox'], [role='menuitemradio'], [aria-pressed]")) return "tick";
  if (element.matches("a[href], [role='menuitem']")) return "page";
  if (PULSE_RE.test(text)) return "pulse";
  if (element.matches("input, textarea")) return "tick";
  return "press";
}
