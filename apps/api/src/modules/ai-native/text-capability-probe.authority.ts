import type { AiScopeRepository } from './ai-scope.repository';
import type { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import type { TenantModelConfigService } from './tenant-model-config.service';
import type { ProviderProfileRepository, AiProfileCapability } from './provider-profile.ports';
import type { ProviderRouteDecision } from './provider-router.ports';
import type { PrismaGatewayInvocationBindings } from './budget/prisma-gateway-invocation-bindings';
import type { GatewayRoutingResolution } from './gateway-routing.service';
import { gatewayRoutingBinding } from './gateway-routing.service';
import { ModelGatewayError, type GatewayContext, type ModelProtocolRequest } from './model-gateway.ports';
import { capabilityProfileFingerprint } from './capability-verification';
import { prepareGatewayTextIntent } from './gateway-intent';
import { probeContextSchema, textProbeCommandSchema, textProbeIntent, TEXT_PROBE_SCENE, type TextProbeCommand } from './text-capability-probe';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

export interface TextProbeAuthorityDependencies {
  management: Pick<TenantModelConfigurationAuthority, 'authorize'>;
  scopes: Pick<AiScopeRepository, 'resolveRoutingScopes'>;
  configuration: Pick<TenantModelConfigService, 'selectionForInvocation'>;
  profiles: Pick<ProviderProfileRepository, 'get'>;
  bindings: Pick<PrismaGatewayInvocationBindings, 'resolveForReserve'>;
}
export class TextCapabilityProbeAuthority {
  private readonly command: TextProbeCommand;
  private readonly context: GatewayContext;
  constructor(private readonly dependencies: TextProbeAuthorityDependencies, context: GatewayContext, command: TextProbeCommand) {
    this.context = probeContextSchema.parse(structuredClone(context));
    this.command = textProbeCommandSchema.parse(structuredClone(command));
  }
  private async current(): Promise<GatewayRoutingResolution> {
    const d = this.dependencies, context = structuredClone(this.context);
    await d.management.authorize(context, 'manage');
    await d.management.authorize(context, 'invoke');
    const selection = await d.configuration.selectionForInvocation(context);
    if (selection.mode !== 'tenant_managed') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const resolved = await d.scopes.resolveRoutingScopes('tenant_managed');
    const c = resolved.context, scope = resolved.configurationScope;
    if (c.audience !== 'operator' || c.actor.kind !== 'user' || c.actor.userId !== context.actorId
      || c.scope.kind !== 'workspace' || c.scope.tenantId !== context.tenantId || c.scope.workspaceId !== context.workspaceId
      || resolved.consumerScope.kind !== 'WORKSPACE' || resolved.consumerScope.tenantId !== context.tenantId
      || resolved.consumerScope.workspaceId !== context.workspaceId || scope.kind !== 'TENANT' || scope.tenantId !== context.tenantId) {
      throw new ModelGatewayError('FORBIDDEN');
    }
    const profile = await d.profiles.get(scope, this.command.profileKey);
    if (!profile || !profile.enabled || profile.disabledAt || profile.serviceMode !== 'tenant_managed'
      || profile.scopeId !== scope.id || profile.scopeKind !== scope.kind || profile.configRevision !== selection.revision
      || !profile.allowedCapabilities.includes('text') || capabilityProfileFingerprint(profile) !== this.command.profileFingerprint) {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
    const prepared = textProbeIntent(this.command.operationId, resolved.consumerScope.id);
    return { context: c, consumerScope: resolved.consumerScope, selection, scene: 'chat', requiredCapabilities: ['text'],
      route: { profile, scope, role: profile.role,
        preflight: { allowed: false, required: ['text'], missing: ['text'], stale: [] },
        probe: { purpose: 'capability_text_probe', operationId: this.command.operationId,
          profileFingerprint: this.command.profileFingerprint, intentHash: prepared.intentHash } } };
  }
  async resolve(value: GatewayContext, required: readonly AiProfileCapability[]) {
    if (requestFingerprint(value) !== requestFingerprint(this.context) || required.length !== 1 || required[0] !== 'text') {
      throw new ModelGatewayError('FORBIDDEN');
    }
    const initial = await this.current(), current = await this.current();
    if (gatewayRoutingBinding(initial) !== gatewayRoutingBinding(current)) throw new ModelGatewayError('CONFIG_INVALID');
    return structuredClone(current);
  }
  async assertCurrent(context: GatewayContext, resolution: GatewayRoutingResolution) {
    if (gatewayRoutingBinding(await this.resolve(context, ['text'])) !== gatewayRoutingBinding(resolution)) throw new ModelGatewayError('CONFIG_INVALID');
  }
  async authorizeDispatch(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision) {
    const current = await this.resolve(context, ['text']);
    const prepared = textProbeIntent(this.command.operationId, current.consumerScope.id);
    const expected = prepareGatewayTextIntent(prepared.intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32 }, 'invoke').request;
    if (requestFingerprint(request) !== requestFingerprint({ ...expected, model: current.route.profile.model })
      || requestFingerprint(route) !== requestFingerprint(current.route)) throw new ModelGatewayError('FORBIDDEN');
    await this.dependencies.bindings.resolveForReserve(context, { callId: request.callId, model: request.model,
      maxOutputTokens: request.maxOutputTokens, intentHash: prepared.intentHash });
    await this.assertCurrent(context, current);
  }
}
