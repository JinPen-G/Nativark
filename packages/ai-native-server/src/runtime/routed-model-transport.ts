/** Rental 运输参加者，BYOK配置与原Task事务见证在此接入公共运输。 */
import { z } from 'zod';
import { RoutedModelTransport as PlatformRoutedModelTransport, ModelGatewayError, capabilityProfileFingerprint,
  type GatewayContext, type GatewayConnection, type GatewayConnectionResolver, type GatewayProbeDispatchAuthority,
  type ModelAdapter, type ModelProtocolRequest, type AiProviderProfileRecord } from '@rental-os/platform-server/ai-gateway';
import { normalizeTenantModelBaseUrl, type TenantModelConfigService } from './tenant-model-config.service';
import { hasAiTaskTransactionAuthority } from './task-transaction-authority';
export type { GatewayConnection, GatewayConnectionResolver, GatewayProbeDispatchAuthority } from '@rental-os/platform-server/ai-gateway';
const contextSchema = z.object({ tenantId: z.string().min(1).max(128), workspaceId: z.string().min(1).max(128), actorId: z.string().min(1).max(128) }).strict();
export class TenantModelConnectionResolver implements GatewayConnectionResolver {
  constructor(private readonly config: Pick<TenantModelConfigService, 'selectionForInvocation' | 'profile' | 'credential'>) {
    if ([config?.selectionForInvocation, config?.profile, config?.credential].some(value => typeof value !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
  }
  async assertCurrent(value: GatewayContext, selected: AiProviderProfileRecord) {
    const context = contextSchema.parse(value), profile = structuredClone(selected);
    if (profile.serviceMode !== 'tenant_managed' || profile.scopeKind !== 'TENANT') throw new ModelGatewayError('CONFIG_INVALID');
    const selection = await this.config.selectionForInvocation(context);
    if (selection.mode !== 'tenant_managed' || selection.revision !== profile.configRevision) throw new ModelGatewayError('CONFIG_INVALID');
  }
  async resolve(value: GatewayContext, selected: AiProviderProfileRecord): Promise<GatewayConnection> {
    const context = contextSchema.parse(value), profile = structuredClone(selected);
    if (profile.serviceMode !== 'tenant_managed' || profile.scopeKind !== 'TENANT') throw new ModelGatewayError('CONFIG_INVALID');
    const initial = await this.config.selectionForInvocation(structuredClone(context));
    if (initial.mode !== 'tenant_managed' || initial.revision !== profile.configRevision) throw new ModelGatewayError('CONFIG_INVALID');
    const current = await this.config.profile(structuredClone(context));
    if (!current.enabled || current.provider !== profile.protocol || !current.allowedModels.includes(profile.model)
      || current.credentialRef !== profile.credentialRef || !current.baseUrl) throw new ModelGatewayError('CONFIG_INVALID');
    const credential = await this.config.credential(profile.credentialRef, structuredClone(context));
    const after = await this.config.selectionForInvocation(structuredClone(context));
    if (after.mode !== initial.mode || after.revision !== initial.revision) throw new ModelGatewayError('CONFIG_INVALID');
    return { profileFingerprint: capabilityProfileFingerprint(profile), baseUrl: normalizeTenantModelBaseUrl(current.baseUrl), credential, maxOutputTokens: current.maxOutputTokens };
  }
}
export class RoutedModelTransport extends PlatformRoutedModelTransport {
  constructor(connections: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver }, adapters: readonly ModelAdapter[],
    probe?: GatewayProbeDispatchAuthority, beforeProvider?: (context: GatewayContext, request: ModelProtocolRequest, signal: AbortSignal) => Promise<void>) {
    super(connections, adapters, probe, beforeProvider, hasAiTaskTransactionAuthority);
  }
}
