import type { ModelJsonTransport } from './chat-completions.adapter';
import { ChatCompletionsAdapter } from './chat-completions.adapter';
import { createNativeModelEgressTransport } from './model-egress.transport';
import { RoutedModelTransport, TenantModelConnectionResolver, type GatewayConnectionResolver } from './routed-model-transport';
import { UnifiedAiGatewayService } from './unified-ai-gateway.service';
import { PrismaAdmissionRepository } from './invocation-admission.repository';
import { InvocationAdmissionService } from './invocation-admission.service';
import { InvocationDispatchService } from './invocation-dispatch.service';
import { PrismaProviderProfileRepository } from './provider-profile.repository';
import { PrismaProviderCapabilityEvidenceRepository } from './provider-capability.repository';
import { ProviderCapabilityService } from './provider-capability.service';
import { createPersistedGatewayBudget } from './budget/gateway-budget.composition';
import type { RegisterGatewayInvocation } from './budget/prisma-gateway-invocation-bindings';
import type { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import type { TenantModelConfigService } from './tenant-model-config.service';
import type { AiScopeRepository } from './ai-scope.repository';
import type { UnifiedGatewayAudit } from './unified-ai-gateway.ports';
import { ModelGatewayError, type GatewayContext } from './model-gateway.ports';
import { TextCapabilityProbeAuthority } from './text-capability-probe.authority';
import { createPersistedTextCapabilityEvidence, PrismaTextCapabilityReceiptRepository, type TextProbeReceiptDb } from './prisma-text-capability-receipt.repository';
import { matchesProbeProfile, probeContextSchema, textProbeCommandSchema, textProbeConfiguration, textProbeDescriptorSchema,
  textProbeEvidenceHash, textProbeIntent, TEXT_PROBE_METHOD, TEXT_PROBE_SCENE, type TextProbeCommand } from './text-capability-probe';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import type { PersistedBudgetEvidenceSource } from './budget/budget-dependency-adapters';

export type TextCapabilityProbeDependencies = Omit<Parameters<typeof createPersistedGatewayBudget>[0], 'scopes' | 'db'> & {
  db: Parameters<typeof createPersistedGatewayBudget>[0]['db'] & TextProbeReceiptDb
    & ConstructorParameters<typeof PrismaProviderCapabilityEvidenceRepository>[0];
  scopes: Pick<AiScopeRepository, 'resolveCurrent' | 'resolveRoutingScopes'>;
  management: Pick<TenantModelConfigurationAuthority, 'authorize'>;
  configuration: Pick<TenantModelConfigService, 'selectionForInvocation' | 'profile' | 'credential'>;
  audit: UnifiedGatewayAudit;
  protocol?: ModelJsonTransport;
  /** Existing authorized platform Vault connection, never a tenant fallback.
   * E.g. createAuthorizedPlatformModelConfiguration(...).invocation. */
  platformConnection?: GatewayConnectionResolver;
};
export class TextCapabilityProbeApplication {
  private readonly profiles;
  private readonly receipts;
  /** Same persisted evidence consumer for the ordinary authorized Gateway. */
  readonly capabilities: ProviderCapabilityService;
  /** Read-only evidence from the SAME accounting facts as this Gateway ledger.
   * Runner consumers cannot substitute a different success/dispatch source. */
  readonly financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  private readonly accounting;
  private readonly admission;
  private readonly dispatch;
  private readonly adapter;
  constructor(private readonly input: TextCapabilityProbeDependencies) {
    if (!input || [input.management?.authorize, input.scopes?.resolveCurrent, input.scopes?.resolveRoutingScopes,
      input.configuration?.selectionForInvocation, input.configuration?.profile, input.configuration?.credential,
      input.authorization?.resolveContext, input.authorization?.authorize, input.subscriptions?.readCategoryCommercialContext,
      input.pricing?.quote, input.pricing?.quantity, input.audit?.append].some(method => typeof method !== 'function')) {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
    this.profiles = new PrismaProviderProfileRepository(input.db);
    this.receipts = new PrismaTextCapabilityReceiptRepository(input.db, input.clock);
    this.capabilities = createPersistedTextCapabilityEvidence(input.db, input.clock);
    this.accounting = createPersistedGatewayBudget(input);
    this.financialEvidence = Object.freeze({ readDispatch: (reservationId: string) =>
      this.accounting.facts.readDispatch(reservationId) });
    const admissions = new PrismaAdmissionRepository(input.db);
    this.admission = new InvocationAdmissionService(admissions, input.clock);
    this.dispatch = new InvocationDispatchService(admissions);
    this.adapter = new ChatCompletionsAdapter(input.protocol ?? createNativeModelEgressTransport());
  }
  private authority(context: GatewayContext, command: TextProbeCommand) {
    return new TextCapabilityProbeAuthority({ management: this.input.management, scopes: this.input.scopes,
      configuration: this.input.configuration, profiles: this.profiles, bindings: this.accounting.bindings }, context, command);
  }
  private requirePlatformConnection(mode: string) {
    if (mode === 'platform_managed' && typeof this.input.platformConnection?.resolve !== 'function') {
      throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE');
    }
  }
  /** Request hosts do not supply actor/tenant/workspace fields. The same real
   * scope authority used by budget resolves them afresh for every operation. */
  private async currentRequest() {
    const resolved = structuredClone(await this.input.scopes.resolveCurrent());
    const { context, scope } = resolved;
    if (context.actor.kind !== 'user' || !['operator', 'staff'].includes(context.audience)
      || context.scope.kind !== 'workspace' || scope.kind !== 'WORKSPACE'
      || context.scope.tenantId !== scope.tenantId || context.scope.workspaceId !== scope.workspaceId) {
      throw new ModelGatewayError('FORBIDDEN');
    }
    const { requestId: _, authorizedAt: __, ...identity } = context;
    return { context: probeContextSchema.parse({ tenantId: scope.tenantId, workspaceId: scope.workspaceId,
      actorId: context.actor.userId }), binding: requestFingerprint({ identity, scope }) };
  }
  private async forCurrentRequest<T>(operation: (context: GatewayContext) => Promise<T>): Promise<T> {
    const before = await this.currentRequest();
    const result = await operation(before.context);
    if ((await this.currentRequest()).binding !== before.binding) throw new ModelGatewayError('FORBIDDEN');
    return result;
  }
  prepareCurrent(command: TextProbeCommand) {
    const snapshot = textProbeCommandSchema.parse(structuredClone(command));
    return this.forCurrentRequest(context => this.prepare(context, snapshot));
  }
  reconcileCurrent(command: TextProbeCommand) {
    const snapshot = textProbeCommandSchema.parse(structuredClone(command));
    return this.forCurrentRequest(context => this.reconcile(context, snapshot));
  }
  preflightCurrent(command: TextProbeCommand) {
    const snapshot = textProbeCommandSchema.parse(structuredClone(command));
    return this.forCurrentRequest(context => this.preflight(context, snapshot));
  }
  /** Server-only held-step entry. Execution comes from the original runner;
   * it must never be deserialized from an HTTP request body. Registration below
   * checks persisted ownership, fencing, expiry and the exact frozen intent. */
  runHeldCurrent(command: TextProbeCommand,
    execution: Pick<RegisterGatewayInvocation, 'stepId' | 'lease' | 'priceVersion' | 'expiresAt'>, signal?: AbortSignal) {
    const snapshot = textProbeCommandSchema.parse(structuredClone(command)), held = structuredClone(execution);
    return this.forCurrentRequest(context => this.run(context, snapshot, held, signal));
  }
  async prepare(value: GatewayContext, commandValue: TextProbeCommand) {
    const context = probeContextSchema.parse(structuredClone(value)), command = textProbeCommandSchema.parse(structuredClone(commandValue));
    const authority = this.authority(context, command), resolution = await authority.resolve(context, ['text']);
    this.requirePlatformConnection(resolution.route.profile.serviceMode);
    const prepared = textProbeIntent(command.operationId, resolution.consumerScope.id);
    return { ...prepared, configuration: textProbeConfiguration(resolution.route.profile, context.tenantId) };
  }
  private async collect(context: GatewayContext, command: TextProbeCommand) {
    const authority = this.authority(context, command), resolution = await authority.resolve(context, ['text']);
    const row = await this.receipts.find(resolution.consumerScope.id, command.operationId);
    if (!row) return { capability: 'text' as const, status: 'unverified' as const, reason: 'receipt_unavailable' };
    const descriptor = row.descriptor, profile = resolution.route.profile;
    if (requestFingerprint(descriptor.context) !== requestFingerprint(context) || !matchesProbeProfile(descriptor, profile)) throw new ModelGatewayError('FORBIDDEN');
    await authority.assertCurrent(context, resolution);
    if (!row.observation) return { capability: 'text' as const, status: 'unverified' as const, receiptId: row.id, reason: 'original_receipt_pending' };
    const observation = row.observation;
    const candidate = { profile, capability: 'text' as const,
      status: observation.transport === 'node_https' && observation.matched ? 'supported' as const : 'unverified' as const,
      source: 'connection_test' as const, evidenceHash: textProbeEvidenceHash(row), checkedAt: new Date(observation.checkedAt),
      expiresAt: new Date(observation.expiresAt), details: { receiptId: row.id, verification: {
        evidence: observation.transport === 'node_https' ? 'live' : 'mock', methodVersion: TEXT_PROBE_METHOD,
        capability: 'text', profileFingerprint: descriptor.profileFingerprint
      } } };
    if (candidate.status === 'supported' && !await this.receipts.verify(candidate)) {
      return { capability: 'text' as const, status: 'unverified' as const, receiptId: row.id, reason: 'original_receipt_pending' };
    }
    const saved = await this.capabilities.record(candidate);
    await authority.assertCurrent(context, resolution);
    return { capability: 'text' as const, status: saved.status, receiptId: row.id, evidenceHash: saved.evidenceHash };
  }
  async run(value: GatewayContext, commandValue: TextProbeCommand,
    execution: Pick<RegisterGatewayInvocation, 'stepId' | 'lease' | 'priceVersion' | 'expiresAt'>, signal?: AbortSignal) {
    const context = probeContextSchema.parse(structuredClone(value)), command = textProbeCommandSchema.parse(structuredClone(commandValue));
    execution = structuredClone(execution);
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    const authority = this.authority(context, command), resolution = await authority.resolve(context, ['text']);
    const prepared = textProbeIntent(command.operationId, resolution.consumerScope.id), profile = resolution.route.profile;
    const configuration = textProbeConfiguration(profile, context.tenantId);
    const descriptor = textProbeDescriptorSchema.parse({ command, context, scopeId: resolution.consumerScope.id, profileId: profile.id,
      profileFingerprint: command.profileFingerprint, methodVersion: TEXT_PROBE_METHOD, callId: prepared.intent.requestId,
      intentHash: prepared.intentHash, challengeHash: prepared.challengeHash, configuration,
      configurationHash: requestFingerprint(configuration), stepId: execution.stepId, runId: execution.lease.runId });
    // An original receipt is observational only, never permission to dispatch
    // again. In particular, a retry must not need a still-active old lease.
    const existing = await this.receipts.find(resolution.consumerScope.id, command.operationId);
    if (existing) return this.collect(context, command);
    this.requirePlatformConnection(profile.serviceMode);
    // Validate and persist the real task/step/lease association before reserving
    // the probe operation key. A rejected execution must not poison that key.
    const registered = await this.accounting.bindings.register({ ...execution, intent: prepared.intent, configuration, mode: 'invoke' });
    // Registration may have committed before its response (or the probe receipt)
    // was lost. Re-reading that association cannot reacquire dispatch permission.
    if (registered.replayed) return this.collect(context, command);
    const started = await this.receipts.begin(descriptor);
    if (!started.created) return this.collect(context, command);
    await authority.assertCurrent(context, resolution);
    const tenant = new TenantModelConnectionResolver(this.input.configuration);
    const platform = this.input.platformConnection ?? { resolve: async () => { throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE'); } };
    const transport = new RoutedModelTransport({ tenant, platform }, [this.adapter], authority);
    const gateway = new UnifiedAiGatewayService({ routing: authority, admission: this.admission, dispatch: this.dispatch,
      budget: this.accounting.budget, transport, audit: this.input.audit,
      observation: { record: observation => this.receipts.observe(started.receipt.id, observation,
        this.adapter.evidenceMode === 'live' ? 'node_https' : 'mock') }
    }, 30000, { sceneCode: TEXT_PROBE_SCENE, routeScene: 'chat', maxOutputTokens: 32 });
    try { await gateway.invokeTextIntent(context, prepared.intent, signal); }
    catch (error) {
      if (signal?.aborted || error instanceof ModelGatewayError && error.code === 'FORBIDDEN') throw error;
      await authority.assertCurrent(context, resolution);
      return { ...await this.collect(context, command), errorCode: error instanceof ModelGatewayError ? error.code : 'ACCOUNTING_PENDING' };
    }
    return this.collect(context, command);
  }
  async reconcile(context: GatewayContext, command: TextProbeCommand) {
    return this.collect(probeContextSchema.parse(structuredClone(context)), textProbeCommandSchema.parse(structuredClone(command)));
  }
  async preflight(context: GatewayContext, command: TextProbeCommand) {
    context = probeContextSchema.parse(structuredClone(context));
    command = textProbeCommandSchema.parse(structuredClone(command));
    const authority = this.authority(context, command), current = await authority.resolve(context, ['text']);
    const result = await this.capabilities.preflight(current.route.profile, ['text']);
    await authority.assertCurrent(context, current);
    return result;
  }
}
