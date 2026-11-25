/** Original admin entry; the selected AI package owns the same implementation. */
export * from "@rental-os/ai-native-admin/source/ai-native/VisibleObservationHost";
import type { ComponentProps } from "react";
import { VisibleObservationHost as OriginalVisibleObservationHost } from "@rental-os/ai-native-admin/source/ai-native/VisibleObservationHost";
import { LegacyAiAdminHost } from "./legacy-host";
export function VisibleObservationHost(props: ComponentProps<typeof OriginalVisibleObservationHost>) {
  return <LegacyAiAdminHost><OriginalVisibleObservationHost {...props} /></LegacyAiAdminHost>;
}
