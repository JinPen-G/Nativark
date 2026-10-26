import { useSyncExternalStore } from "react";
import { isMotionReduced, subscribeMotionPreference } from "@/app/motionPreferences";
/** Shared effective setting: explicit browser preference or live system preference. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeMotionPreference, isMotionReduced, () => false);
}
