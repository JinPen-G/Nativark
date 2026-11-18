/** 原入口目录的只读投影。surface 由服务端装配，身份与所有可用性来源每次重读；
 * 外部请求不能提供 audience、权限、scope、能力或发布配置。目录不签发 Action，
 * 不创建 Task、报价、草稿、账或审批，原入口仍须独立复核对象及办理效果。 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { aiClientHostCapabilitiesSchema, AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE,
  AI_AUTOMATION_POLICY_HTTP_SCHEMAS, AI_EVENTS_DRAFT_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS,
  isAiEntrySceneCatalogResponse,
  type AiAutomationPolicyCurrentDraft, type AiExecutionContext, type AiExecutionScope } from '@rental-os/shared';
import { hasEffectivePermission } from '../../../common/permission-match';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { readRuntimePublication, type RuntimePublication } from '../runtime-publication.configuration';
import { ENTRY_SCENE_CATALOG, ENTRY_SCENE_CATALOG_VERSION, ENTRY_SCENE_SURFACES,
  type EntrySceneDefinition, type EntrySceneSurface } from './entry-scene-catalog';
import { categoryModelConfigurationSchema } from '../category-assist/category-model-host.composition';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revisionId = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), date = z.string().datetime({ offset: true });
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const changed = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
export const entrySceneCatalogQuery = z.object({ after: id.optional(), limit: z.number().int().min(1).max(20).default(20) }).strict();
export type EntryCatalogCurrent = { context: AiExecutionContext; scopeId: string;
  customer?: { customerId: string; customerType: 'personal' | 'corporate'; sessionId: string;
    membership: 'active'; enterpriseRelation: 'not_required' | 'current_owned_relation' | 'unavailable' } };
export const entryCatalogIdentityHash = (current: EntryCatalogCurrent) => {
  const { requestId: _request, authorizedAt: _at, ...context } = current.context;
  return requestFingerprint({ context, scopeId: current.scopeId, customer: current.customer ?? null });
};
// Reuse the formal policy and its original reference schemas. No private policy
// shape or deep shared import may replace the public runtime contract.
const policyAjv = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(policyAjv);
for (const [name, schema] of Object.entries({ ...AI_AUTOMATION_POLICY_HTTP_SCHEMAS,
  ...AI_EVENTS_DRAFT_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS })) policyAjv.addSchema(schema, `#/components/schemas/${name}`);
const policyValidator = policyAjv.getSchema<AiAutomationPolicyCurrentDraft>('#/components/schemas/AiAutomationPolicyCurrentDraft')!;
export const entryCatalogOriginalSourceSchema = z.object({ entryId: id, identityHash: hash, surface: z.enum(ENTRY_SCENE_SURFACES),
  producer: z.enum(['original_scene_host', 'original_client_host', 'original_inspection_host', 'original_platform_host',
    'original_settings_host', 'original_rule_host', 'original_calendar_host', 'original_event_host', 'original_automation_host']),
  reference: id, revision: revisionId, observedAt: date, expiresAt: date,
  implementation: z.enum(['implemented', 'preview_only', 'unavailable']), authority: z.enum(['allowed', 'denied', 'unavailable']),
  tools: z.array(z.object({ code: id, version: id }).strict()).max(32),
  manualExit: z.object({ key: id, state: z.enum(['available', 'unavailable']) }).strict(),
  plan: z.object({ scopeId: id, sceneCode: id, sceneVersion: id, enabled: z.boolean(), revision: z.number().int().min(1).max(4294967294),
    expiresAt: date, allowedTools: z.array(z.object({ code: id, version: id }).strict()).max(32) }).strict().optional(),
  entitlement: z.object({ featureCode: id, state: z.enum(['available', 'unavailable']), reference: id, revision: revisionId }).strict().optional(),
  capability: z.object({ kind: z.enum(['text', 'image', 'audio']), state: z.enum(['verified', 'unavailable']), reference: id, revision: revisionId }).strict().optional(),
  clientHost: aiClientHostCapabilitiesSchema.optional(),
  originalStage: z.object({ entryId: id, scopeId: id, state: z.enum(['available', 'unavailable']),
    reference: id, revision: revisionId, expiresAt: date }).strict().optional(),
  automationPolicy: z.custom<AiAutomationPolicyCurrentDraft>(value => policyValidator(value) === true).optional(),
}).strict();
export type EntryCatalogOriginalSource = z.infer<typeof entryCatalogOriginalSourceSchema>;
export interface EntrySceneCatalogReadPorts {
  /** Fixed by the original request factory, never chosen by query/body/URL. */
  readonly surface: EntrySceneSurface;
  /** Original Auth/Guard/ALS identity plus existing canonical scope. For clients,
   * add the current original Client Guard membership/session projection. */
  current(signal?: AbortSignal): Promise<EntryCatalogCurrent>;
  /** Existing readRuntimePublication(ConfigService), no new catalog config. */
  publication(): RuntimePublication | Promise<RuntimePublication>;
  /** Original producer reads only metadata/policies/capability receipts. It
   * must not generate/prepare a model, create a Task, load a business body or
   * substitute a constant success. Missing assembly returns null. Source is
   * bound to the current identity hash, exact entry and request surface. */
  original(entry: Readonly<EntrySceneDefinition>, current: Readonly<EntryCatalogCurrent>, signal?: AbortSignal): Promise<EntryCatalogOriginalSource | null>;
  clock?(): Date;
}
export type EntryCatalogAvailability = { state: 'available' | 'manual_only' | 'unavailable';
  reason: 'current_original_entry' | 'original_manual_entry' | 'deployment_disabled' | 'permission_missing'
    | 'source_unavailable' | 'policy_unavailable' | 'capability_unavailable' | 'subscription_unavailable';
  source: { kind: EntryCatalogOriginalSource['producer']; reference: string; revision: string; observedAt: string; expiresAt: string;
    implementation: EntryCatalogOriginalSource['implementation'] } | null;
  admission: 'observation_only_recheck_original_entry'; automaticExecution: false };
export type EntryCatalogProjection = { contractVersion: typeof ENTRY_SCENE_CATALOG_VERSION;
  surface: EntrySceneSurface; audience: EntrySceneDefinition['audience']; scope: AiExecutionScope;
  observedAt: string; expiresAt: string; publicationRevision: string | null;
  entries: Array<EntrySceneDefinition & { availability: EntryCatalogAvailability }>;
  nextAfter: string | null; coverage: 'bounded_current_scene_page'; execution: 'not_attempted'; authorization: 'directory_not_action_or_task_authority' };

function audience(current: EntryCatalogCurrent, surface: EntrySceneSurface): EntrySceneDefinition['audience'] {
  const context = current.context;
  if (surface === 'tenant_admin' && context.audience === 'operator' && context.actor.kind === 'saas_admin' && context.scope.kind === 'platform') return 'platform';
  if (surface === 'tenant_admin' && context.audience === 'operator' && context.actor.kind === 'user' && context.scope.kind === 'workspace') return 'operations';
  if (surface === 'staff_miniprogram' && context.audience === 'staff' && context.actor.kind === 'user' && context.scope.kind === 'workspace') return 'staff';
  if ((surface === 'client_miniprogram' || surface === 'tenant_website') && context.audience === 'client'
    && context.actor.kind === 'customer' && context.scope.kind === 'workspace' && current.customer?.customerId === context.actor.customerId
    && current.customer.membership === 'active' && id.safeParse(current.customer.sessionId).success
    && (current.customer.customerType === 'personal' && current.customer.enterpriseRelation === 'not_required'
      || current.customer.customerType === 'corporate' && current.customer.enterpriseRelation === 'current_owned_relation')) return 'customer';
  throw denied();
}
function parsePublication(raw: RuntimePublication): RuntimePublication {
  if (raw.state === 'unconfigured') {
    if (raw.revision !== null || !raw.configurations || Object.keys(raw.configurations).length) throw unavailable();
    return readRuntimePublication({ get: () => undefined });
  }
  if (raw.state !== 'configured') throw unavailable();
  return readRuntimePublication({ get: () => ({ version: 'ain-runtime-publication-1', revision: raw.revision, configurations: raw.configurations }) });
}
function configured(entry: EntrySceneDefinition, publication: RuntimePublication) {
  if (!entry.disable.configurationSections.length) return false;
  if (publication.state !== 'configured') return false;
  return entry.disable.configurationSections.every(section => {
    const value = publication.configurations[section];
    return value?.[entry.disable.configurationFlag] === true && (section !== 'staffRecognition' || entry.policy.modelCapability === 'image' && !!value.image
      || entry.policy.modelCapability === 'audio' && !!value.audio);
  });
}
function projectAvailability(entry: EntrySceneDefinition, current: EntryCatalogCurrent, publication: RuntimePublication,
  source: EntryCatalogOriginalSource | null, now: Date): EntryCatalogAvailability {
  const base = { admission: 'observation_only_recheck_original_entry' as const, automaticExecution: false as const,
    source: source?.authority === 'allowed' ? { kind: source.producer, reference: source.reference, revision: source.revision,
      observedAt: source.observedAt, expiresAt: source.expiresAt, implementation: source.implementation } : null };
  const manual = source?.authority === 'allowed' && source.manualExit.key === entry.manualExit && source.manualExit.state === 'available';
  const close = (reason: EntryCatalogAvailability['reason']): EntryCatalogAvailability => ({ ...base,
    state: manual ? 'manual_only' : 'unavailable', reason });
  const permissions = 'access' in current.context ? current.context.access.permissions : 'permissions' in current.context ? current.context.permissions : [];
  const permitted = entry.permissionMode === 'any' ? entry.requiredPermissions.some(permission => hasEffectivePermission(permissions, permission))
    : entry.requiredPermissions.every(permission => hasEffectivePermission(permissions, permission));
  if (!permitted) return { ...base, source: null, state: 'unavailable', reason: 'permission_missing' };
  if (!source || source.authority !== 'allowed' || source.implementation === 'unavailable') return close('source_unavailable');
  if (entry.disable.configurationSections.length && !configured(entry, publication)) return close('deployment_disabled');
  if (source.implementation !== 'implemented') return close('source_unavailable');
  // A complete static declaration can describe later stages. Availability is
  // the original entry's metadata observation, not a grant for every successor.
  const model = entry.policy.modelCapability;
  const modelTools: readonly string[] = [AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE];
  const requiredTools = entry.policy.modelCapability ? entry.tools.filter(tool => modelTools.includes(tool.code))
    : entry.policy.source === 'original_task_plan' ? entry.tools : entry.tools.filter(tool => tool.effect === 'read');
  if (requiredTools.some(tool => !source.tools.some(actual => actual.code === tool.code && actual.version === tool.version))) return close('source_unavailable');
  if (entry.policy.source === 'original_client_host') {
    const host = source.clientHost, customer = current.customer;
    if (!host || !customer || current.context.scope.kind !== 'workspace' || host.surface !== source.surface
      || host.customerId !== customer.customerId || host.customerType !== customer.customerType
      || host.scope.tenantId !== current.context.scope.tenantId || host.scope.workspaceId !== current.context.scope.workspaceId
      || Date.parse(host.observedAt) > now.getTime() || now.getTime() - Date.parse(host.observedAt) > 120000
      || Date.parse(host.expiresAt) <= now.getTime()) return close('policy_unavailable');
    if (entry.actions.some(action => !host.capabilities.entryActions.includes(action as never))
      || !host.enabled || !host.policy.allowRead || model && !host.policy.allowCreate) return close('policy_unavailable');
  } else if (entry.policy.source === 'original_task_plan') {
    const plan = source.plan;
    if (!plan || !plan.enabled || plan.scopeId !== current.scopeId || plan.sceneCode !== entry.sceneCode
      || plan.sceneVersion !== entry.sceneVersion || Date.parse(plan.expiresAt) <= now.getTime()
      || requiredTools.some(tool => !plan.allowedTools.some(actual => actual.code === tool.code && actual.version === tool.version))) return close('policy_unavailable');
    // PLATFORM is the existing operator/SaaS principal, never a tenant-wide
    // fourth credential audience. A specific original platform whitelist is required.
    if (entry.audience === 'platform' && plan.allowedTools.some(tool => !entry.tools.some(original => original.code === tool.code && original.version === tool.version))) return close('policy_unavailable');
  } else if (entry.policy.source === 'original_automation_policy') {
    const policy = source.automationPolicy, plan = source.plan;
    if (!policy || policy.state !== 'configured' || current.context.scope.kind !== 'workspace'
      || !policy.subject.enabled || policy.subject.revoked || policy.policy.revoked || policy.policy.mode === 'disabled'
      || !policy.subject.enabledBy || policy.subject.enabledAudience !== 'operator' || !policy.subject.enabledAt
      || !policy.policy.enabledBy || policy.policy.enabledAudience !== 'operator' || !policy.policy.enabledAt
      || Date.parse(policy.subject.expiresAt) <= now.getTime() || Date.parse(policy.policy.expiresAt) <= now.getTime()
      || policy.policy.subjectId !== policy.subject.id || Date.parse(policy.subject.enabledAt) > now.getTime()
      || Date.parse(policy.policy.enabledAt) > now.getTime() || Date.parse(policy.policy.validFrom) > now.getTime()
      || !policy.policy.constraints || policy.policy.constraints.allowedTools.length
      || policy.policy.constraints.allowedRecipientIds.length || policy.policy.constraints.limits.maxCausalDepth < 1
      || !plan || !plan.enabled || plan.scopeId !== current.scopeId || plan.sceneCode !== policy.policy.sceneCode
      || plan.sceneVersion !== policy.policy.sceneVersion || Date.parse(plan.expiresAt) <= now.getTime()
      // The original automatic explanation admits one model step and NO
      // business tools/recipients. A model code is not a business-tool grant.
      || plan.allowedTools.length !== 1 || plan.allowedTools[0].code !== AI_TEXT_MODEL_STEP_CODE
      || requiredTools.some(tool => !plan.allowedTools.some(actual => actual.code === tool.code && actual.version === tool.version))) return close('policy_unavailable');
  } else {
    // Manual/draft/settings and event reads use their original current host
    // capability, not a fabricated model plan or a static deployment Boolean.
    const stage = source.originalStage;
    if (!stage || stage.entryId !== entry.entryId || stage.scopeId !== current.scopeId
      || stage.state !== 'available' || Date.parse(stage.expiresAt) <= now.getTime()) return close('policy_unavailable');
  }
  if (entry.policy.featureCode && (!source.entitlement || source.entitlement.featureCode !== entry.policy.featureCode
    || source.entitlement.state !== 'available')) return close('subscription_unavailable');
  if (model && (!source.capability || source.capability.kind !== model || source.capability.state !== 'verified')) return close('capability_unavailable');
  return { ...base, state: 'available', reason: 'current_original_entry' };
}

/** Root wires the formal shared DTO/route and these original read ports. No
 * constructor read, maintenance timer or dispatch is performed by this leaf. */
export function createEntrySceneCatalogApplication(ports: EntrySceneCatalogReadPorts) {
  if (!ENTRY_SCENE_SURFACES.includes(ports.surface) || ![ports.current, ports.publication, ports.original].every(value => typeof value === 'function')) throw unavailable();
  const surface = ports.surface;
  const clock = () => { const now = ports.clock?.() ?? new Date(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable(); return now; };
  const current = async (signal?: AbortSignal) => {
    if (signal?.aborted) throw denied();
    const value = structuredClone(await ports.current(signal)), now = clock();
    if (!value || !isAiStepExecutionContext(value.context) || !id.safeParse(value.scopeId).success
      || Date.parse(value.context.authorizedAt) > now.getTime() || now.getTime() - Date.parse(value.context.authorizedAt) > 120000) throw denied();
    const selectedAudience = audience(value, surface);
    if (signal?.aborted) throw denied();
    return { value, selectedAudience, identityHash: entryCatalogIdentityHash(value) };
  };
  return Object.freeze({ async read(value: unknown = {}, signal?: AbortSignal): Promise<EntryCatalogProjection> {
    const command = entrySceneCatalogQuery.safeParse(structuredClone(value));
    if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = await current(signal), publication = parsePublication(structuredClone(await ports.publication()));
    const all = ENTRY_SCENE_CATALOG.filter(entry => entry.audience === before.selectedAudience && entry.surfaces.includes(surface))
      .map(entry => {
        if (entry.entryId !== 'platform.category_propose') return entry;
        // The category host selects its plan by the current server version.
        // Keep the same captured publication for metadata, source lookup and
        // the final publication recheck; an old v1 plan cannot authorize v2.
        const configured = categoryModelConfigurationSchema.safeParse(publication.configurations.categoryProposal);
        return configured.success ? { ...entry, sceneVersion: configured.data.sceneVersion } : entry;
      })
      .slice().sort((left, right) => left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0);
    if (command.data.after && !all.some(entry => entry.entryId === command.data.after)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const candidates = all.filter(entry => !command.data.after || entry.entryId > command.data.after).slice(0, command.data.limit + 1);
    const entries: EntryCatalogProjection['entries'] = [], observedAt = clock();
    const sources: Array<{ entry: EntrySceneDefinition; source: EntryCatalogOriginalSource | null }> = [];
    let expiresAt = observedAt.getTime() + 30000;
    for (const entry of candidates.slice(0, command.data.limit)) {
      const original = await ports.original(entry, structuredClone(before.value), signal);
      const after = await current(signal);
      if (after.identityHash !== before.identityHash || after.selectedAudience !== before.selectedAudience) throw changed();
      const parsed = original === null ? null : entryCatalogOriginalSourceSchema.safeParse(structuredClone(original));
      if (parsed && !parsed.success) throw unavailable();
      const source = parsed?.success ? parsed.data : null, now = clock();
      if (source && (source.entryId !== entry.entryId || source.identityHash !== before.identityHash || source.surface !== surface
        || source.producer !== entry.source.kind || Date.parse(source.observedAt) > now.getTime()
        || Date.parse(source.expiresAt) <= now.getTime() || Date.parse(source.expiresAt) <= Date.parse(source.observedAt)
        || now.getTime() - Date.parse(source.observedAt) > 120000)) throw unavailable();
      if (source && (source.manualExit.key !== entry.manualExit
        || new Set(source.tools.map(tool => `${tool.code}:${tool.version}`)).size !== source.tools.length
        || source.tools.some(tool => !entry.tools.some(original => original.code === tool.code && original.version === tool.version)))) throw unavailable();
      const availability = projectAvailability(entry, before.value, publication, source, now);
      if (source) expiresAt = Math.min(expiresAt, Date.parse(source.expiresAt));
      if (availability.state === 'available') expiresAt = Math.min(expiresAt, source?.plan ? Date.parse(source.plan.expiresAt) : Infinity,
        source?.clientHost ? Date.parse(source.clientHost.expiresAt) : Infinity, source?.originalStage ? Date.parse(source.originalStage.expiresAt) : Infinity,
        source?.automationPolicy ? Math.min(Date.parse(source.automationPolicy.subject.expiresAt), Date.parse(source.automationPolicy.policy.expiresAt)) : Infinity);
      entries.push({ ...structuredClone(entry), availability });
      sources.push({ entry, source });
    }
    // Reopen original metadata after other entries have awaited their readers.
    // Observation timestamps may advance; current identity, policy, capability,
    // publisher/source revisions and enabled state must remain the same.
    for (const { entry, source } of sources) {
      const raw = await ports.original(entry, structuredClone(before.value), signal), after = await current(signal);
      if (after.identityHash !== before.identityHash || after.selectedAudience !== before.selectedAudience) throw changed();
      const parsed = raw === null ? null : entryCatalogOriginalSourceSchema.safeParse(structuredClone(raw));
      if (parsed && !parsed.success) throw unavailable();
      const next = parsed?.success ? parsed.data : null;
      const stable = (value: EntryCatalogOriginalSource | null) => {
        if (!value) return null;
        const { observedAt: _observedAt, expiresAt: _expiresAt, clientHost, originalStage, ...rest } = value;
        const host = clientHost && (({ observedAt: _hostAt, expiresAt: _hostExpiry, ...stableHost }) => stableHost)(clientHost);
        // This is a new bounded metadata observation, not the original action
        // policy's validity window. Both observations' expiries are checked
        // below and the earlier one still bounds the delivered page.
        const stage = originalStage && (({ expiresAt: _stageExpiry, ...stableStage }) => stableStage)(originalStage);
        return { ...rest, ...(host ? { clientHost: host } : {}), ...(stage ? { originalStage: stage } : {}) };
      };
      if (requestFingerprint(stable(source)) !== requestFingerprint(stable(next))) throw unavailable();
      const now = clock(), previousAvailability = entries.find(row => row.entryId === entry.entryId)!.availability;
      if (next && (Date.parse(next.expiresAt) <= now.getTime() || Date.parse(next.observedAt) > now.getTime()
        || Date.parse(next.expiresAt) <= Date.parse(next.observedAt)
        || now.getTime() - Date.parse(next.observedAt) > 120000)) throw unavailable();
      const nextAvailability = projectAvailability(entry, after.value, publication, next, now);
      if (nextAvailability.state !== previousAvailability.state || nextAvailability.reason !== previousAvailability.reason) throw unavailable();
      if (next) expiresAt = Math.min(expiresAt, Date.parse(next.expiresAt));
      if (nextAvailability.state === 'available') expiresAt = Math.min(expiresAt,
        next?.plan ? Date.parse(next.plan.expiresAt) : Infinity, next?.clientHost ? Date.parse(next.clientHost.expiresAt) : Infinity,
        next?.originalStage ? Date.parse(next.originalStage.expiresAt) : Infinity,
        next?.automationPolicy ? Math.min(Date.parse(next.automationPolicy.subject.expiresAt), Date.parse(next.automationPolicy.policy.expiresAt)) : Infinity);
    }
    const afterPublication = parsePublication(structuredClone(await ports.publication())), after = await current(signal);
    if (after.identityHash !== before.identityHash || after.selectedAudience !== before.selectedAudience) throw changed();
    if (requestFingerprint(afterPublication) !== requestFingerprint(publication) || expiresAt <= clock().getTime()) throw unavailable();
    const result: EntryCatalogProjection = { contractVersion: ENTRY_SCENE_CATALOG_VERSION, surface,
      audience: before.selectedAudience, scope: structuredClone(after.value.context.scope), observedAt: observedAt.toISOString(),
      expiresAt: new Date(expiresAt).toISOString(), publicationRevision: publication.revision, entries,
      nextAfter: candidates.length > command.data.limit ? entries[entries.length - 1].entryId : null,
      coverage: 'bounded_current_scene_page', execution: 'not_attempted', authorization: 'directory_not_action_or_task_authority' };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 131072 || !isAiEntrySceneCatalogResponse(result)) throw unavailable();
    return result;
  } });
}
