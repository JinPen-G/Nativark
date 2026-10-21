import type { AiUsageSettingsDraft, AiBudgetLimitDraft } from './ai-usage-draft';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafInt as int, leafList as list, leafText as text, leafTime as time,
  type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

/** Explicit server registration only. These paths are not production switches. */
export const AI_BUDGET_MANAGEMENT_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/budget-settings', method: 'POST',
  read: 'read', readOperation: 'operation', change: 'change', initialize: 'initialize', refreshConfiguration: 'refresh-configuration', platformRead: 'platform/read', platformSave: 'platform/save',
  priceRead: 'pricing/price', pricePublicationRead: 'pricing/publication', inputBoundRead: 'pricing/input-bound',
  reviewPrice: 'pricing/review', readPriceReview: 'pricing/review/receipt',
  platformReviewPrice: 'platform/pricing/review', platformPriceReviewReceipt: 'platform/pricing/review/receipt',
  previewPlatformPrice: 'pricing/platform/preview', adoptPlatformPrice: 'pricing/platform/adopt', readPlatformPriceAdoption: 'pricing/platform/receipt'
});
export type AiGatewayReviewedPriceBillingDraft = { unit: 'tokens'; metric: 'input_plus_output'; scale: 0; rounding: 'exact' }
  | { unit: 'money'; currency: string; scale: 6; inputPerMillion: string; outputPerMillion: string; rounding: 'ceil_total_micro_units';
    /** Explicit reviewed budget rates, never inferred supplier discounts. */
    inputCache?: { readPerMillion: string; writePerMillion: string } };
export type AiGatewayPriceReviewDraft = { sceneCode: string; operationKey: string; configId: string; expectedConfigRevision: number;
  priceVersion: string; validFrom: string; expiresAt: string; billing: AiGatewayReviewedPriceBillingDraft; confirmReviewedRate: true };
export type AiGatewayPriceReviewReadDraft = { sceneCode: string; operationKey: string };
export type AiGatewayPlatformPriceAdoptionReadDraft = { sceneCode: string; priceId: string };
export type AiGatewayPlatformPriceAdoptionDraft = AiGatewayPlatformPriceAdoptionReadDraft & { confirmPlatformRate: true };
/** Current tenant-authorized offer, not an adoption receipt or supplier fact. */
export type AiGatewayPlatformPricePreviewDraft = AiGatewayPlatformPriceAdoptionReadDraft & {
  state: 'available_for_review'; evidenceHash: string; priceVersion: string; validFrom: string; expiresAt: string;
  billing: AiGatewayReviewedPriceBillingDraft; rateAuthority: 'platform_reviewed_budget_rate_not_provider_invoice';
  inputCounting: 'not_certified_by_rate_review'; executionPermission: false; persisted: false;
};
export type AiGatewayPriceReviewResponseDraft = { state: 'recorded'; operationKey: string; id: string; evidenceHash: string;
  priceVersion: string; configurationHash: string; configId: string; configRevision: number; validFrom: string; expiresAt: string;
  billing: AiGatewayReviewedPriceBillingDraft; rateAuthority: 'tenant_reviewed_budget_rate_not_provider_invoice' | 'platform_reviewed_budget_rate_not_provider_invoice';
  inputCounting: 'not_certified_by_rate_review'; executionPermission: false };
export type AiGatewayPriceReadDraft = { configurationHash: string; priceVersion: string };
export type AiGatewayPricePublicationReadDraft = { reference: string };
export type AiGatewayInputBoundReadDraft = { callId: string };
/** Historical evidence only. No credential, current model selection, new
 * token certification, price publication or execution permission is returned. */
export type AiGatewayPriceSummaryDraft = {
  id: string; evidenceHash: string; priceVersion: string; configurationHash: string;
  validFrom: string; expiresAt: string; executionPermission: false;
  configurationMeaning: 'historical_reference_not_current_selection';
} & ({ unit: 'tokens'; scale: 0; currency: null; rounding: 'exact' }
  | { unit: 'money'; scale: 6; currency: string; rounding: 'ceil_total_micro_units' });
export type AiGatewayInputBoundSummaryDraft = {
  id: string; evidenceHash: string; inputFingerprint: string; maxInputTokens: number; maxOutputTokens: number;
  method: 'provider_count_tokens_receipt' | 'certified_tokenizer_bound'; validFrom: string; expiresAt: string;
  price: AiGatewayPriceSummaryDraft; executionPermission: false;
};
export type AiBudgetSettingsReadDraft = { scope: 'tenant' | 'workspace'; sceneCode: string };
export type AiBudgetSettingsOperationReadDraft = AiBudgetSettingsReadDraft & { operationKey: string };
/** Immutable original save only; unknown is not evidence of rollback. */
export type AiBudgetSettingsOperationReceiptDraft = AiBudgetSettingsOperationReadDraft & { admission: 'not_granted'; automaticRetry: false } & (
  | { state: 'unknown' }
  | { state: 'recorded'; action: 'change' | 'initialize' | 'refreshConfiguration'; expectedRevision: number;
      savedRevision: number; commandHash: string; recordedAt: string });
/** Existing management HTTP projection, never budget admission or a live
 * model selection. Matches AiBudgetSettingsSummaryDraft below. */
export type AiBudgetSettingsSummaryDraft = AiBudgetSettingsReadDraft & { admission: 'not_granted' } & (
  | { state: 'not_configured'; revision: null; settings: null; modelPolicy: null }
  | { state: 'configured'; revision: number;
      settings: Pick<AiUsageSettingsDraft, 'gates' | 'budget' | 'allowedScenes' | 'maxConcurrent' | 'maxCallsPerRun'>;
      modelPolicy: { mode: 'platform_managed'; serviceName: 'Rental OS AI'; selection: 'managed_by_platform' }
        | { mode: 'tenant_managed'; allowedModels: string[] };
      configurationMeaning: 'saved_policy_reference_not_current_selection' });
export type AiBudgetSettingsChangeResponseDraft = { savedRevision: number; policy: AiBudgetSettingsSummaryDraft;
  observation: 'same_revision' | 'changed_after_save' };
export type AiBudgetSettingsChangeDraft = AiBudgetSettingsReadDraft & {
  expectedRevision: number; operationKey?: string;
  /** Config, credentials, models and scene whitelist remain server-owned. */
  changes: { budget?: AiBudgetLimitDraft; maxConcurrent?: number; maxCallsPerRun?: number; enabled?: boolean };
};
export type AiPlatformBudgetSettingsReadDraft = { sceneCode: string };
export type AiBudgetSettingsInitializeDraft = AiBudgetSettingsReadDraft & {
  expectedRevision: 0; operationKey?: string; budget: AiBudgetLimitDraft; maxConcurrent: number; maxCallsPerRun: number; enabled: boolean;
};
/** Rebinds the server-selected current configuration, retaining limits and
 * historical reservations. The changed policy gate is saved disabled. */
export type AiBudgetSettingsRefreshConfigurationDraft = AiBudgetSettingsReadDraft & {
  expectedRevision: number; operationKey?: string; confirmCurrentConfiguration: true;
};
export type AiPlatformBudgetSettingsSaveDraft = AiPlatformBudgetSettingsReadDraft & {
  expectedRevision: number;
  settings: Pick<AiUsageSettingsDraft, 'gates' | 'allowedModels' | 'allowedScenes' | 'budget' | 'maxConcurrent' | 'maxCallsPerRun'>;
};
/** All failures are non-retry instructions. Keyed saves use the original
 * operation receipt; a current policy value is never proof of that save. */
export type AiBudgetSettingsHttpFailureDraft = {
  code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_REVISION_CONFLICT' | 'AI_RESULT_UNKNOWN';
  retryable: false; nextAction?: 'read_same_policy' | 'read_original_operation';
};

const scene = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const selector = { scope: choice('tenant', 'workspace'), sceneCode: scene };
const settings = { gates: obj({ platform: ref('AiSettingGateDraft'), tenant: ref('AiSettingGateDraft'), scene: ref('AiSettingGateDraft') }),
  budget: ref('AiBudgetLimitDraft'), allowedScenes: list(scene, 100), maxConcurrent: int(0, 10000), maxCallsPerRun: int(0, 10000) };
const modelPolicy = { oneOf: [obj({ mode: choice('platform_managed'), serviceName: choice('Rental OS AI'), selection: choice('managed_by_platform') }),
  obj({ mode: choice('tenant_managed'), allowedModels: list(text(256), 100) })] };
const admission = choice('not_granted'), none = { type: 'null' };
const pricingKey = { ...text(191), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const pricingHash = { ...text(64, 64), pattern: '^[a-f0-9]{64}$' };
const priceSummary = { id: pricingHash, evidenceHash: pricingHash, priceVersion: { ...pricingKey, maxLength: 64 },
  configurationHash: pricingHash, validFrom: time, expiresAt: time,
  executionPermission: { type: 'boolean', const: false }, configurationMeaning: choice('historical_reference_not_current_selection') };
const reviewedAmount = { type: 'string', pattern: '^(0|[1-9][0-9]{0,17})\\.[0-9]{6}$' };
const reviewedBilling: AiLeafSchemaDraft = { oneOf: [obj({ unit: choice('tokens'), metric: choice('input_plus_output'),
  scale: int(0, 0), rounding: choice('exact') }), obj({ unit: choice('money'), currency: { ...text(3, 3), pattern: '^[A-Z]{3}$' },
  scale: int(6, 6), inputPerMillion: reviewedAmount, outputPerMillion: reviewedAmount, rounding: choice('ceil_total_micro_units'),
  inputCache: obj({ readPerMillion: reviewedAmount, writePerMillion: reviewedAmount }) },
  ['unit', 'currency', 'scale', 'inputPerMillion', 'outputPerMillion', 'rounding'])] };
export const AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiGatewayPriceReviewDraft: obj({ sceneCode: scene, operationKey: { ...pricingKey, maxLength: 128 }, configId: text(36),
    expectedConfigRevision: int(1, 4294967295), priceVersion: { ...pricingKey, maxLength: 64 }, validFrom: time, expiresAt: time,
    billing: reviewedBilling, confirmReviewedRate: { type: 'boolean', const: true } }),
  AiGatewayPriceReviewReadDraft: obj({ sceneCode: scene, operationKey: { ...pricingKey, maxLength: 128 } }),
  AiGatewayPlatformPriceAdoptionReadDraft: obj({ sceneCode: scene, priceId: pricingHash }),
  AiGatewayPlatformPricePreviewDraft: obj({ sceneCode: scene, priceId: pricingHash, state: choice('available_for_review'),
    evidenceHash: pricingHash, priceVersion: { ...pricingKey, maxLength: 64 }, validFrom: time, expiresAt: time, billing: reviewedBilling,
    rateAuthority: choice('platform_reviewed_budget_rate_not_provider_invoice'), inputCounting: choice('not_certified_by_rate_review'),
    executionPermission: { type: 'boolean', const: false }, persisted: { type: 'boolean', const: false } }),
  AiGatewayPlatformPriceAdoptionDraft: obj({ sceneCode: scene, priceId: pricingHash, confirmPlatformRate: { type: 'boolean', const: true } }),
  AiGatewayPriceReviewResponseDraft: obj({ state: choice('recorded'), operationKey: { ...pricingKey, maxLength: 128 },
    id: pricingHash, evidenceHash: pricingHash, priceVersion: { ...pricingKey, maxLength: 64 }, configurationHash: pricingHash,
    configId: text(36), configRevision: int(1, 4294967295), validFrom: time, expiresAt: time, billing: reviewedBilling,
    rateAuthority: choice('tenant_reviewed_budget_rate_not_provider_invoice', 'platform_reviewed_budget_rate_not_provider_invoice'), inputCounting: choice('not_certified_by_rate_review'),
    executionPermission: { type: 'boolean', const: false } }),
  AiGatewayPriceReadDraft: obj({ configurationHash: pricingHash, priceVersion: { ...pricingKey, maxLength: 64 } }),
  AiGatewayPricePublicationReadDraft: obj({ reference: pricingKey }),
  AiGatewayInputBoundReadDraft: obj({ callId: { ...pricingKey, maxLength: 128 } }),
  AiGatewayPriceSummaryDraft: { oneOf: [
    obj({ ...priceSummary, unit: choice('tokens'), scale: int(0, 0), currency: none, rounding: choice('exact') }),
    obj({ ...priceSummary, unit: choice('money'), scale: int(6, 6), currency: { ...text(3, 3), pattern: '^[A-Z]{3}$' },
      rounding: choice('ceil_total_micro_units') })] },
  AiGatewayInputBoundSummaryDraft: obj({ id: pricingHash, evidenceHash: pricingHash, inputFingerprint: pricingHash,
    maxInputTokens: int(0, Number.MAX_SAFE_INTEGER), maxOutputTokens: int(1, 32768),
    method: choice('provider_count_tokens_receipt', 'certified_tokenizer_bound'), validFrom: time, expiresAt: time,
    price: ref('AiGatewayPriceSummaryDraft'), executionPermission: { type: 'boolean', const: false } }),
  AiBudgetSettingsReadDraft: obj(selector),
  AiBudgetSettingsOperationReadDraft: obj({ ...selector, operationKey: { ...pricingKey, maxLength: 128 } }),
  AiBudgetSettingsOperationReceiptDraft: { oneOf: [
    obj({ ...selector, operationKey: { ...pricingKey, maxLength: 128 }, admission, automaticRetry: { type: 'boolean', const: false }, state: choice('unknown') }),
    obj({ ...selector, operationKey: { ...pricingKey, maxLength: 128 }, admission, automaticRetry: { type: 'boolean', const: false }, state: choice('recorded'),
      action: choice('change', 'initialize', 'refreshConfiguration'), expectedRevision: int(0, 4294967294),
      savedRevision: int(1, 4294967295), commandHash: pricingHash, recordedAt: time })] },
  AiBudgetSettingsRefreshConfigurationDraft: obj({ ...selector, operationKey: { ...pricingKey, maxLength: 128 }, expectedRevision: int(1, 4294967294),
    confirmCurrentConfiguration: { type: 'boolean', const: true } }, ['scope', 'sceneCode', 'expectedRevision', 'confirmCurrentConfiguration']),
  AiBudgetSettingsInitializeDraft: obj({ ...selector, operationKey: { ...pricingKey, maxLength: 128 }, expectedRevision: { type: 'integer', const: 0 }, budget: ref('AiBudgetLimitDraft'),
    maxConcurrent: int(0, 10000), maxCallsPerRun: int(0, 10000), enabled: { type: 'boolean' } }, ['scope', 'sceneCode', 'expectedRevision', 'budget', 'maxConcurrent', 'maxCallsPerRun', 'enabled']),
  AiBudgetSettingsChangeDraft: obj({ ...selector, operationKey: { ...pricingKey, maxLength: 128 }, expectedRevision: int(0, 4294967294), changes: {
    ...obj({ budget: ref('AiBudgetLimitDraft'), maxConcurrent: int(0, 10000), maxCallsPerRun: int(0, 10000), enabled: { type: 'boolean' } }, []), minProperties: 1 } }, ['scope', 'sceneCode', 'expectedRevision', 'changes']),
  AiPlatformBudgetSettingsReadDraft: obj({ sceneCode: scene }),
  AiPlatformBudgetSettingsSaveDraft: obj({ sceneCode: scene, expectedRevision: int(0, 4294967294),
    settings: obj({ ...settings, allowedModels: list(text(256), 100) }) }),
  AiBudgetSettingsSummaryDraft: { oneOf: [
    obj({ ...selector, state: choice('not_configured'), revision: none, settings: none, modelPolicy: none, admission }),
    obj({ ...selector, state: choice('configured'), revision: int(1, 4294967295), settings: obj(settings), modelPolicy,
      configurationMeaning: choice('saved_policy_reference_not_current_selection'), admission })] },
  AiPlatformBudgetSettingsSummaryDraft: { oneOf: [
    obj({ scope: choice('platform'), sceneCode: scene, state: choice('not_configured'), revision: none, settings: none, admission }),
    obj({ scope: choice('platform'), sceneCode: scene, state: choice('configured'), revision: int(1, 4294967295),
      settings: obj({ ...settings, allowedModels: list(text(256), 100) }), admission })] },
  AiBudgetSettingsChangeResponseDraft: obj({ savedRevision: int(1, 4294967295), policy: ref('AiBudgetSettingsSummaryDraft'),
    observation: choice('same_revision', 'changed_after_save') }),
  AiBudgetSettingsHttpFailureDraft: obj({ code: choice('AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT', 'AI_RESULT_UNKNOWN'),
    retryable: { type: 'boolean', const: false }, nextAction: choice('read_same_policy', 'read_original_operation') }, ['code', 'retryable'])
};
