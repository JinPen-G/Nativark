/** Original task transport consumes the same authenticated AdminRuntime. */
import { createAiTaskCenterApi } from "@rental-os/ai-native-admin/source/api/aiTaskCenter";
import { adminRuntime } from "@/app/adminRuntime";
export const aiTaskCenterApi = createAiTaskCenterApi(adminRuntime);
