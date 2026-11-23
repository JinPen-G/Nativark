/** 原组合后台仅绑定原会话；设置正文与恢复逻辑由所选 AI 包单源提供。 */
import type { ComponentProps } from "react";
import { AiModelSettingsPage as OriginalAiModelSettingsPage } from "@rental-os/ai-native-admin/source/tenant-model-settings/AiModelSettingsPage";
import { APP_ROUTES } from "@/app/navigation";
import { LegacyAiAdminHost } from "./legacy-host";

export function AiModelSettingsPage(props: Omit<ComponentProps<typeof OriginalAiModelSettingsPage>, "taskCenterPath">) {
  return <LegacyAiAdminHost><OriginalAiModelSettingsPage {...props} taskCenterPath={APP_ROUTES.aiTasks.path} /></LegacyAiAdminHost>;
}
