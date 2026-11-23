/** 原 API 名称继续绑定同一认证宿主；运输、当前权限与不重发规则在 AI 包单源维护。 */
import { createPlatformAiSettingsApi } from "@rental-os/ai-native-admin/source/platform-model-settings/platformAiSettings";
import { legacyAiAdminHost } from "@/features/ai-native/legacy-host";

export const platformAiSettingsApi = createPlatformAiSettingsApi(legacyAiAdminHost);
