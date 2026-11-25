/** Original admin entry; the selected AI package owns the same implementation. */
export * from "@rental-os/ai-native-admin/source/ai-native/TaskWorkbenchModelControls";
import type { ComponentProps } from "react";
import { TaskWorkbenchModelControls as OriginalTaskWorkbenchModelControls } from "@rental-os/ai-native-admin/source/ai-native/TaskWorkbenchModelControls";
import { LegacyAiAdminHost } from "./legacy-host";
export function TaskWorkbenchModelControls(props: ComponentProps<typeof OriginalTaskWorkbenchModelControls>) {
  return <LegacyAiAdminHost><OriginalTaskWorkbenchModelControls {...props} /></LegacyAiAdminHost>;
}
