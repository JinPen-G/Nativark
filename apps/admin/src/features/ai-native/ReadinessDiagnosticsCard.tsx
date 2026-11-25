/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/ReadinessDiagnosticsCard";
import { ReadinessDiagnosticsCard as Original } from "@rental-os/rental-core/admin/task-center/ReadinessDiagnosticsCard";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const ReadinessDiagnosticsCard = bindLegacyRentalAssistant(Original);
