/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/api/aiTaskRuleDraft";
import { createAiTaskRuleDraftApi } from "@rental-os/rental-core/admin/task-center/api/aiTaskRuleDraft";
import { rentalBrowserSession } from "./http";
export const aiTaskRuleDraftApi = createAiTaskRuleDraftApi(rentalBrowserSession);
