/** Canonical authenticated management HTTP only. No probes, reservations,
 * execution grants or automatic write retries. */
import { AI_BUDGET_MANAGEMENT_HTTP_DRAFT as routes, type AiBudgetSettingsReadDraft,
  type AiBudgetSettingsChangeDraft, type AiBudgetSettingsInitializeDraft,
  type AiBudgetSettingsRefreshConfigurationDraft } from '@rental-os/platform-contracts/ai-finance';
import type { AiBudgetSettingsOperationReadDraft } from '@rental-os/platform-contracts/ai-finance';
import type { AiGatewayPriceReviewDraft, AiGatewayPriceReviewReadDraft, AiGatewayPriceConfigurationReadDraft } from '@rental-os/platform-contracts/ai-finance';
import type { AiGatewayPlatformPriceAdoptionDraft, AiGatewayPlatformPriceAdoptionReadDraft } from '@rental-os/platform-contracts/ai-finance';
import type { AiPlatformBudgetSettingsReadDraft, AiPlatformBudgetSettingsSaveDraft, AiPlatformBudgetSettingsOperationReadDraft } from '@rental-os/platform-contracts/ai-finance';
import type { AiAdminHost } from "../host";
import { createAiSettingsRequest } from "./request";

export function createAiBudgetSettingsApi(host: AiAdminHost) {
  const request = createAiSettingsRequest(host);
  const post = (action: keyof Omit<typeof routes, "basePath">, data: unknown, signal: AbortSignal) => {
    const platform = action.startsWith("platform");
    const permission = platform
      ? action === "platformSave" || action === "platformReviewPrice" ? "system:ai-provider:manage" : "system:ai-provider:view"
      : "system:params:manage";
    const write = ["platformSave", "platformReviewPrice", "reviewPrice", "adoptPlatformPrice", "change", "initialize", "refreshConfiguration"].includes(action);
    return request<unknown>(`/${routes.basePath}/${routes[action]}`,
      { audience: platform ? "platform" : "tenant", permission, workspace: !platform, write },
      { method: "post", data, signal, headers: { "Cache-Control": "no-store" } });
  };
  return Object.freeze({
  platformRead: (value: AiPlatformBudgetSettingsReadDraft, signal: AbortSignal) => post('platformRead', value, signal),
  platformSave: (value: AiPlatformBudgetSettingsSaveDraft, signal: AbortSignal) => post('platformSave', value, signal),
  platformReadOperation: (value: AiPlatformBudgetSettingsOperationReadDraft, signal: AbortSignal) => post('platformReadOperation', value, signal),
  readPriceConfiguration: (value: AiGatewayPriceConfigurationReadDraft, signal: AbortSignal) => post('readPriceConfiguration', value, signal),
  reviewPrice: (value: AiGatewayPriceReviewDraft, signal: AbortSignal) => post('reviewPrice', value, signal),
  readPriceReview: (value: AiGatewayPriceReviewReadDraft, signal: AbortSignal) => post('readPriceReview', value, signal),
  previewPlatformPrice: (value: AiGatewayPlatformPriceAdoptionReadDraft, signal: AbortSignal) => post('previewPlatformPrice', value, signal),
  adoptPlatformPrice: (value: AiGatewayPlatformPriceAdoptionDraft, signal: AbortSignal) => post('adoptPlatformPrice', value, signal),
  readPlatformPriceAdoption: (value: AiGatewayPlatformPriceAdoptionReadDraft, signal: AbortSignal) => post('readPlatformPriceAdoption', value, signal),
  platformReviewPrice: (value: AiGatewayPriceReviewDraft, signal: AbortSignal) => post('platformReviewPrice', value, signal),
  platformPriceReviewReceipt: (value: AiGatewayPriceReviewReadDraft, signal: AbortSignal) => post('platformPriceReviewReceipt', value, signal),
  readOperation: (value: AiBudgetSettingsOperationReadDraft, signal: AbortSignal) => post('readOperation', value, signal),
  read: (value: AiBudgetSettingsReadDraft, signal: AbortSignal) => post('read', value, signal),
  change: (value: AiBudgetSettingsChangeDraft, signal: AbortSignal) => post('change', value, signal),
  initialize: (value: AiBudgetSettingsInitializeDraft, signal: AbortSignal) => post('initialize', value, signal),
  refreshConfiguration: (value: AiBudgetSettingsRefreshConfigurationDraft, signal: AbortSignal) => post('refreshConfiguration', value, signal)
});

}
