import { useEffect } from "react";
import { currentSessionEpoch } from "../../app/queryClient";
import { useAuthStore } from "../auth/authStore";
import { setMasterGain } from "./soundEngine";
import { soundPreferences } from "./soundPreferences";
import { INTERACTIVE_SELECTOR, pickInteractionSound, playInteractionSound, setSoundScope, unlockSoundFromGesture } from "./soundService";

/** 交互只选择语义，方案/音量/结果音策略统一交给 soundService。 */
export function GlobalInteractionSounds() {
  const userId = useAuthStore(state => state.user?.id);
  const tenantId = useAuthStore(state => state.tenant?.tenantId);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);

  useEffect(() => {
    setSoundScope(userId ? { key: JSON.stringify([userId, tenantId ?? "platform", workspaceId ?? "none"]), epoch: currentSessionEpoch() } : null);
    return () => setSoundScope(null);
  }, [userId, tenantId, workspaceId]);

  useEffect(() => {
    const syncVolume = () => setMasterGain(soundPreferences.getSnapshot().volume);
    const unsubscribe = soundPreferences.subscribe(syncVolume);
    syncVolume();
    const onGesture = (event: Event) => { if (event.isTrusted) unlockSoundFromGesture(); };
    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const element = event.target.closest(INTERACTIVE_SELECTOR);
      if (!element || element.closest("[data-sound-silent], [inert], [aria-disabled='true'], .ant-btn-loading") || element.matches(":disabled")) return;
      void playInteractionSound(pickInteractionSound(element));
    };
    document.addEventListener("pointerdown", onGesture, true);
    document.addEventListener("keydown", onGesture, true);
    document.addEventListener("click", onClick, true);
    return () => {
      unsubscribe();
      document.removeEventListener("pointerdown", onGesture, true);
      document.removeEventListener("keydown", onGesture, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
