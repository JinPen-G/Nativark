/** 原组合后台仅绑定原会话；设置正文与恢复逻辑由所选 AI 包单源提供。 */
import { createAiModelSettingsApi } from "@rental-os/ai-native-admin/source/tenant-model-settings/aiModelSettings";
import { legacyAiAdminHost } from "@/features/ai-native/legacy-host";

export const aiModelSettingsApi = createAiModelSettingsApi(legacyAiAdminHost);
