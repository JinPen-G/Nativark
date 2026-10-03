import { ModelGatewayError } from './model-gateway.ports';
import type { AiProviderProfileRecord, AiProviderProfileRole, AiProfileServiceMode } from './provider-profile.ports';
import type { ProviderRouteDecision, ProviderRouteRequest, ProviderRouterPorts, AiRouteScene } from './provider-router.ports';

const roleFor = (scene: AiRouteScene): AiProviderProfileRole => {
  switch (scene) {
    case 'builder': case 'reasoning': return 'REASONING';
    case 'vision': return 'VISION';
    case 'knowledge': return 'EMBEDDING';
    case 'chat': return 'DEFAULT';
  }
};
/**
 * Route resolution is intentionally scope-explicit. Platform mode reads only
 * the platform scope; tenant mode reads only the consumer scope. There is no
 * cross-tenant, cross-workspace or cross-mode fallback in this boundary.
 */
export class ProviderRouterService {
  constructor(private readonly ports: ProviderRouterPorts) {}
  async resolve(request: ProviderRouteRequest): Promise<ProviderRouteDecision> {
    const expectedKind = request.mode === 'platform_managed' ? 'PLATFORM' : request.consumerScope.kind;
    const scope = request.mode === 'platform_managed' ? request.platformScope : request.consumerScope;
    if (scope.kind !== expectedKind || request.platformScope.kind !== 'PLATFORM' || !['platform_managed', 'tenant_managed'].includes(request.mode)) throw new ModelGatewayError('CONFIG_INVALID');
    const profiles = (await this.ports.profiles.list(scope)).filter(profile => profile.enabled && !profile.disabledAt && profile.serviceMode === request.mode && profile.scopeId === scope.id && profile.scopeKind === scope.kind);
    const desiredRole = roleFor(request.scene);
    const ordered = profiles.filter(profile => profile.role === desiredRole).concat(profiles.filter(profile => profile.role === 'DEFAULT' && desiredRole !== 'DEFAULT'));
    if (ordered.length === 0) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    const checked: Array<{ profile: AiProviderProfileRecord; preflight: Awaited<ReturnType<ProviderRouterPorts['capabilities']['preflight']>> }> = [];
    for (const profile of ordered) {
      const preflight = await this.ports.capabilities.preflight(profile, request.requiredCapabilities);
      checked.push({ profile, preflight });
      if (preflight.allowed) return { profile, scope, role: profile.role, preflight };
    }
    if (checked.some(item => item.preflight.missing.length > 0)) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
  }
}
