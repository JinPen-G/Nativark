/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/api/aiAutomationPolicies";
import { createAiAutomationPoliciesApi } from "@rental-os/rental-core/admin/task-center/api/aiAutomationPolicies";
import { rentalBrowserSession } from "./http";
export const aiAutomationPoliciesApi = createAiAutomationPoliciesApi(rentalBrowserSession);
