/** 原组合后台仅绑定同一已验证宿主；字段、呈现、权限和原操作恢复由 AI 包单源维护。 */
import type { ComponentProps } from "react";
import { PlatformPriceReview as OriginalPlatformPriceReview } from "@rental-os/ai-native-admin/source/platform-model-settings/PlatformPriceReview";
import { LegacyAiAdminHost } from "./legacy-host";

export function PlatformPriceReview(props: ComponentProps<typeof OriginalPlatformPriceReview>) {
  return <LegacyAiAdminHost><OriginalPlatformPriceReview {...props} /></LegacyAiAdminHost>;
}
