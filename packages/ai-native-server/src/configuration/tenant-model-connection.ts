/** The original encrypted BYOK resolver. A public Task supplies a current
 * tenant authority and the exact canonical configuration scope. */
import { z } from 'zod';
import { ModelGatewayError, capabilityProfileFingerprint, tenantGatewayContextSchema,
  normalizeModelBaseUrl, type GatewayContext, type GatewayConnectionResolver, type AiProviderProfileRecord,
  type WorkspaceGatewayContext } from '@rental-os/platform-server/ai-gateway';
import type { TenantModelConfigService } from '../runtime/tenant-model-config.service';
import type { TenantConfigurationContext } from '../tenant-configuration-transactions';
import type { AiScopeRepository } from '../runtime/ai-scope.repository';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';

const id = z.string().min(1).max(128);
const workspaceContext = z.object({ tenantId: id, workspaceId: id, actorId: id }).strict();
type Config<Context extends TenantConfigurationContext> = Pick<TenantModelConfigService<Context>, 'selectionForInvocation' | 'profile' | 'credential'>;

export class TenantModelConnectionResolver<Context extends TenantConfigurationContext = WorkspaceGatewayContext> implements GatewayConnectionResolver {
  constructor(private readonly config: Config<Context>,
    private readonly context: (value: GatewayContext) => Context = value => workspaceContext.parse(value) as Context) {
    if ([config?.selectionForInvocation, config?.profile, config?.credential].some(value => typeof value !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
  }
  async assertCurrent(value: GatewayContext, selected: AiProviderProfileRecord) {
    const context = this.context(value), profile = structuredClone(selected);
    if (profile.serviceMode !== 'tenant_managed' || profile.scopeKind !== 'TENANT') throw new ModelGatewayError('CONFIG_INVALID');
    const selection = await this.config.selectionForInvocation(context);
    if (selection.mode !== 'tenant_managed' || selection.revision !== profile.configRevision) throw new ModelGatewayError('CONFIG_INVALID');
  }
  async resolve(value: GatewayContext, selected: AiProviderProfileRecord) {
    const context = this.context(value), profile = structuredClone(selected);
    if (profile.serviceMode !== 'tenant_managed' || profile.scopeKind !== 'TENANT') throw new ModelGatewayError('CONFIG_INVALID');
    const initial = await this.config.selectionForInvocation(structuredClone(context));
    if (initial.mode !== 'tenant_managed' || initial.revision !== profile.configRevision) throw new ModelGatewayError('CONFIG_INVALID');
    const current = await this.config.profile(structuredClone(context));
    if (!current.enabled || current.provider !== profile.protocol || !current.allowedModels.includes(profile.model)
      || current.credentialRef !== profile.credentialRef || !current.baseUrl) throw new ModelGatewayError('CONFIG_INVALID');
    const credential = await this.config.credential(profile.credentialRef, structuredClone(context));
    const after = await this.config.selectionForInvocation(structuredClone(context));
    if (after.mode !== initial.mode || after.revision !== initial.revision) throw new ModelGatewayError('CONFIG_INVALID');
    return { profileFingerprint: capabilityProfileFingerprint(profile), baseUrl: normalizeModelBaseUrl(current.baseUrl), credential, maxOutputTokens: current.maxOutputTokens };
  }
}

export function createPublicTenantModelConnection(config: Config<{ tenantId: string; actorId: string }>,
  scopes: Pick<AiScopeRepository, 'resolveRoutingScopes'>): GatewayConnectionResolver {
  const context = (value: GatewayContext) => {
    const parsed = tenantGatewayContextSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('FORBIDDEN');
    return { actorId: parsed.data.actorId, tenantId: parsed.data.tenantId };
  };
  const original = new TenantModelConnectionResolver(config, context);
  const current = async (value: GatewayContext, profile: AiProviderProfileRecord) => {
    const expected = context(value), { context: identity, configurationScope, consumerScope } = await scopes.resolveRoutingScopes('tenant_managed');
    if (identity.audience !== 'operator' || identity.actor.kind !== 'user' || identity.actor.userId !== expected.actorId
      || identity.scope.kind !== 'tenant' || identity.scope.tenantId !== expected.tenantId || configurationScope.kind !== 'TENANT'
      || configurationScope.tenantId !== expected.tenantId || configurationScope.workspaceId !== undefined
      || consumerScope.id !== configurationScope.id || profile.scopeId !== configurationScope.id || !profile.enabled || profile.disabledAt)
      throw new ModelGatewayError('FORBIDDEN');
    const { requestId: _request, authorizedAt: _time, ...stable } = identity;
    return requestFingerprint({ stable, configurationScope });
  };
  const check = async <T>(caller: GatewayContext, selected: AiProviderProfileRecord, read: () => Promise<T>) => {
    const before = await current(caller, selected), result = await read();
    if (await current(caller, selected) !== before) throw new ModelGatewayError('FORBIDDEN');
    await original.assertCurrent(caller, selected);
    return result;
  };
  const resolver: GatewayConnectionResolver = { async resolve(value, selected) {
    const caller = structuredClone(value), profile = structuredClone(selected);
    return check(caller, profile, () => original.resolve(caller, profile));
  }, async assertCurrent(value, selected) {
    const caller = structuredClone(value), profile = structuredClone(selected);
    await check(caller, profile, () => original.assertCurrent(caller, profile));
  } };
  return Object.freeze(resolver);
}
