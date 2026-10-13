import type { AiUsageSettingsDraft, AiBudgetLimitDraft } from './ai-usage-draft';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafInt as int, leafList as list, leafText as text,
  type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

/** Explicit server registration only. These paths are not production switches. */
export const AI_BUDGET_MANAGEMENT_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/budget-settings', method: 'POST',
  read: 'read', change: 'change', initialize: 'initialize', refreshConfiguration: 'refresh-configuration', platformRead: 'platform/read', platformSave: 'platform/save'
});
export type AiBudgetSettingsReadDraft = { scope: 'tenant' | 'workspace'; sceneCode: string };
export type AiBudgetSettingsChangeDraft = AiBudgetSettingsReadDraft & {
  expectedRevision: number;
  /** Config, credentials, models and scene whitelist remain server-owned. */
  changes: { budget?: AiBudgetLimitDraft; maxConcurrent?: number; maxCallsPerRun?: number; enabled?: boolean };
};
export type AiPlatformBudgetSettingsReadDraft = { sceneCode: string };
export type AiBudgetSettingsInitializeDraft = AiBudgetSettingsReadDraft & {
  expectedRevision: 0; budget: AiBudgetLimitDraft; maxConcurrent: number; maxCallsPerRun: number; enabled: boolean;
};
/** Rebinds the server-selected current configuration, retaining limits and
 * historical reservations. The changed policy gate is saved disabled. */
export type AiBudgetSettingsRefreshConfigurationDraft = AiBudgetSettingsReadDraft & {
  expectedRevision: number; confirmCurrentConfiguration: true;
};
export type AiPlatformBudgetSettingsSaveDraft = AiPlatformBudgetSettingsReadDraft & {
  expectedRevision: number;
  settings: Pick<AiUsageSettingsDraft, 'gates' | 'allowedModels' | 'allowedScenes' | 'budget' | 'maxConcurrent' | 'maxCallsPerRun'>;
};
/** All failures are non-retry instructions. An uncertain settings write is read
 * by its same scope/scene key, never assumed rolled back or resubmitted. */
export type AiBudgetSettingsHttpFailureDraft = {
  code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_REVISION_CONFLICT' | 'AI_RESULT_UNKNOWN';
  retryable: false; nextAction?: 'read_same_policy';
};

const scene = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const selector = { scope: choice('tenant', 'workspace'), sceneCode: scene };
const settings = { gates: obj({ platform: ref('AiSettingGateDraft'), tenant: ref('AiSettingGateDraft'), scene: ref('AiSettingGateDraft') }),
  budget: ref('AiBudgetLimitDraft'), allowedScenes: list(scene, 100), maxConcurrent: int(0, 10000), maxCallsPerRun: int(0, 10000) };
const modelPolicy = { oneOf: [obj({ mode: choice('platform_managed'), serviceName: choice('Rental OS AI'), selection: choice('managed_by_platform') }),
  obj({ mode: choice('tenant_managed'), allowedModels: list(text(256), 100) })] };
const admission = choice('not_granted'), none = { type: 'null' };
export const AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiBudgetSettingsReadDraft: obj(selector),
  AiBudgetSettingsRefreshConfigurationDraft: obj({ ...selector, expectedRevision: int(1, 4294967294),
    confirmCurrentConfiguration: { type: 'boolean', const: true } }),
  AiBudgetSettingsInitializeDraft: obj({ ...selector, expectedRevision: { type: 'integer', const: 0 }, budget: ref('AiBudgetLimitDraft'),
    maxConcurrent: int(0, 10000), maxCallsPerRun: int(0, 10000), enabled: { type: 'boolean' } }),
  AiBudgetSettingsChangeDraft: obj({ ...selector, expectedRevision: int(0, 4294967294), changes: {
    ...obj({ budget: ref('AiBudgetLimitDraft'), maxConcurrent: int(0, 10000), maxCallsPerRun: int(0, 10000), enabled: { type: 'boolean' } }, []), minProperties: 1 } }),
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
    retryable: { type: 'boolean', const: false }, nextAction: choice('read_same_policy') }, ['code', 'retryable'])
};
