/** Original admin entry; the selected AI package owns the same implementation. */
export * from "@rental-os/ai-native-admin/source/ai-native/TaskCancellation";
import type { ComponentProps } from "react";
import { TaskCancellation as OriginalTaskCancellation } from "@rental-os/ai-native-admin/source/ai-native/TaskCancellation";
import { LegacyAiAdminHost } from "./legacy-host";
export function TaskCancellation(props: ComponentProps<typeof OriginalTaskCancellation>) {
  return <LegacyAiAdminHost><OriginalTaskCancellation {...props} /></LegacyAiAdminHost>;
}
