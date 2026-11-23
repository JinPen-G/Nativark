/** Original admin entry; the selected AI package owns the same implementation. */
export * from "@rental-os/ai-native-admin/source/ai-native/AiTaskWorkbench";
import type { ComponentProps } from "react";
import { AiTaskWorkbench as OriginalAiTaskWorkbench } from "@rental-os/ai-native-admin/source/ai-native/AiTaskWorkbench";
import { LegacyAiAdminHost } from "./legacy-host";
export function AiTaskWorkbench(props: ComponentProps<typeof OriginalAiTaskWorkbench>) {
  return <LegacyAiAdminHost><OriginalAiTaskWorkbench {...props} /></LegacyAiAdminHost>;
}
