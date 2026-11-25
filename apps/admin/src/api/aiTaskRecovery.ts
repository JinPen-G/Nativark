/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/api/aiTaskRecovery";
import { createAiTaskRecoveryApi } from "@rental-os/rental-core/admin/task-center/api/aiTaskRecovery";
import { rentalBrowserSession } from "./http";
export const aiTaskRecoveryApi = createAiTaskRecoveryApi(rentalBrowserSession);
