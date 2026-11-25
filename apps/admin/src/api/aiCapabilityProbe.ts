/** 原组合后台仅绑定原会话；设置正文与恢复逻辑由所选 AI 包单源提供。 */
import { createAiCapabilityProbeApi } from "@rental-os/ai-native-admin/source/tenant-model-settings/aiCapabilityProbe";
import { legacyAiAdminHost } from "@/features/ai-native/legacy-host";
export type { CapabilityProbeAction } from "@rental-os/ai-native-admin/source/tenant-model-settings/aiCapabilityProbe";

export const aiCapabilityProbeApi = createAiCapabilityProbeApi(legacyAiAdminHost);
