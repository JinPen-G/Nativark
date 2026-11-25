/** 原路径保留公共名称，正文由 Rental 任务中心提供。 */
export * from "@rental-os/rental-core/admin/task-center/api/aiAutomationOriginalRefunds";
import { createAiAutomationOriginalRefundsApi } from "@rental-os/rental-core/admin/task-center/api/aiAutomationOriginalRefunds";
import { rentalBrowserSession } from "./http";
import { aiAutomationReviewsApi } from "./aiAutomationReviews";
export const readAutomationOriginalRefund = createAiAutomationOriginalRefundsApi(rentalBrowserSession, aiAutomationReviewsApi);
