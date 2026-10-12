import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { SecretBox } from '../../common/secret-box';
import type { AiScopeRepository } from './ai-scope.repository';
import type { AiProviderProfileRecord } from './provider-profile.ports';
import { ModelGatewayError, type GatewayContext } from './model-gateway.ports';
import type { GatewayConnectionResolver } from './routed-model-transport';
import { capabilityNameSchema, capabilityProfileFingerprint } from './capability-verification';
import { normalizeTenantModelBaseUrl } from './tenant-model-config.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { isAiStepExecutionContext } from './task-contract-validation';

const id = z.string().min(1).max(36).regex(/^[\w.:-]+$/u);
const revision = z.number().int().min(1).max(4294967295);
const saveSchema = z.object({
  profileId: id, expectedRevision: revision.max(4294967294),
  protocol: z.literal('openai_chat_completions'), model: z.string().min(1).max(256).regex(/^[\w./:-]+$/u),
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
  credentialsEncrypted: z.string().max(65535).regex(/^(?:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+)?$/u)
});
const select = { profileId: true, configRevision: true, baseUrl: true, maxOutputTokens: true,
  credentialsEncrypted: true } satisfies Prisma.AiPlatformModelConnectionSelect;
type Connection = z.infer<typeof connectionSchema>;
type Db = Pick<PrismaClient, '$transaction' | 'aiProviderProfile' | 'aiPlatformModelConnection'>;
type Scopes = Pick<AiScopeRepository, 'resolveRoutingScopes'>;

/** Fresh action-specific server authorization is mandatory. Scope lookup is NOT
 * permission, entitlement, budget admission or provider dispatch authority.
 */
export interface PlatformConnectionAuthority {
  manage(profileId: string): Promise<void>;
  invoke(context: GatewayContext): Promise<void>;
}

/** Persistent platform resolver for the existing RoutedModelTransport. No
 * tenant fallback, new provider dispatcher or automatic module activation.
 */
export class PrismaPlatformModelConnection implements GatewayConnectionResolver {
  constructor(private readonly db: Db, private readonly scopes: Scopes,
    private readonly authority: PlatformConnectionAuthority, private readonly secrets: SecretBox) {
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
  private async currentOwner() {
    try { return structuredClone(await this.scopes.resolveRoutingScopes('platform_managed')); }
    catch { throw new ModelGatewayError('FORBIDDEN'); }
  }
  private async management(profileId: string) {
    try { await this.authority.manage(profileId); } catch { throw new ModelGatewayError('FORBIDDEN'); }
    const resolved = await this.currentOwner();
    if (resolved.context.actor.kind !== 'saas_admin' || resolved.context.scope.kind !== 'platform'
      || resolved.configurationScope.kind !== 'PLATFORM') throw new ModelGatewayError('FORBIDDEN');
    const { authorizedAt: _, requestId: __, ...identity } = resolved.context;
    return { scopeId: resolved.configurationScope.id, binding: requestFingerprint(identity) };
  }

  /** Updates an existing PLATFORM Profile, never creates canonical scope IDs.
   * The Profile CAS is the transaction's write lock; losing writers cannot
   * replace its vault row. A failed/uncertain commit is never retried here.
   */
  async save(value: unknown) {
    const parsed = saveSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
    const input = parsed.data, before = await this.management(input.profileId);
    const baseUrl = normalizeTenantModelBaseUrl(input.baseUrl);
    return this.db.$transaction(async tx => {
      const profile = await tx.aiProviderProfile.findFirst({ where: { id: input.profileId,
        scopeId: before.scopeId, scopeKind: 'PLATFORM', serviceMode: 'platform_managed', configRevision: input.expectedRevision } });
      if (!profile) throw new ModelGatewayError('CONFIG_INVALID');
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
        scopeKind: 'PLATFORM', serviceMode: 'platform_managed', configRevision: input.expectedRevision },
        data: { configRevision: nextRevision, protocol: input.protocol, model: input.model,
          ...(input.allowedCapabilities === undefined ? {} : { allowedCapabilities: input.allowedCapabilities }),
          credentialRef: this.reference(profile.id, nextRevision), enabled, disabledAt: enabled ? null : new Date() } });
      if (updated.count !== 1) throw new ModelGatewayError('CONFIG_INVALID');
      const data = { configRevision: nextRevision, baseUrl, maxOutputTokens: input.maxOutputTokens, credentialsEncrypted: encrypted };
      if (old) await tx.aiPlatformModelConnection.update({ where: { profileId: profile.id }, data });
      else await tx.aiPlatformModelConnection.create({ data: { profileId: profile.id, ...data } });
      // A revocation observed while either write awaited must abort both writes.
      // Sequential current checks do not constitute atomic dispatch authority.
      const final = await this.management(profile.id);
      if (final.scopeId !== before.scopeId || final.binding !== before.binding) throw new ModelGatewayError('FORBIDDEN');
      return { profileId: profile.id, revision: nextRevision, enabled, credentialConfigured: Boolean(key) };
    });
  }

  async resolve(value: GatewayContext, selected: AiProviderProfileRecord) {
    const context = structuredClone(value), profile = structuredClone(selected);
    if (!context || [context.tenantId, context.workspaceId, context.actorId].some(v => typeof v !== 'string' || !/^[\w.:-]{1,128}$/u.test(v))) throw new ModelGatewayError('INVALID_REQUEST');
    if (!profile?.enabled || profile.disabledAt || profile.scopeKind !== 'PLATFORM'
      || profile.serviceMode !== 'platform_managed' || profile.protocol !== 'openai_chat_completions'
      || profile.credentialRef !== this.reference(profile.id, profile.configRevision)) throw new ModelGatewayError('CONFIG_INVALID');
    const current = async () => {
      try { await this.authority.invoke(structuredClone(context)); } catch { throw new ModelGatewayError('FORBIDDEN'); }
      const owner = await this.currentOwner(), actor = owner.context.actor, scope = owner.context.scope;
      // Customer invocation is only possible with the formal client execution
      // context and a separately supplied current task authority. It confers no
      // platform management permission; automation/platform jobs stay refused.
      const actorId = actor.kind === 'user' ? actor.userId
        : actor.kind === 'customer' && owner.context.audience === 'client' && isAiStepExecutionContext(owner.context)
          ? actor.customerId : null;
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
