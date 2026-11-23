/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/AutomationReviewWorkbench";
import { AutomationReviewWorkbench as Original } from "@rental-os/rental-core/admin/task-center/AutomationReviewWorkbench";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const AutomationReviewWorkbench = bindLegacyRentalAssistant(Original);
