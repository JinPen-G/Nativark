/** Original financial wire contracts and the explicit SaaS management subset. */
import { AI_BUDGET_MANAGEMENT_HTTP_DRAFT as budget } from './ai-budget-management-http-draft';
import { AI_CREDIT_HTTP as credit } from './ai-credit';

export * from './ai-budget-management-http-draft';
export * from './ai-credit';
export * from './ai-credit-http';

/** Keys are internal action names. Paths and bodies retain the original wire. */
export const AI_PLATFORM_FINANCE_ROUTES = Object.freeze({
  budgetRead: [budget.basePath, budget.platformRead, false, 'AiPlatformBudgetSettingsReadDraft', 'AiPlatformBudgetSettingsSummaryDraft', 'manageAiBudgetSettings_platformRead'],
  budgetSave: [budget.basePath, budget.platformSave, true, 'AiPlatformBudgetSettingsSaveDraft', 'AiPlatformBudgetSettingsSummaryDraft', 'manageAiBudgetSettings_platformSave'],
  budgetReceipt: [budget.basePath, budget.platformReadOperation, false, 'AiPlatformBudgetSettingsOperationReadDraft', 'AiPlatformBudgetSettingsOperationReceiptDraft', 'manageAiBudgetSettings_platformReadOperation'],
  priceReview: [budget.basePath, budget.platformReviewPrice, true, 'AiGatewayPriceReviewDraft', 'AiGatewayPriceReviewResponseDraft', 'manageAiBudgetSettings_platformReviewPrice'],
  priceReceipt: [budget.basePath, budget.platformPriceReviewReceipt, false, 'AiGatewayPriceReviewReadDraft', 'AiGatewayPriceReviewResponseDraft', 'manageAiBudgetSettings_platformPriceReviewReceipt'],
  creditRead: [credit.basePath, credit.platformRead, false, 'AiCreditPlatformRead', 'AiCreditPlatformQueue', 'aiCredit_platform_read'],
  creditDecide: [credit.basePath, credit.platformDecide, true, 'AiCreditDecision', 'AiCreditRequest', 'aiCredit_platform_decide'],
  creditReceipt: [credit.basePath, credit.platformReceipt, false, 'AiCreditRequestRead', 'AiCreditDecisionReceipt', 'aiCredit_platform_receipt']
} as const);

export type AiPlatformFinanceAction = keyof typeof AI_PLATFORM_FINANCE_ROUTES;
