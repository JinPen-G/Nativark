/** The original tenant configuration routes and wire validators, shared by both hosts. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_MODEL_SETTINGS_HTTP_DRAFT, AI_USAGE_DRAFT_SCHEMAS, type AiTenantModelSettingsInputDraft,
  type AiTenantModelSettingsSummaryDraft } from '@rental-os/platform-contracts/ai-usage';
import { AI_PROVIDER_DISCOVERY_INPUT_SCHEMA, AI_PROVIDER_DISCOVERY_RESULT_SCHEMA,
  type AiProviderDiscoveryInputDraft } from '@rental-os/platform-contracts/ai-provider-discovery';
import { validModelConfigurationOperation } from '../runtime/model-configuration-operation';

export const TENANT_AI_MODEL_SETTINGS_PERMISSION = 'system:params:manage';
const empty = { type: 'object', properties: {}, additionalProperties: false } as const;
export const tenantModelSettingsOperations = {
  read: { operationId: 'readCurrentTenantModelSettings', write: false, request: empty, response: 'AiTenantModelSettingsSummaryDraft' },
  save: { operationId: 'saveCurrentTenantModelSettings', write: true, request: 'AiTenantModelSettingsInputDraft', response: 'AiTenantModelSettingsSummaryDraft' },
  operation: { operationId: 'readOriginalTenantModelConfigurationSave', write: false, request: 'AiModelConfigurationOperationReadDraft', response: 'AiModelConfigurationOperationDraft' },
  legacy: { operationId: 'reviewPreservedLegacyTenantModelSettings', write: false, request: empty, response: 'AiLegacyModelConfigurationDraft' },
  discoverModels: { operationId: 'discoverTenantProviderModels', write: false, request: AI_PROVIDER_DISCOVERY_INPUT_SCHEMA, response: AI_PROVIDER_DISCOVERY_RESULT_SCHEMA },
  detectProtocols: { operationId: 'identifyTenantProviderProtocolFamily', write: false, request: AI_PROVIDER_DISCOVERY_INPUT_SCHEMA, response: AI_PROVIDER_DISCOVERY_RESULT_SCHEMA }
} as const;
export type TenantModelSettingsAction = keyof typeof tenantModelSettingsOperations;
export const tenantModelSettingsPath = (action: TenantModelSettingsAction) =>
  `/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT[action]}`;

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
export const validTenantSettingsRead = ajv.compile(empty);
export const validTenantSettingsSave = ajv.compile<AiTenantModelSettingsInputDraft>(AI_USAGE_DRAFT_SCHEMAS.AiTenantModelSettingsInputDraft);
export const validTenantSettingsOperation = ajv.compile<{ operationKey: string }>(AI_USAGE_DRAFT_SCHEMAS.AiModelConfigurationOperationReadDraft);
export const validTenantSettingsSummary = ajv.compile<AiTenantModelSettingsSummaryDraft>(AI_USAGE_DRAFT_SCHEMAS.AiTenantModelSettingsSummaryDraft);
export const validTenantSettingsLegacy = ajv.compile(AI_USAGE_DRAFT_SCHEMAS.AiLegacyModelConfigurationDraft);
export const validTenantSettingsDiscovery = ajv.compile<AiProviderDiscoveryInputDraft>(AI_PROVIDER_DISCOVERY_INPUT_SCHEMA);
export const validTenantSettingsDiscoveryResult = ajv.compile(AI_PROVIDER_DISCOVERY_RESULT_SCHEMA);
export { validModelConfigurationOperation };
