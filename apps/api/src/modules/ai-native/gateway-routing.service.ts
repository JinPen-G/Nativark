import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AiScopeRepository } from './ai-scope.repository';
import type { AiProfileCapability, AiProfileScope, AiProfileServiceMode } from './provider-profile.ports';
import type { AiRouteScene, ProviderRouteDecision } from './provider-router.ports';
import type { ProviderRouterService } from './provider-router.service';
import type { TenantModelConfigService } from './tenant-model-config.service';
import { ModelGatewayError, type GatewayContext } from './model-gateway.ports';
import { capabilityNameSchema } from './capability-verification';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const id = z.string().min(1).max(128).regex(/^[\w.:-]+$/u);
const contextSchema = z.object({ tenantId: id, workspaceId: id, actorId: id }).strict();
const sceneSchema = z.enum(['chat', 'builder', 'vision', 'knowledge', 'reasoning']);
const requiredSchema = z.array(capabilityNameSchema).min(1).max(7).refine(values => new Set(values).size === values.length);
const selectionSchema = z.object({ mode: z.enum(['platform_managed', 'tenant_managed']), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) }).strict();
export interface GatewayRoutingResolution {
  context: AiExecutionContext;
  consumerScope: AiProfileScope;
  route: ProviderRouteDecision;
  selection: { mode: AiProfileServiceMode; revision: number };
  scene: AiRouteScene;
  requiredCapabilities: readonly AiProfileCapability[];
}
function identity(context: AiExecutionContext) {
  const { authorizedAt: _, requestId: __, ...binding } = context;
  return binding;
}
export function gatewayRoutingBinding(value: GatewayRoutingResolution) {
  return requestFingerprint({ ...value, context: identity(value.context) });
}

// Workspace/user bridge only; other identities need their own current configuration authority.
export class AiGatewayRoutingService {
  constructor(
    private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent' | 'resolveRoutingScopes'>,
    private readonly configuration: Pick<TenantModelConfigService, 'selectionForInvocation'>,
    private readonly router: Pick<ProviderRouterService, 'resolve'>,
    private readonly scene: AiRouteScene
  ) {
    if (!scopes || typeof scopes.resolveCurrent !== 'function' || typeof scopes.resolveRoutingScopes !== 'function'
      || typeof configuration?.selectionForInvocation !== 'function' || typeof router?.resolve !== 'function' || !sceneSchema.safeParse(scene).success) {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
  }

  private match(expected: GatewayContext, current: AiExecutionContext) {
    if ((current.audience !== 'operator' && current.audience !== 'staff') || current.actor.kind !== 'user'
      || current.scope.kind !== 'workspace' || current.actor.userId !== expected.actorId
      || current.scope.tenantId !== expected.tenantId || current.scope.workspaceId !== expected.workspaceId) throw new ModelGatewayError('FORBIDDEN');
  }

  private async selection(context: GatewayContext) {
    try { return selectionSchema.parse(await this.configuration.selectionForInvocation(structuredClone(context))); }
    catch { throw new ModelGatewayError('CONFIG_INVALID'); }
  }

  async resolve(value: GatewayContext, requested: readonly AiProfileCapability[]): Promise<GatewayRoutingResolution> {
    const expected = contextSchema.safeParse(value), required = requiredSchema.safeParse(requested);
    if (!expected.success || !required.success) throw new ModelGatewayError('INVALID_REQUEST');
    const context = expected.data;
    let initial;
    try { initial = structuredClone(await this.scopes.resolveCurrent()); }
    catch { throw new ModelGatewayError('FORBIDDEN'); }
    this.match(context, initial.context);
    const selected = await this.selection(context);
    let scopes;
    try { scopes = structuredClone(await this.scopes.resolveRoutingScopes(selected.mode)); }
    catch { throw new ModelGatewayError('FORBIDDEN'); }
    this.match(context, scopes.context);
    if (requestFingerprint(identity(initial.context)) !== requestFingerprint(identity(scopes.context))
      || requestFingerprint(initial.scope) !== requestFingerprint(scopes.consumerScope)) throw new ModelGatewayError('FORBIDDEN');
    const route = structuredClone(await this.router.resolve({ consumerScope: scopes.consumerScope, configurationScope: scopes.configurationScope,
      mode: selected.mode, scene: this.scene, requiredCapabilities: required.data }));
    const currentSelection = await this.selection(context);
    let current;
    try { current = structuredClone(await this.scopes.resolveRoutingScopes(currentSelection.mode)); }
    catch { throw new ModelGatewayError('FORBIDDEN'); }
    this.match(context, current.context);
    if (requestFingerprint(identity(scopes.context)) !== requestFingerprint(identity(current.context))
      || requestFingerprint(scopes.consumerScope) !== requestFingerprint(current.consumerScope)) throw new ModelGatewayError('FORBIDDEN');
    if (requestFingerprint(selected) !== requestFingerprint(currentSelection)
      || requestFingerprint(scopes.configurationScope) !== requestFingerprint(current.configurationScope)) throw new ModelGatewayError('CONFIG_INVALID');
    return { context: current.context, consumerScope: current.consumerScope, route, selection: currentSelection,
      scene: this.scene, requiredCapabilities: [...required.data] };
  }

  async assertCurrent(context: GatewayContext, resolution: GatewayRoutingResolution): Promise<void> {
    const current = await this.resolve(context, resolution.requiredCapabilities);
    if (gatewayRoutingBinding(current) !== gatewayRoutingBinding(resolution)) throw new ModelGatewayError('CONFIG_INVALID');
  }
}
