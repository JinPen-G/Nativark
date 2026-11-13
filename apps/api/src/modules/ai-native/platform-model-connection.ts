import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { SECRET_BOX_ENVELOPE_PATTERN, type SecretBox } from '../../common/secret-box';
import type { AiScopeRepository } from './ai-scope.repository';
import type { AiProviderProfileRecord } from './provider-profile.ports';
import { ModelGatewayError, type GatewayContext } from './model-gateway.ports';
import type { GatewayConnectionResolver } from './routed-model-transport';
import { capabilityNameSchema, capabilityProfileFingerprint } from './capability-verification';
import { normalizeTenantModelBaseUrl } from './tenant-model-config.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { isAiStepExecutionContext } from './task-contract-validation';
import { AiModelConfigurationResultUnknownError, AiModelConfigurationRevisionConflictError } from './model-config-compatibility';
import { parseAiProviderProfileRecord } from './provider-profile.repository';
import { NATIVE_MODEL_PROTOCOLS, isNativeModelProtocol } from './native-model-protocols';
import { modelConfigurationOperationKey, readModelConfigurationOperation, appendModelConfigurationOperation,
  type ModelConfigurationOperationDb } from './model-configuration-operation';

const id = z.string().min(1).max(36).regex(/^[\w.:-]+$/u);
const revision = z.number().int().min(1).max(4294967295);
const saveSchema = z.object({
  profileId: id, expectedRevision: z.number().int().min(0).max(4294967294),
  operationKey: modelConfigurationOperationKey.optional(),
  protocol: z.enum(NATIVE_MODEL_PROTOCOLS), model: z.string().min(1).max(256).regex(/^[\w./:-]+$/u),
  baseUrl: z.string().min(1).max(2048), enabled: z.boolean(),
  maxOutputTokens: z.number().int().min(1).max(32768),
  allowedCapabilities: z.array(capabilityNameSchema).max(8).refine(items => new Set(items).size === items.length).optional(),
  secretChange: z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('retain') }).strict(),
    z.object({ operation: z.literal('replace'), apiKey: z.string().regex(/^[\x21-\x7e]{1,8192}$/u) }).strict(),
    z.object({ operation: z.literal('clear') }).strict()
  ])
}).strict();
const connectionSchema = z.object({ profileId: id, configRevision: revision,
  baseUrl: z.string().min(1).max(2048), maxOutputTokens: z.number().int().min(1).max(32768),
  credentialsEncrypted: z.string().max(65535).refine(value => value === '' || SECRET_BOX_ENVELOPE_PATTERN.test(value))
});
const select = { profileId: true, configRevision: true, baseUrl: true, maxOutputTokens: true,
  credentialsEncrypted: true } satisfies Prisma.AiPlatformModelConnectionSelect;
type Connection = z.infer<typeof connectionSchema>;
type Db = Pick<PrismaClient, '$transaction' | 'aiProviderProfile' | 'aiPlatformModelConnection'> & ModelConfigurationOperationDb;
type Scopes = Pick<AiScopeRepository, 'resolveRoutingScopes'>;

/** Fresh action-specific server authorization is mandatory. Scope lookup is NOT
 * permission, entitlement, budget admission or provider dispatch authority.
 */
export interface PlatformConnectionAuthority {
  manage(profileId: string): Promise<void>;
  /** Optional for older management-only hosts. Never reused for save. */
  read?(profileId: string): Promise<void>;
  invoke(context: GatewayContext): Promise<void>;
}

/** Persistent platform resolver for the existing RoutedModelTransport. No
 * tenant fallback, new provider dispatcher or automatic module activation.
 */
export class PrismaPlatformModelConnection implements GatewayConnectionResolver {
  constructor(private readonly db: Db, private readonly scopes: Scopes,
    private readonly authority: PlatformConnectionAuthority, private readonly secrets: SecretBox,
    private readonly readScopes?: Scopes) {
    if ([db?.$transaction, db?.aiProviderProfile?.findFirst, db?.aiPlatformModelConnection?.findUnique,
      scopes?.resolveRoutingScopes, authority?.manage, authority?.invoke, secrets?.encrypt, secrets?.decrypt]
      .some(method => typeof method !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
  }

  private reference(profileId: string, nextRevision: number) {
    return `platform-model:${createHash('sha256').update(profileId).digest('hex')}:${nextRevision}`;
  }
  private decrypt(row: Connection, profile: Pick<AiProviderProfileRecord, 'id' | 'scopeId' | 'protocol' | 'model' | 'configRevision'>) {
    try {
      const value = this.secrets.decrypt(row.credentialsEncrypted);
      if (row.profileId !== profile.id || row.configRevision !== profile.configRevision
        || value.profileId !== profile.id || value.scopeId !== profile.scopeId
        || value.revision !== String(profile.configRevision) || value.protocol !== profile.protocol
        || value.model !== profile.model || value.baseUrl !== row.baseUrl
        || !/^[\x21-\x7e]{1,8192}$/u.test(value.apiKey ?? '')) throw Error();
      return value.apiKey;
    } catch { throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE'); }
  }
  private async currentOwner(read = false) {
    try { return structuredClone(await (read && this.readScopes ? this.readScopes : this.scopes).resolveRoutingScopes('platform_managed')); }
    catch { throw new ModelGatewayError('FORBIDDEN'); }
  }
  private async management(profileId: string, read = false) {
    try {
      if (read && this.authority.read) await this.authority.read(profileId);
      else await this.authority.manage(profileId);
    } catch { throw new ModelGatewayError('FORBIDDEN'); }
    const resolved = await this.currentOwner(read);
    if (resolved.context.actor.kind !== 'saas_admin' || resolved.context.scope.kind !== 'platform'
      || resolved.configurationScope.kind !== 'PLATFORM') throw new ModelGatewayError('FORBIDDEN');
    const { authorizedAt: _, requestId: __, ...identity } = resolved.context;
    return { scopeId: resolved.configurationScope.id, actorId: resolved.context.actor.userId, binding: requestFingerprint(identity) };
  }

  async readOperation(profileId: string, operationKey: string) {
    if (!id.safeParse(profileId).success || !modelConfigurationOperationKey.safeParse(operationKey).success) throw new ModelGatewayError('INVALID_REQUEST');
    const before = await this.management(profileId, true);
    const result = await readModelConfigurationOperation(this.db, { scopeId: before.scopeId, scopeKind: 'PLATFORM',
      targetId: profileId, actorId: before.actorId, workspaceId: null }, operationKey);
    const current = await this.management(profileId, true);
    if (current.binding !== before.binding || current.scopeId !== before.scopeId) throw new ModelGatewayError('FORBIDDEN');
    return result;
  }

  /** Current manager-only observation, including a disabled profile. This
   * resolves an ambiguous save's current revision without decrypting/exporting
   * its key, creating a new profile, probing a provider or proving who saved it. */
  async read(profileId: string) {
    if (!id.safeParse(profileId).success) throw new ModelGatewayError('CONFIG_INVALID');
    const before = await this.management(profileId, true);
    const read = async () => {
      const row = await this.db.aiProviderProfile.findFirst({ where: { id: profileId, scopeId: before.scopeId,
        scopeKind: 'PLATFORM', serviceMode: 'platform_managed' }, include: { platformConnection: { select } } });
      if (!row) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
      let profile: AiProviderProfileRecord;
      try { profile = parseAiProviderProfileRecord(row); } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
      if (profile.id !== profileId || profile.scopeId !== before.scopeId || profile.scopeKind !== 'PLATFORM'
        || profile.serviceMode !== 'platform_managed') throw new ModelGatewayError('FORBIDDEN');
      const connection = row.platformConnection === null ? null : connectionSchema.safeParse(row.platformConnection);
      if (connection !== null && (!connection.success || connection.data.profileId !== profile.id
        || connection.data.configRevision !== profile.configRevision
        || profile.credentialRef !== this.reference(profile.id, profile.configRevision))) throw new ModelGatewayError('CONFIG_INVALID');
      const value = connection?.success ? connection.data : null;
      if (value) normalizeTenantModelBaseUrl(value.baseUrl);
      return { profile, connection: value };
    };
    const first = await read(), latest = await read();
    const current = await this.management(profileId, true);
    if (current.scopeId !== before.scopeId || current.binding !== before.binding) throw new ModelGatewayError('FORBIDDEN');
    if (requestFingerprint(first) !== requestFingerprint(latest)) throw new ModelGatewayError('CONFIG_INVALID');
    return { profileId, revision: latest.profile.configRevision, enabled: latest.profile.enabled && latest.profile.disabledAt === null,
      mode: 'platform_managed' as const, protocol: latest.profile.protocol, model: latest.profile.model,
      allowedCapabilities: [...latest.profile.allowedCapabilities],
      ...(latest.connection ? { baseUrl: latest.connection.baseUrl, maxOutputTokens: latest.connection.maxOutputTokens } : {}),
      credentialConfigured: Boolean(latest.connection?.credentialsEncrypted),
      verification: 'not_assessed_by_configuration_read' as const,
      observation: 'current_configuration_not_write_receipt' as const };
  }

  /** Creates the first DEFAULT Profile at revision zero, or updates an existing
   * PLATFORM Profile. Canonical scope registration belongs to the current
   * platform management application, never this credential resolver.
   * The Profile CAS is the transaction's write lock; losing writers cannot
   * replace its vault row. A failed/uncertain commit is never retried here.
   */
  async save(value: unknown) {
    const parsed = saveSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
    const input = parsed.data, before = await this.management(input.profileId);
    const owner = { scopeId: before.scopeId, scopeKind: 'PLATFORM' as const,
      targetId: input.profileId, actorId: before.actorId, workspaceId: null };
    const commandHash = input.operationKey === undefined ? undefined : this.secrets.fingerprint(requestFingerprint({ owner, input }));
    if (input.operationKey !== undefined) {
      if (!this.db.aiModelConfigurationOperation?.create) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
      const original = await readModelConfigurationOperation(this.db, owner, input.operationKey, commandHash);
      const current = await this.management(input.profileId);
      if (current.binding !== before.binding || current.scopeId !== before.scopeId) throw new ModelGatewayError('FORBIDDEN');
      if (original.state === 'recorded') {
        if (!('profileId' in original.result) || original.result.profileId !== input.profileId) throw new ModelGatewayError('CONFIG_INVALID');
        return original.result;
      }
    }
    const baseUrl = normalizeTenantModelBaseUrl(input.baseUrl);
    let callbackCompleted = false;
    try {
      const saved = await this.db.$transaction(async tx => {
        let profile = await tx.aiProviderProfile.findFirst({ where: { id: input.profileId,
          scopeId: before.scopeId, scopeKind: 'PLATFORM', serviceMode: 'platform_managed' } });
        if (input.expectedRevision === 0) {
          // Unique id/scope-key/scope-role constraints select exactly one first
          // writer across processes. No enabled placeholder escapes this txn.
          if (profile) throw new AiModelConfigurationRevisionConflictError();
          if (input.secretChange.operation === 'retain') throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE');
          profile = await tx.aiProviderProfile.create({ data: { id: input.profileId, scopeId: before.scopeId,
            scopeKind: 'PLATFORM', profileKey: 'default', role: 'DEFAULT', serviceMode: 'platform_managed',
            protocol: input.protocol, provider: input.protocol, model: input.model,
            credentialRef: 'unconfigured', configRevision: 1, enabled: false, disabledAt: new Date(), allowedCapabilities: [] } });
        } else if (!profile || profile.configRevision !== input.expectedRevision) throw new AiModelConfigurationRevisionConflictError();
        const old = await tx.aiPlatformModelConnection.findUnique({ where: { profileId: profile.id }, select });
        let key: string | undefined;
        if (input.secretChange.operation === 'replace') key = input.secretChange.apiKey;
        if (input.secretChange.operation === 'retain') {
          const row = connectionSchema.safeParse(old);
          if (!row.success || row.data.baseUrl !== baseUrl || profile.protocol !== input.protocol) throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE');
          key = this.decrypt(row.data, profile);
        }
        const nextRevision = input.expectedRevision + 1;
        let encrypted = '';
        if (key) {
          try { encrypted = this.secrets.encrypt({ apiKey: key, profileId: profile.id, scopeId: before.scopeId,
            revision: String(nextRevision), protocol: input.protocol, model: input.model, baseUrl }); }
          catch { throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE'); }
        }
        const current = await this.management(profile.id);
        if (current.scopeId !== before.scopeId || current.binding !== before.binding) throw new ModelGatewayError('FORBIDDEN');
        const enabled = Boolean(key) && input.enabled;
        const updated = await tx.aiProviderProfile.updateMany({ where: { id: profile.id, scopeId: before.scopeId,
          scopeKind: 'PLATFORM', serviceMode: 'platform_managed', configRevision: profile.configRevision },
          data: { configRevision: nextRevision, protocol: input.protocol, model: input.model,
            ...(input.allowedCapabilities === undefined ? {} : { allowedCapabilities: input.allowedCapabilities }),
            credentialRef: this.reference(profile.id, nextRevision), enabled, disabledAt: enabled ? null : new Date() } });
        if (updated.count !== 1) throw new AiModelConfigurationRevisionConflictError();
        const data = { configRevision: nextRevision, baseUrl, maxOutputTokens: input.maxOutputTokens, credentialsEncrypted: encrypted };
        if (old) await tx.aiPlatformModelConnection.update({ where: { profileId: profile.id }, data });
        else await tx.aiPlatformModelConnection.create({ data: { profileId: profile.id, ...data } });
        // A revocation observed while either write awaited must abort both writes.
        // Sequential current checks do not constitute atomic dispatch authority.
        const result = { profileId: profile.id, revision: nextRevision, enabled, credentialConfigured: Boolean(key) };
        if (input.operationKey !== undefined) await appendModelConfigurationOperation(tx, owner, {
          operationKey: input.operationKey, expectedRevision: input.expectedRevision, commandHash: commandHash!, result });
        const final = await this.management(profile.id);
        if (final.scopeId !== before.scopeId || final.binding !== before.binding) throw new ModelGatewayError('FORBIDDEN');
        callbackCompleted = true;
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      const current = await this.management(input.profileId);
      if (current.scopeId !== before.scopeId || current.binding !== before.binding) throw new ModelGatewayError('FORBIDDEN');
      return saved;
    } catch (error) {
      if (callbackCompleted) throw new AiModelConfigurationResultUnknownError();
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AiModelConfigurationRevisionConflictError();
      throw error;
    }
  }

  private platformInvocationGate(context: GatewayContext, profile: AiProviderProfileRecord) {
    if (!('tenantId' in context && 'workspaceId' in context)) {
      // Explicit SaaS platform consumer: the invocation authority resolves the
      // current platform identity; no tenant attribution is consulted.
      return (async () => {
        try { await this.authority.invoke(structuredClone(context)); } catch { throw new ModelGatewayError('FORBIDDEN'); }
        const owner = await this.currentOwner();
        if (owner.context.actor.kind !== 'saas_admin' || owner.context.actor.userId !== context.actorId
          || owner.context.scope.kind !== 'platform' || owner.configurationScope.kind !== 'PLATFORM'
          || owner.configurationScope.id !== profile.scopeId) throw new ModelGatewayError('FORBIDDEN');
        return true;
      })();
    }
    return null;
  }
  async assertCurrent(value: GatewayContext, selected: AiProviderProfileRecord) {
    const context = structuredClone(value), profile = structuredClone(selected);
    if (!profile.enabled || profile.disabledAt || profile.scopeKind !== 'PLATFORM' || profile.serviceMode !== 'platform_managed') throw new ModelGatewayError('CONFIG_INVALID');
    if (await this.platformInvocationGate(context, profile) === true) {
      const row = await this.db.aiProviderProfile.findFirst({ where: { id: profile.id, scopeId: profile.scopeId, scopeKind: 'PLATFORM',
        serviceMode: 'platform_managed', enabled: true, disabledAt: null, configRevision: profile.configRevision } });
      if (!row || capabilityProfileFingerprint(parseAiProviderProfileRecord(row)) !== capabilityProfileFingerprint(profile)) throw new ModelGatewayError('CONFIG_INVALID');
      await this.platformInvocationGate(context, profile);
      return;
    }
    const current = async () => {
      try { await this.authority.invoke(structuredClone(context)); } catch { throw new ModelGatewayError('FORBIDDEN'); }
      const owner = await this.currentOwner(), actor = owner.context.actor, scope = owner.context.scope;
      const workspaceContext = context as { tenantId: string; workspaceId: string; actorId: string };
      const actorId = actor.kind === 'user' ? actor.userId
        : actor.kind === 'customer' && owner.context.audience === 'client' && isAiStepExecutionContext(owner.context) ? actor.customerId
          : actor.kind === 'automation' && owner.context.audience === 'automation' && isAiStepExecutionContext(owner.context)
            ? actor.subjectId : null;
      if (!actorId || actorId !== context.actorId || scope.kind !== 'workspace' || scope.tenantId !== workspaceContext.tenantId
        || scope.workspaceId !== workspaceContext.workspaceId || owner.configurationScope.kind !== 'PLATFORM'
        || owner.configurationScope.id !== profile.scopeId) throw new ModelGatewayError('FORBIDDEN');
      const { authorizedAt: _, requestId: __, ...identity } = owner.context;
      return requestFingerprint(identity);
    };
    const before = await current();
    const row = await this.db.aiProviderProfile.findFirst({ where: { id: profile.id, scopeId: profile.scopeId, scopeKind: 'PLATFORM',
      serviceMode: 'platform_managed', enabled: true, disabledAt: null, configRevision: profile.configRevision } });
    if (!row || capabilityProfileFingerprint(parseAiProviderProfileRecord(row)) !== capabilityProfileFingerprint(profile)) throw new ModelGatewayError('CONFIG_INVALID');
    if (await current() !== before) throw new ModelGatewayError('FORBIDDEN');
  }

  async resolve(value: GatewayContext, selected: AiProviderProfileRecord) {
    const context = structuredClone(value), profile = structuredClone(selected);
    if (!('tenantId' in context && 'workspaceId' in context)) {
      // Explicit SaaS platform consumer: same revision/credential binding as
      // workspace consumers, but the identity gate is the platform principal.
      if (typeof context?.actorId !== 'string' || !/^[\w.:-]{1,128}$/u.test(context.actorId)) throw new ModelGatewayError('INVALID_REQUEST');
      if (!profile?.enabled || profile.disabledAt || profile.scopeKind !== 'PLATFORM'
        || profile.serviceMode !== 'platform_managed' || !isNativeModelProtocol(profile.protocol)
        || profile.credentialRef !== this.reference(profile.id, profile.configRevision)) throw new ModelGatewayError('CONFIG_INVALID');
      if (await this.platformInvocationGate(context, profile) !== true) throw new ModelGatewayError('FORBIDDEN');
      const read = () => this.db.aiProviderProfile.findFirst({ where: { id: profile.id, scopeId: profile.scopeId,
        scopeKind: 'PLATFORM', serviceMode: 'platform_managed', configRevision: profile.configRevision,
        enabled: true, disabledAt: null }, include: { platformConnection: { select } } });
      const profileFields = ['id', 'scopeId', 'scopeKind', 'profileKey', 'role', 'serviceMode', 'protocol', 'provider', 'model', 'credentialRef', 'configRevision'] as const;
      const stored = await read();
      if (!stored || profileFields.some(field => stored[field] !== profile[field])
        || requestFingerprint(stored.allowedCapabilities) !== requestFingerprint(profile.allowedCapabilities)) throw new ModelGatewayError('CONFIG_INVALID');
      const parsed = connectionSchema.safeParse(stored.platformConnection);
      if (!parsed.success) throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE');
      const credential = this.decrypt(parsed.data, profile);
      if (await this.platformInvocationGate(context, profile) !== true) throw new ModelGatewayError('FORBIDDEN');
      const latest = await read();
      if (!latest || profileFields.some(field => latest[field] !== stored[field])
        || requestFingerprint(latest.allowedCapabilities) !== requestFingerprint(stored.allowedCapabilities)
        || requestFingerprint(latest.platformConnection) !== requestFingerprint(stored.platformConnection)) throw new ModelGatewayError('CONFIG_INVALID');
      return { profileFingerprint: capabilityProfileFingerprint(profile), baseUrl: normalizeTenantModelBaseUrl(parsed.data.baseUrl),
        credential, maxOutputTokens: parsed.data.maxOutputTokens };
    }
    if (!context || [context.tenantId, context.workspaceId, context.actorId].some(v => typeof v !== 'string' || !/^[\w.:-]{1,128}$/u.test(v))) throw new ModelGatewayError('INVALID_REQUEST');
    if (!profile?.enabled || profile.disabledAt || profile.scopeKind !== 'PLATFORM'
      || profile.serviceMode !== 'platform_managed' || !isNativeModelProtocol(profile.protocol)
      || profile.credentialRef !== this.reference(profile.id, profile.configRevision)) throw new ModelGatewayError('CONFIG_INVALID');
    const current = async () => {
      try { await this.authority.invoke(structuredClone(context)); } catch { throw new ModelGatewayError('FORBIDDEN'); }
      const owner = await this.currentOwner(), actor = owner.context.actor, scope = owner.context.scope;
      const workspaceContext = context as { tenantId: string; workspaceId: string; actorId: string };
      // Customer and automation invocation require their distinct current task
      // authorities. This consumes no user identity or platform management grant.
      const actorId = actor.kind === 'user' ? actor.userId
        : actor.kind === 'customer' && owner.context.audience === 'client' && isAiStepExecutionContext(owner.context)
          ? actor.customerId
          : actor.kind === 'automation' && owner.context.audience === 'automation' && isAiStepExecutionContext(owner.context)
            ? actor.subjectId : null;
      if (!actorId || actorId !== context.actorId || scope.kind !== 'workspace'
        || scope.tenantId !== context.tenantId || scope.workspaceId !== context.workspaceId
        || owner.configurationScope.kind !== 'PLATFORM' || owner.configurationScope.id !== profile.scopeId) throw new ModelGatewayError('FORBIDDEN');
      const { authorizedAt: _, requestId: __, ...identity } = owner.context;
      return requestFingerprint(identity);
    };
    const before = await current();
    // Prisma may execute relation loading as separate statements. The encrypted
    // revision binding and subsequent reread must reject mixed revisions.
    const read = () => this.db.aiProviderProfile.findFirst({ where: { id: profile.id, scopeId: profile.scopeId,
      scopeKind: 'PLATFORM', serviceMode: 'platform_managed', configRevision: profile.configRevision,
      enabled: true, disabledAt: null }, include: { platformConnection: { select } } });
    const stored = await read();
    const profileFields = ['id', 'scopeId', 'scopeKind', 'profileKey', 'role', 'serviceMode', 'protocol', 'provider', 'model', 'credentialRef', 'configRevision'] as const;
    if (!stored || profileFields.some(field => stored[field] !== profile[field])
      || requestFingerprint(stored.allowedCapabilities) !== requestFingerprint(profile.allowedCapabilities)) throw new ModelGatewayError('CONFIG_INVALID');
    const parsed = connectionSchema.safeParse(stored.platformConnection);
    if (!parsed.success) throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE');
    const credential = this.decrypt(parsed.data, profile);
    if (await current() !== before) throw new ModelGatewayError('FORBIDDEN');
    const latest = await read();
    if (!latest || profileFields.some(field => latest[field] !== stored[field])
      || requestFingerprint(latest.allowedCapabilities) !== requestFingerprint(stored.allowedCapabilities)
      || requestFingerprint(latest.platformConnection) !== requestFingerprint(stored.platformConnection)) throw new ModelGatewayError('CONFIG_INVALID');
    // This is revocation revalidation, NOT atomic dispatch authorization. The
    // Gateway still owns its final admission/fencing and current authority check.
    return { profileFingerprint: capabilityProfileFingerprint(profile), baseUrl: normalizeTenantModelBaseUrl(parsed.data.baseUrl),
      credential, maxOutputTokens: parsed.data.maxOutputTokens };
  }
}
