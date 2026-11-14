import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AiScopeRepository } from './ai-scope.repository';
import type { AiProfileCapability, AiProfileScope, AiProfileServiceMode } from './provider-profile.ports';
import type { AiRouteScene, ProviderRouteDecision } from './provider-router.ports';
import type { ProviderRouterService } from './provider-router.service';
import type { TenantModelConfigService } from './tenant-model-config.service';
import { ModelGatewayError, type WorkspaceGatewayContext } from './model-gateway.ports';
import { capabilityNameSchema } from './capability-verification';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const id = z.string().min(1).max(128).regex(/^[\w.:-]+$/u);
const contextSchema = z.object({ tenantId: id, workspaceId: id, actorId: id }).strict();
const sceneSchema = z.enum(['chat', 'builder', 'vision', 'knowledge', 'reasoning', 'embedding']);
const requiredSchema = z.array(capabilityNameSchema).min(1).max(8).refine(values => new Set(values).size === values.length);
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

// Routing consumes a current server-bound principal. Automation and customer
// tasks keep their own owner namespace; this bridge never grants execution.
export class AiGatewayRoutingService {
  constructor(
    private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent' | 'resolveRoutingScopes'>,
    private readonly configuration: Pick<TenantModelConfigService, 'selectionForInvocation'>,
    private readonly router: Pick<ProviderRouterService, 'resolve'> & Partial<Pick<ProviderRouterService, 'assertCurrent'>>,
    private readonly scene: AiRouteScene
  ) {
    if (!scopes || typeof scopes.resolveCurrent !== 'function' || typeof scopes.resolveRoutingScopes !== 'function'
      || typeof configuration?.selectionForInvocation !== 'function' || typeof router?.resolve !== 'function' || !sceneSchema.safeParse(scene).success) {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
  }

  private match(expected: WorkspaceGatewayContext, current: AiExecutionContext) {
    const actorId = current.actor.kind === 'customer' ? current.actor.customerId
      : current.actor.kind === 'automation' ? current.actor.subjectId
        : 'userId' in current.actor ? current.actor.userId : undefined;
    if (!['operator', 'staff', 'client', 'automation'].includes(current.audience)
      || (current.audience === 'client' ? current.actor.kind !== 'customer'
        : current.audience === 'automation' ? current.actor.kind !== 'automation' : current.actor.kind !== 'user')
      || current.scope.kind !== 'workspace'
      || actorId !== expected.actorId
      || current.scope.tenantId !== expected.tenantId || current.scope.workspaceId !== expected.workspaceId) throw new ModelGatewayError('FORBIDDEN');
  }

  private async selection(context: WorkspaceGatewayContext) {
    try { return selectionSchema.parse(await this.configuration.selectionForInvocation(structuredClone(context))); }
    catch (error) { if (error instanceof ModelGatewayError) throw error; throw new ModelGatewayError('CONFIG_INVALID'); }
  }

  async resolve(value: WorkspaceGatewayContext, requested: readonly AiProfileCapability[]): Promise<GatewayRoutingResolution> {
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

  async assertCurrent(context: WorkspaceGatewayContext, resolution: GatewayRoutingResolution): Promise<void> {
    if (!this.router.assertCurrent) {
      const current = await this.resolve(context, resolution.requiredCapabilities);
      if (gatewayRoutingBinding(current) !== gatewayRoutingBinding(resolution)) throw new ModelGatewayError('CONFIG_INVALID');
      return;
    }
    const expected = contextSchema.parse(structuredClone(context)), original = structuredClone(resolution);
    const check = async () => {
      const selected = await this.selection(expected);
      const current = structuredClone(await this.scopes.resolveRoutingScopes(selected.mode));
      this.match(expected, current.context);
      if (requestFingerprint(identity(current.context)) !== requestFingerprint(identity(original.context))
        || requestFingerprint(current.consumerScope) !== requestFingerprint(original.consumerScope)) throw new ModelGatewayError('FORBIDDEN');
      if (requestFingerprint(selected) !== requestFingerprint(original.selection)
        || requestFingerprint(current.configurationScope) !== requestFingerprint(original.route.scope)) throw new ModelGatewayError('CONFIG_INVALID');
    };
    await check();
    await this.router.assertCurrent(structuredClone(original.route), [...original.requiredCapabilities]);
    await check();
  }
}
