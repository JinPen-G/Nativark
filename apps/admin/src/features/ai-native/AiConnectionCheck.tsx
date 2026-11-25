/** 原组合后台仅绑定原会话；设置正文与恢复逻辑由所选 AI 包单源提供。 */
import type { ComponentProps } from "react";
import { AiConnectionCheck as OriginalAiConnectionCheck } from "@rental-os/ai-native-admin/source/tenant-model-settings/AiConnectionCheck";
import { LegacyAiAdminHost } from "./legacy-host";

export function AiConnectionCheck(props: ComponentProps<typeof OriginalAiConnectionCheck>) {
  return <LegacyAiAdminHost><OriginalAiConnectionCheck {...props} /></LegacyAiAdminHost>;
}
