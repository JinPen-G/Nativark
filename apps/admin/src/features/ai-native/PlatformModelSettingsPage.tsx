/** 原组合后台仅绑定同一已验证宿主；字段、呈现、权限和原操作恢复由 AI 包单源维护。 */
import type { ComponentProps } from "react";
import { PlatformModelSettingsPage as OriginalPlatformModelSettingsPage, PlatformModelDirectory as OriginalPlatformModelDirectory } from "@rental-os/ai-native-admin/source/platform-model-settings/PlatformModelSettingsPage";
import { LegacyAiAdminHost } from "./legacy-host";

export function PlatformModelSettingsPage() {
  return <LegacyAiAdminHost><OriginalPlatformModelSettingsPage /></LegacyAiAdminHost>;
}

export function PlatformModelDirectory(props: ComponentProps<typeof OriginalPlatformModelDirectory>) {
  return <LegacyAiAdminHost><OriginalPlatformModelDirectory {...props} /></LegacyAiAdminHost>;
}
