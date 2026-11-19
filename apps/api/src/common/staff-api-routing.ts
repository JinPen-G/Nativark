/** 原员工入口复用 Rental 唯一映射；正式 AI 路径仍取自 Shared 原声明。 */
import { AI_STAFF_INSPECTION_HTTP_DRAFT, AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT } from "@rental-os/shared";
import { createRentalStaffApiRouting } from "@rental-os/rental-core/staff-routing";

export const staffApiRoutingMiddleware = createRentalStaffApiRouting({
  AI_STAFF_INSPECTION_HTTP_DRAFT, AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT
});
