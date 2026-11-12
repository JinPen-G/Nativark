/** Bounded original configuration/test metadata, independently authorized from
 * Core readiness. No settings, URLs, credentials, error text or new probe. */
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import type { AiWorkspaceScope } from './ai-native';

export type AiOpeningIntegrationState = 'not_loaded' | 'not_implemented' | 'missing_configuration' | 'configured_unverified'
  | 'mock' | 'failed' | 'historical_live_success' | 'current_live_success';
export interface AiOpeningIntegrationObservationDraft {
  tenantId: string; workspaceId: string; observedAt: string;
  items: { configId: string | null; capability: string; provider: string; registered: boolean; implemented: boolean;
    state: AiOpeningIntegrationState; enabled: boolean | null; isDefault: boolean | null; configurationUpdatedAt: string | null;
    requiredFields: string[]; missingFields: string[] | null; structuralConfigurationComplete: boolean | null;
    conditionalFieldsValid: boolean | null; credentialMaterialPresent: boolean | null;
    test: { status: 'not_tested' | 'passed' | 'failed' | 'unknown'; mode: 'none' | 'configuration' | 'live' | 'mock' | 'unknown';
      checkedAt: string | null; matchesCurrentConfiguration: boolean } | null }[];
  hasMore: boolean; nextAfter: string | null; limit: number;
  coverage: 'all_persisted_configuration_records' | 'configuration_window';
  credentialEvidence: 'stored_field_presence_only_not_decrypted';
}
export type AiOpeningIntegrationFactsDraft = { state: 'observed'; scope: AiWorkspaceScope; actorId: string; audience: 'operator';
  observation: AiOpeningIntegrationObservationDraft } | { state: 'unavailable';
  reason: 'current_integration_permission_required' | 'configuration_observation_unavailable'; observation: null };

const bool: AiLeafSchemaDraft = { type: 'boolean' };
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [schema, { type: 'null' }] });
const observation = object({ tenantId: id(), workspaceId: id(), observedAt: time,
  items: list(object({ configId: nullable(id()), capability: { ...id(), maxLength: 20 }, provider: { ...id(), maxLength: 40 },
    registered: bool, implemented: bool, state: choice('not_loaded', 'not_implemented', 'missing_configuration', 'configured_unverified',
      'mock', 'failed', 'historical_live_success', 'current_live_success'), enabled: nullable(bool), isDefault: nullable(bool),
    configurationUpdatedAt: nullable(time), requiredFields: list({ ...id(), maxLength: 64 }, 32),
    missingFields: nullable(list({ ...id(), maxLength: 64 }, 32)), structuralConfigurationComplete: nullable(bool),
    conditionalFieldsValid: nullable(bool), credentialMaterialPresent: nullable(bool),
    test: nullable(object({ status: choice('not_tested', 'passed', 'failed', 'unknown'), mode: choice('none', 'configuration', 'live', 'mock', 'unknown'),
      checkedAt: nullable(time), matchesCurrentConfiguration: bool })) }), 48), hasMore: bool, nextAfter: nullable(id()), limit: integer(1, 32),
  coverage: choice('all_persisted_configuration_records', 'configuration_window'),
  credentialEvidence: choice('stored_field_presence_only_not_decrypted') });
export const AI_OPENING_INTEGRATION_OBSERVATION_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiOpeningIntegrationFactsDraft: { oneOf: [
    object({ state: choice('observed'), scope: object({ kind: choice('workspace'), tenantId: id(), workspaceId: id() }),
      actorId: id(), audience: choice('operator'), observation }),
    object({ state: choice('unavailable'), reason: choice('current_integration_permission_required', 'configuration_observation_unavailable'),
      observation: { type: 'null' } })] },
};
