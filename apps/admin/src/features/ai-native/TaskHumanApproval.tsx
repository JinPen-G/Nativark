/** 原后台兼容入口；正文与恢复状态由选装 Rental 助手单源提供。 */
export * from "@rental-os/rental-core/admin/assistant/source/ai-native/TaskHumanApproval";
import { TaskProposalExecutionBoundary as OriginalTaskProposalExecutionBoundary, TaskActionResults as OriginalTaskActionResults, TaskOrderMaterialDetails as OriginalTaskOrderMaterialDetails, TaskOrderQuoteAmounts as OriginalTaskOrderQuoteAmounts, TaskHumanReviewDetails as OriginalTaskHumanReviewDetails, TaskHumanApproval as OriginalTaskHumanApproval } from "@rental-os/rental-core/admin/assistant/source/ai-native/TaskHumanApproval";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const TaskProposalExecutionBoundary = bindLegacyRentalAssistant(OriginalTaskProposalExecutionBoundary);
export const TaskActionResults = bindLegacyRentalAssistant(OriginalTaskActionResults);
export const TaskOrderMaterialDetails = bindLegacyRentalAssistant(OriginalTaskOrderMaterialDetails);
export const TaskOrderQuoteAmounts = bindLegacyRentalAssistant(OriginalTaskOrderQuoteAmounts);
export const TaskHumanReviewDetails = bindLegacyRentalAssistant(OriginalTaskHumanReviewDetails);
export const TaskHumanApproval = bindLegacyRentalAssistant(OriginalTaskHumanApproval);
