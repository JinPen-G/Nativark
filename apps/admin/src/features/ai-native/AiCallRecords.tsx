/** 原组合后台仅绑定原会话；设置正文与恢复逻辑由所选 AI 包单源提供。 */
import type { ComponentProps } from "react";
import { AiCallRecords as OriginalAiCallRecords } from "@rental-os/ai-native-admin/source/tenant-model-settings/AiCallRecords";
import { APP_ROUTES } from "@/app/navigation";
import { LegacyAiAdminHost } from "./legacy-host";

export function AiCallRecords(props: Omit<ComponentProps<typeof OriginalAiCallRecords>, "taskCenterPath">) {
  return <LegacyAiAdminHost><OriginalAiCallRecords {...props} taskCenterPath={APP_ROUTES.aiTasks.path} /></LegacyAiAdminHost>;
}
