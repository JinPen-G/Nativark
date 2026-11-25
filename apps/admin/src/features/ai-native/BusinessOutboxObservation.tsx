/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/BusinessOutboxObservation";
import { BusinessOutboxObservation as Original } from "@rental-os/rental-core/admin/task-center/BusinessOutboxObservation";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const BusinessOutboxObservation = bindLegacyRentalAssistant(Original);
