/** 原组合后台仅绑定同一已验证宿主；字段、呈现、权限和原操作恢复由 AI 包单源维护。 */
import type { ComponentProps } from "react";
import { TenantAiCreditSettings as OriginalTenantAiCreditSettings, PlatformAiCreditSettings as OriginalPlatformAiCreditSettings } from "@rental-os/ai-native-admin/source/platform-model-settings/AiCreditSettings";
import { LegacyAiAdminHost } from "./legacy-host";

export function TenantAiCreditSettings(props: ComponentProps<typeof OriginalTenantAiCreditSettings>) {
  return <LegacyAiAdminHost><OriginalTenantAiCreditSettings {...props} /></LegacyAiAdminHost>;
}

export function PlatformAiCreditSettings(props: ComponentProps<typeof OriginalPlatformAiCreditSettings>) {
  return <LegacyAiAdminHost><OriginalPlatformAiCreditSettings {...props} /></LegacyAiAdminHost>;
}
