import type { AiScopeRepository } from './ai-scope.repository';
import type { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import type { TenantModelConfigService } from './tenant-model-config.service';
import type { ProviderProfileRepository, AiProfileCapability } from './provider-profile.ports';
import type { ProviderRouteDecision } from './provider-router.ports';
import type { PrismaGatewayInvocationBindings } from './budget/prisma-gateway-invocation-bindings';
import type { GatewayRoutingResolution } from './gateway-routing.service';
import { gatewayRoutingBinding } from './gateway-routing.service';
import { ModelGatewayError, type WorkspaceGatewayContext, type ModelProtocolRequest } from './model-gateway.ports';
import { capabilityProfileFingerprint } from './capability-verification';
import { prepareGatewayTextIntent, prepareGatewayIntent, type GatewayMediaAttachmentResolver } from './gateway-intent';
import { visionCapabilityChallenge } from './vision-capability-challenge';
import { audioCapabilityChallenge } from './audio-capability-challenge';
import { probeContextSchema, textProbeCommandSchema, textProbeIntent, textProbeCapability, textProbeMode, textProbeRequirements,
  isPlatformProbeContext, TEXT_PROBE_SCENE, type TextProbeCommand, type TextProbeContext } from './text-capability-probe';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

export interface TextProbeAuthorityDependencies {
  management: Pick<TenantModelConfigurationAuthority, 'authorize'>;
  scopes: Pick<AiScopeRepository, 'resolveRoutingScopes'>;
  configuration: Pick<TenantModelConfigService, 'selectionForInvocation'>;
  profiles: Pick<ProviderProfileRepository, 'get'>;
  bindings: Pick<PrismaGatewayInvocationBindings, 'resolveForReserve'>;
}
/** Workspace operator/staff probe authority. Platform SaaS principals use the
 * dedicated platform authority composition; this class never accepts one. */
export class TextCapabilityProbeAuthority {
  private readonly command: TextProbeCommand;
  private readonly context: TextProbeContext;
  constructor(private readonly dependencies: TextProbeAuthorityDependencies, context: TextProbeContext, command: TextProbeCommand) {
    this.context = probeContextSchema.parse(structuredClone(context));
    this.command = textProbeCommandSchema.parse(structuredClone(command));
    if (isPlatformProbeContext(this.context)) throw new ModelGatewayError('FORBIDDEN');
  }
  /** Only this server-created immutable challenge, never an uploaded file ACL
   * bypass. Business attachment references are not accepted by this resolver. */
  get media(): GatewayMediaAttachmentResolver | undefined {
    const capability = textProbeCapability(this.command);
    if (capability !== 'vision' && capability !== 'audio') return undefined;
    const asOwn = (context: Parameters<GatewayMediaAttachmentResolver['resolve']>[0]) => {
      if (!('tenantId' in context && 'workspaceId' in context)) throw new ModelGatewayError('FORBIDDEN');
      return { tenantId: context.tenantId, workspaceId: context.workspaceId, actorId: context.actorId };
    };
    const resolve: GatewayMediaAttachmentResolver['resolve'] = async (context, reference, signal) => {
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      const current = await this.resolve(asOwn(context), textProbeRequirements(this.command));
      const image = capability === 'audio' ? audioCapabilityChallenge(this.command.operationId, current.consumerScope.id)
        : visionCapabilityChallenge(this.command.operationId, current.consumerScope.id);
      if (reference.kind !== (capability === 'audio' ? 'audio' : 'image') || reference.attachmentId !== image.attachmentId
        || reference.attachmentRevision !== image.attachmentRevision) throw new ModelGatewayError('FORBIDDEN');
      await this.assertCurrent(asOwn(context), current);
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      const { expected: _, ...result } = image;
      return result;
    };
    return { resolve, assertCurrent: async (context, references, signal) => {
      if (references.length !== 1) throw new ModelGatewayError('FORBIDDEN');
      const reference = references[0], image = await resolve(context, reference, signal);
      if (!image || image.mediaType !== reference.mediaType || image.contentHash !== reference.contentHash) throw new ModelGatewayError('FORBIDDEN');
    } };
  }
  private async current(): Promise<GatewayRoutingResolution> {
    const d = this.dependencies, context = structuredClone(this.context);
    if (isPlatformProbeContext(context)) throw new ModelGatewayError('FORBIDDEN');
    await d.management.authorize(context, 'manage');
    await d.management.authorize(context, 'invoke');
    const selection = await d.configuration.selectionForInvocation(context);
    const resolved = await d.scopes.resolveRoutingScopes(selection.mode);
    const c = resolved.context, scope = resolved.configurationScope;
    if (c.audience !== 'operator' || c.actor.kind !== 'user' || c.actor.userId !== context.actorId
      || c.scope.kind !== 'workspace' || c.scope.tenantId !== context.tenantId || c.scope.workspaceId !== context.workspaceId
      || resolved.consumerScope.kind !== 'WORKSPACE' || resolved.consumerScope.tenantId !== context.tenantId
      || resolved.consumerScope.workspaceId !== context.workspaceId
      || (selection.mode === 'tenant_managed'
        ? scope.kind !== 'TENANT' || scope.tenantId !== context.tenantId
        : scope.kind !== 'PLATFORM' || scope.tenantId !== undefined)) {
      throw new ModelGatewayError('FORBIDDEN');
    }
    const profile = await d.profiles.get(scope, this.command.profileKey);
    if (!profile || !profile.enabled || profile.disabledAt || profile.serviceMode !== selection.mode
      || profile.scopeId !== scope.id || profile.scopeKind !== scope.kind || profile.configRevision !== selection.revision
      || !textProbeRequirements(this.command).every(value => profile.allowedCapabilities.includes(value))
      || capabilityProfileFingerprint(profile) !== this.command.profileFingerprint) {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
    const prepared = textProbeIntent(this.command.operationId, resolved.consumerScope.id, textProbeCapability(this.command));
    const required = textProbeRequirements(this.command);
    return { context: c, consumerScope: resolved.consumerScope, selection, scene: 'chat', requiredCapabilities: required,
      route: { profile, scope, role: profile.role,
        preflight: { allowed: false, required, missing: required, stale: [] },
        probe: { purpose: 'capability_text_probe', operationId: this.command.operationId,
          profileFingerprint: this.command.profileFingerprint, intentHash: prepared.intentHash } } };
  }
  async resolve(value: TextProbeContext, required: readonly AiProfileCapability[]) {
    if (requestFingerprint(value) !== requestFingerprint(this.context)
      || requestFingerprint(required) !== requestFingerprint(textProbeRequirements(this.command))) {
      throw new ModelGatewayError('FORBIDDEN');
    }
    const initial = await this.current(), current = await this.current();
    if (gatewayRoutingBinding(initial) !== gatewayRoutingBinding(current)) throw new ModelGatewayError('CONFIG_INVALID');
    return structuredClone(current);
  }
  async assertCurrent(context: TextProbeContext, resolution: GatewayRoutingResolution) {
    if (gatewayRoutingBinding(await this.resolve(context, textProbeRequirements(this.command))) !== gatewayRoutingBinding(resolution)) throw new ModelGatewayError('CONFIG_INVALID');
  }
  async authorizeDispatch(context: WorkspaceGatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision, mode: 'invoke' | 'stream' = 'invoke', signal = new AbortController().signal) {
    if (mode !== textProbeMode(this.command)) throw new ModelGatewayError('FORBIDDEN');
    const current = await this.resolve(context, textProbeRequirements(this.command));
    const prepared = textProbeIntent(this.command.operationId, current.consumerScope.id, textProbeCapability(this.command));
    const expected = ['vision', 'audio'].includes(textProbeCapability(this.command))
      ? (await prepareGatewayIntent(prepared.intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32 }, mode, context, this.media, signal)).request
      : prepareGatewayTextIntent(prepared.intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32,
        ...(textProbeCapability(this.command) === 'structured_output' ? { structuredOutput: true } : {}),
        ...(textProbeCapability(this.command) === 'tools' ? { orderExplainTool: true } : {}) }, mode).request;
    if (requestFingerprint(request) !== requestFingerprint({ ...expected, model: current.route.profile.model })
      || requestFingerprint(route) !== requestFingerprint(current.route)) throw new ModelGatewayError('FORBIDDEN');
    await this.dependencies.bindings.resolveForReserve(context, { callId: request.callId, model: request.model,
      maxOutputTokens: request.maxOutputTokens, intentHash: prepared.intentHash });
    await this.assertCurrent(context, current);
  }
}
