/** 多端原场景目录的公共只读合同。服务端绑定身份、scope和surface；
 * metadata及可用性观察不签发Action、不授Task／模型／Core执行权。
 * 场景内容仅由原服务端登记生产，客户端不得提交目录或来源作为授权。 */
import { AI_ENTRY_ACTION_REGISTRY, AI_ENTRY_AUDIENCE_MAP, type AiEntryActionCode } from './ai-entry-action-draft';
import type { AiExecutionScope, AiRisk } from './ai-native';
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafRef as ref, leafText as text, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import { validateAiLeafSchemaValue } from './ai-leaf-schema-validation';

export const AI_ENTRY_SCENE_CATALOG_VERSION = 'ain-entry-scene-catalog-1' as const;
export const AI_ENTRY_SCENE_CATALOG_SURFACES = ['tenant_admin', 'staff_miniprogram', 'client_miniprogram', 'tenant_website'] as const;
export type AiEntrySceneCatalogSurface = typeof AI_ENTRY_SCENE_CATALOG_SURFACES[number];
export type AiEntrySceneCatalogAudience = keyof typeof AI_ENTRY_AUDIENCE_MAP;
export const AI_ENTRY_SCENE_CATALOG_HTTP = Object.freeze({ method: 'POST', read: 'read',
  operatorBasePath: 'ai-native/scene-catalog', staffBasePath: 'staff/v1/ai-native/scene-catalog',
  websiteBasePath: 'client/v1/ai-native/scene-catalog', wechatBasePath: 'client/v1/ai-native/wechat-scene-catalog' } as const);
export type AiEntrySceneCatalogRequest = { after?: string; limit?: number };
type Confirmation = 'read_only' | 'explicit_prepare_or_save' | 'review_approval_and_original_submit' | 'original_human_submit';
type SourceKind = 'original_scene_host' | 'original_client_host' | 'original_inspection_host' | 'original_platform_host'
  | 'original_settings_host' | 'original_rule_host' | 'original_calendar_host' | 'original_event_host' | 'original_automation_host';
export interface AiEntrySceneCatalogEntry {
  entryId: string; sceneCode: string | null; sceneVersion: string; audience: AiEntrySceneCatalogAudience;
  runtimeAudience: 'operator' | 'staff' | 'client'; surfaces: readonly AiEntrySceneCatalogSurface[];
  title: string; goal: string; target: string;
  input: { contract: string; authority: 'explicit_user_input_rechecked_by_original_entry'; maxBytes: number };
  output: { contract: string; authority: 'authorized_original_facts_and_untrusted_candidates'; maxBytes: number; maxResults: number };
  tools: readonly { code: string; version: string; riskLevel: AiRisk; requiredPermissions: readonly string[];
    confirmation: Confirmation; effect: 'read' | 'ai_draft' | 'original_business_write' }[];
  actions: readonly AiEntryActionCode[]; requiredPermissions: readonly string[]; permissionMode: 'all' | 'any'; authorizationChecks: readonly string[];
  riskLevel: AiRisk; confirmation: Confirmation;
  policy: { source: string; featureCode: string | null; modelCapability: 'text' | 'image' | 'audio' | null };
  stage: 'read_and_explain' | 'prepare_ai_proposal' | 'review_original_change' | 'save_business_draft'
    | 'review_and_original_submit' | 'read_original_event' | 'review_original_policy';
  redaction: readonly string[]; queryTiming: 'reauthorize_before_and_after_each_read_and_at_original_action';
  source: { kind: SourceKind; version: 'current_original_producer'; businessFacts: 'original_core_or_formal_domain';
    history: 'original_bound_version_or_unavailable'; candidates: 'not_human_choice_or_business_authority' };
  maturity: 'requires_current_original_implementation'; manualExit: string; failures: readonly string[];
  disable: { defaultEnabled: false; configurationSections: readonly string[]; configurationFlag: 'enabled' | 'saveEnabled';
    scopes: readonly ['global', 'tenant_or_platform', 'scene'];
    originalReceipts: 'current_read_authority_only'; unknown: 'read_original_operation_never_redispatch' };
  retention: { policyVersion: string; ordinaryAiBodyDays: 30; businessRecords: 'original_business_policy';
    unresolved: 'hold_only_original_related_evidence'; cleanup: 'authorized_bounded_idempotent_original_retention';
    clientState: 'clear_on_identity_scope_hide_or_dispose' };
  availability: { state: 'available' | 'manual_only' | 'unavailable'; reason: 'current_original_entry' | 'original_manual_entry'
    | 'deployment_disabled' | 'permission_missing' | 'source_unavailable' | 'policy_unavailable' | 'capability_unavailable' | 'subscription_unavailable';
    source: { kind: SourceKind; reference: string; revision: string; observedAt: string; expiresAt: string;
      implementation: 'implemented' | 'preview_only' | 'unavailable' } | null;
    admission: 'observation_only_recheck_original_entry'; automaticExecution: false };
}
export interface AiEntrySceneCatalogResponse {
  contractVersion: typeof AI_ENTRY_SCENE_CATALOG_VERSION; surface: AiEntrySceneCatalogSurface;
  audience: AiEntrySceneCatalogAudience; scope: AiExecutionScope; observedAt: string; expiresAt: string;
  publicationRevision: string | null; entries: AiEntrySceneCatalogEntry[]; nextAfter: string | null;
  coverage: 'bounded_current_scene_page'; execution: 'not_attempted'; authorization: 'directory_not_action_or_task_authority';
}
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [schema, { type: 'null' }] });
const bool = (value: boolean): AiLeafSchemaDraft => ({ type: 'boolean', const: value });
const unique = (schema: AiLeafSchemaDraft, maxItems: number, minItems = 0): AiLeafSchemaDraft => ({ ...list(schema, maxItems, minItems), uniqueItems: true });
const confirmation = choice('read_only', 'explicit_prepare_or_save', 'review_approval_and_original_submit', 'original_human_submit');
const sourceKind = choice('original_scene_host', 'original_client_host', 'original_inspection_host', 'original_platform_host',
  'original_settings_host', 'original_rule_host', 'original_calendar_host', 'original_event_host', 'original_automation_host');
const risk = choice('R0', 'R1', 'R2', 'R3'), permissions = unique(id(), 64);
const observedSource = object({ kind: sourceKind, reference: id(), revision: text(191), observedAt: time,
  expiresAt: time, implementation: choice('implemented', 'preview_only', 'unavailable') });
const scope: AiLeafSchemaDraft = { oneOf: [object({ kind: choice('platform') }),
  object({ kind: choice('workspace'), tenantId: id(), workspaceId: id() })] };
const entry = object({ entryId: id(), sceneCode: nullable(id()), sceneVersion: id(),
  audience: choice('operations', 'staff', 'customer', 'platform'), runtimeAudience: choice('operator', 'staff', 'client'),
  surfaces: unique(choice(...AI_ENTRY_SCENE_CATALOG_SURFACES), 4, 1), title: text(128), goal: text(1000), target: id(),
  input: object({ contract: id(), authority: choice('explicit_user_input_rechecked_by_original_entry'), maxBytes: integer(1, 524288) }),
  output: object({ contract: id(), authority: choice('authorized_original_facts_and_untrusted_candidates'),
    maxBytes: integer(1, 524288), maxResults: integer(1, 1000) }),
  tools: list(object({ code: id(), version: id(), riskLevel: risk, requiredPermissions: permissions,
    confirmation, effect: choice('read', 'ai_draft', 'original_business_write') }), 32),
  actions: unique(choice(...Object.keys(AI_ENTRY_ACTION_REGISTRY)), 9), requiredPermissions: permissions,
  permissionMode: choice('all', 'any'), authorizationChecks: unique(id(), 32), riskLevel: risk, confirmation,
  policy: object({ source: id(), featureCode: nullable(id()), modelCapability: nullable(choice('text', 'image', 'audio')) }),
  stage: choice('read_and_explain', 'prepare_ai_proposal', 'review_original_change', 'save_business_draft',
    'review_and_original_submit', 'read_original_event', 'review_original_policy'),
  redaction: unique(id(), 32), queryTiming: choice('reauthorize_before_and_after_each_read_and_at_original_action'),
  source: object({ kind: sourceKind, version: choice('current_original_producer'), businessFacts: choice('original_core_or_formal_domain'),
    history: choice('original_bound_version_or_unavailable'), candidates: choice('not_human_choice_or_business_authority') }),
  maturity: choice('requires_current_original_implementation'), manualExit: id(), failures: unique(id(), 32),
  disable: object({ defaultEnabled: bool(false), configurationSections: unique(id(), 32),
    configurationFlag: choice('enabled', 'saveEnabled'),
    scopes: unique(choice('global', 'tenant_or_platform', 'scene'), 3, 3), originalReceipts: choice('current_read_authority_only'),
    unknown: choice('read_original_operation_never_redispatch') }),
  retention: object({ policyVersion: id(), ordinaryAiBodyDays: integer(30, 30), businessRecords: choice('original_business_policy'),
    unresolved: choice('hold_only_original_related_evidence'), cleanup: choice('authorized_bounded_idempotent_original_retention'),
    clientState: choice('clear_on_identity_scope_hide_or_dispose') }),
  availability: object({ state: choice('available', 'manual_only', 'unavailable'),
    reason: choice('current_original_entry', 'original_manual_entry', 'deployment_disabled', 'permission_missing',
      'source_unavailable', 'policy_unavailable', 'capability_unavailable', 'subscription_unavailable'), source: nullable(observedSource),
    admission: choice('observation_only_recheck_original_entry'), automaticExecution: bool(false) }) });
export const AI_ENTRY_SCENE_CATALOG_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiEntrySceneCatalogRequest: object({ after: id(), limit: integer(1, 20) }, []),
  AiEntrySceneCatalogEntry: entry,
  AiEntrySceneCatalogResponse: object({ contractVersion: choice(AI_ENTRY_SCENE_CATALOG_VERSION),
    surface: choice(...AI_ENTRY_SCENE_CATALOG_SURFACES), audience: choice('operations', 'staff', 'customer', 'platform'),
    scope, observedAt: time, expiresAt: time, publicationRevision: nullable(id()),
    entries: list(ref('AiEntrySceneCatalogEntry'), 20), nextAfter: nullable(id()), coverage: choice('bounded_current_scene_page'),
    execution: choice('not_attempted'), authorization: choice('directory_not_action_or_task_authority') }),
};
export const AI_ENTRY_SCENE_CATALOG_CONTRACTS = Object.freeze({ read: {
  request: 'AiEntrySceneCatalogRequest', response: 'AiEntrySceneCatalogResponse', write: false } } as const);
export function isAiEntrySceneCatalogRequest(value: unknown): value is AiEntrySceneCatalogRequest {
  return validateAiLeafSchemaValue(AI_ENTRY_SCENE_CATALOG_SCHEMAS.AiEntrySceneCatalogRequest, value, AI_ENTRY_SCENE_CATALOG_SCHEMAS);
}
export function isAiEntrySceneCatalogResponse(value: unknown): value is AiEntrySceneCatalogResponse {
  if (!validateAiLeafSchemaValue(AI_ENTRY_SCENE_CATALOG_SCHEMAS.AiEntrySceneCatalogResponse, value, AI_ENTRY_SCENE_CATALOG_SCHEMAS)) return false;
  const result = value as AiEntrySceneCatalogResponse;
  if ((result.audience === 'platform') !== (result.scope.kind === 'platform')
    || result.audience === 'customer' && !['client_miniprogram', 'tenant_website'].includes(result.surface)
    || result.audience === 'staff' && result.surface !== 'staff_miniprogram'
    || ['operations', 'platform'].includes(result.audience) && result.surface !== 'tenant_admin'
    || Date.parse(result.expiresAt) <= Date.parse(result.observedAt)
    || new Set(result.entries.map(row => row.entryId)).size !== result.entries.length
    || result.nextAfter !== null && result.nextAfter !== result.entries[result.entries.length - 1]?.entryId) return false;
  return result.entries.every(row => row.audience === result.audience && row.surfaces.includes(result.surface)
    && row.runtimeAudience === (row.audience === 'platform' ? 'operator' : AI_ENTRY_AUDIENCE_MAP[row.audience])
    && row.disable.scopes.join(':') === 'global:tenant_or_platform:scene'
    && new Set(row.tools.map(tool => tool.code)).size === row.tools.length
    && (row.availability.state === 'available' ? row.availability.reason === 'current_original_entry'
      && row.availability.source?.implementation === 'implemented' : row.availability.state !== 'manual_only'
        || row.availability.reason === 'original_manual_entry')
    && (row.availability.source === null || row.availability.source.kind === row.source.kind
      && Date.parse(row.availability.source.expiresAt) > Date.parse(row.availability.source.observedAt)
      && Date.parse(row.availability.source.expiresAt) >= Date.parse(result.expiresAt)));
}
