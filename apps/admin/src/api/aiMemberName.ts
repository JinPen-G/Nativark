/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/api/aiMemberName";
import { createAiMemberNameApi } from "@rental-os/rental-core/admin/task-center/api/aiMemberName";
import { rentalBrowserSession } from "./http";
export const aiMemberNameApi = createAiMemberNameApi(rentalBrowserSession);
