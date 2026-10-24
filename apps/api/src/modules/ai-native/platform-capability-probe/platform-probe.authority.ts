import type { ProviderProfileRepository, AiProfileCapability } from '../provider-profile.ports';
import type { ProviderRouteDecision } from '../provider-router.ports';
import type { PrismaGatewayInvocationBindings } from '../budget/prisma-gateway-invocation-bindings';
import type { PlatformModelConfigurationAuthority } from '../platform-model-config.authority';
import type { GatewayRoutingResolution } from '../gateway-routing.service';
import { gatewayRoutingBinding } from '../gateway-routing.service';
import { ModelGatewayError, type GatewayContext, type ModelProtocolRequest } from '../model-gateway.ports';
import { capabilityProfileFingerprint } from '../capability-verification';
import { prepareGatewayTextIntent, prepareGatewayIntent, type GatewayMediaAttachmentResolver } from '../gateway-intent';
import { visionCapabilityChallenge } from '../vision-capability-challenge';
import { audioCapabilityChallenge } from '../audio-capability-challenge';
import { textProbeCommandSchema, textProbeIntent, textProbeCapability, textProbeMode, textProbeRequirements,
  isPlatformProbeContext, TEXT_PROBE_SCENE, type TextProbeCommand, type TextProbeContext } from '../text-capability-probe';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

export interface PlatformProbeAuthorityDependencies {
  /** Real platform Guard bound to the ONE server-fixed Profile resource. */
  management: PlatformModelConfigurationAuthority;
  scopes: Pick<import('../ai-scope.repository').AiScopeRepository, 'resolveRoutingScopes'>;
  profiles: Pick<ProviderProfileRepository, 'get'>;
  bindings: Pick<PrismaGatewayInvocationBindings, 'resolveForReserve'>;
  /** Server-fixed at composition; requests and models never choose it. */
  profileId: string;
}

/** Route authority for the SaaS platform capability probe. The server-fixed
 * platform Profile replaces the tenant configuration selection; every resolve
 * re-runs the real platform management Guard and re-reads the profile, so a
 * revoked SaaS admin or a rotated/removed profile fails the same binding. */
export class PlatformCapabilityProbeAuthority {
  private readonly command: TextProbeCommand;
  private readonly context: { actorId: string; scopeKind: 'platform' };
  constructor(private readonly dependencies: PlatformProbeAuthorityDependencies, context: TextProbeContext, command: TextProbeCommand) {
    const parsed = structuredClone(context);
    if (!isPlatformProbeContext(parsed)) throw new ModelGatewayError('FORBIDDEN');
    this.context = parsed;
    this.command = structuredClone(command);
    textProbeCommandSchema.parse(this.command);
    if (!/^[A-Za-z0-9][\w.:-]{0,35}$/u.test(dependencies?.profileId ?? '')) throw new ModelGatewayError('CONFIG_INVALID');
  }
  /** Only this server-created immutable challenge, never an uploaded file ACL
   * bypass. Business attachment references are not accepted by this resolver. */
  get media(): GatewayMediaAttachmentResolver | undefined {
    const capability = textProbeCapability(this.command);
    if (capability !== 'vision' && capability !== 'audio') return undefined;
    const resolve: GatewayMediaAttachmentResolver['resolve'] = async (context, reference, signal) => {
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      const current = await this.resolve(this.platformContext(context), textProbeRequirements(this.command));
      const image = capability === 'audio' ? audioCapabilityChallenge(this.command.operationId, current.consumerScope.id)
        : visionCapabilityChallenge(this.command.operationId, current.consumerScope.id);
      if (reference.kind !== (capability === 'audio' ? 'audio' : 'image') || reference.attachmentId !== image.attachmentId
        || reference.attachmentRevision !== image.attachmentRevision) throw new ModelGatewayError('FORBIDDEN');
      await this.assertCurrent(this.platformContext(context), current);
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
  private platformContext(context: GatewayContext | TextProbeContext) {
    const actorId = this.context.actorId;
    if (context.actorId !== actorId) throw new ModelGatewayError('FORBIDDEN');
    return { actorId, scopeKind: 'platform' as const };
  }
  private async current(): Promise<GatewayRoutingResolution> {
    const d = this.dependencies;
    // Management is the real platform PUT Guard over the fixed Profile;
    // invocation identity is the dual-read platform scope resolution below.
    await d.management.manage(d.profileId);
    const resolved = structuredClone(await d.scopes.resolveRoutingScopes('platform_managed'));
    const c = resolved.context, scope = resolved.configurationScope;
    if (c.audience !== 'operator' || c.actor.kind !== 'saas_admin' || c.actor.userId !== this.context.actorId
      || c.scope.kind !== 'platform'
      || resolved.consumerScope.kind !== 'PLATFORM' || resolved.consumerScope.id !== scope.id
      || scope.kind !== 'PLATFORM') throw new ModelGatewayError('FORBIDDEN');
    const profile = await d.profiles.get(scope, this.command.profileKey);
    if (!profile || !profile.enabled || profile.disabledAt || profile.serviceMode !== 'platform_managed'
      || profile.scopeId !== scope.id || profile.scopeKind !== 'PLATFORM'
      || profile.id !== d.profileId
      || !textProbeRequirements(this.command).every(value => profile.allowedCapabilities.includes(value))
      || capabilityProfileFingerprint(profile) !== this.command.profileFingerprint) throw new ModelGatewayError('CONFIG_INVALID');
    const prepared = textProbeIntent(this.command.operationId, resolved.consumerScope.id, textProbeCapability(this.command));
    const required = textProbeRequirements(this.command);
    return { context: c, consumerScope: resolved.consumerScope,
      selection: { mode: 'platform_managed' as const, revision: profile.configRevision },
      scene: 'chat', requiredCapabilities: required,
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
  async authorizeDispatch(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision, mode: 'invoke' | 'stream' = 'invoke', signal = new AbortController().signal) {
    if (mode !== textProbeMode(this.command)) throw new ModelGatewayError('FORBIDDEN');
    const current = await this.resolve(this.platformContext(context), textProbeRequirements(this.command));
    const prepared = textProbeIntent(this.command.operationId, current.consumerScope.id, textProbeCapability(this.command));
    const expected = ['vision', 'audio'].includes(textProbeCapability(this.command))
      ? (await prepareGatewayIntent(prepared.intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32 }, mode,
        // The intent preparer only forwards this context to the media resolver,
        // which is this class's own platform-shaped resolver above.
        current.context as unknown as GatewayContext, this.media, signal)).request
      : prepareGatewayTextIntent(prepared.intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32,
        ...(textProbeCapability(this.command) === 'structured_output' ? { structuredOutput: true } : {}),
        ...(textProbeCapability(this.command) === 'tools' ? { orderExplainTool: true } : {}) }, mode).request;
    if (requestFingerprint(request) !== requestFingerprint({ ...expected, model: current.route.profile.model })
      || requestFingerprint(route) !== requestFingerprint(current.route)) throw new ModelGatewayError('FORBIDDEN');
    await this.dependencies.bindings.resolveForReserve({ actorId: context.actorId }, { callId: request.callId, model: request.model,
      maxOutputTokens: request.maxOutputTokens, intentHash: prepared.intentHash });
    await this.assertCurrent(this.platformContext(context), current);
  }
}
