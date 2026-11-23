/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/api/aiOpeningDiagnostics";
import { createAiOpeningDiagnosticsApi } from "@rental-os/rental-core/admin/task-center/api/aiOpeningDiagnostics";
import { rentalBrowserSession } from "./http";
export const aiOpeningDiagnosticsApi = createAiOpeningDiagnosticsApi(rentalBrowserSession);
