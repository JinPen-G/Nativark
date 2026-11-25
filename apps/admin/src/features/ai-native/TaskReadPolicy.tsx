/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/TaskReadPolicy";
import { TaskReadPolicy as Original } from "@rental-os/rental-core/admin/task-center/TaskReadPolicy";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const TaskReadPolicy = bindLegacyRentalAssistant(Original);
