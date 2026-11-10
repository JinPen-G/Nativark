import type { ModelJsonTransport } from './chat-completions.adapter';
import { createNativeModelAdapter } from './native-model-adapters';
import { createNativeModelEgressTransport } from './model-egress.transport';
import { RoutedModelTransport, TenantModelConnectionResolver, type GatewayConnectionResolver } from './routed-model-transport';
import { PublicAiGatewayService } from './public-ai-gateway.service';
import { AI_TOOL_DRAFT_VERSION, type AiGatewayResultDraft } from '@rental-os/shared';
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
import { ModelGatewayError, modelAdapterSupportsCapabilities, type GatewayContext } from './model-gateway.ports';
import { TextCapabilityProbeAuthority } from './text-capability-probe.authority';
import { createPersistedTextCapabilityEvidence, PrismaTextCapabilityReceiptRepository, type TextProbeReceiptDb } from './prisma-text-capability-receipt.repository';
import { matchesProbeProfile, probeContextSchema, textProbeCommandSchema, textProbeConfiguration, textProbeDescriptorSchema,
  textProbeEvidenceHash, textProbeIntent, textProbePreparation, hasObjectiveProbeMethod, textProbeCapability, textProbeMethod, textProbeMode, textProbeRequirements, textProbeRouteScene, textProbeProfileIdSchema, textProbeExecutionProtocol, canExecuteTextProbe,
  isPlatformProbeContext, TEXT_PROBE_SCENE, type TextProbeCommand, type TextProbeCapability, type TextProbeContext } from './text-capability-probe';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { capabilityProfileFingerprint } from './capability-verification';
import type { PersistedBudgetEvidenceSource } from './budget/budget-dependency-adapters';
import { PrismaTaskGatewayAudit } from './prisma-task-gateway-audit';

export type TextCapabilityProbeDependencies = Omit<Parameters<typeof createPersistedGatewayBudget>[0], 'scopes' | 'db'> & {
  db: Parameters<typeof createPersistedGatewayBudget>[0]['db'] & TextProbeReceiptDb
    & ConstructorParameters<typeof PrismaProviderCapabilityEvidenceRepository>[0]
    & Pick<import('@prisma/client').PrismaClient, 'aiTaskExecutionCharge' | 'operationLog'>;
  scopes: Pick<AiScopeRepository, 'resolveCurrent' | 'resolveRoutingScopes'>;
  management: Pick<TenantModelConfigurationAuthority, 'authorize'>;
  configuration: Pick<TenantModelConfigService, 'selectionForInvocation' | 'profile' | 'credential'>;
  audit?: UnifiedGatewayAudit;
  /** Server-only assembly after the original task charge is resolved. The
   * producer shares this application's accounting facts, never another ledger. */
  auditForTask?: (taskId: string, facts: ReturnType<typeof createPersistedGatewayBudget>['facts']) => UnifiedGatewayAudit;
  protocol?: ModelJsonTransport;
  /** Existing authorized platform Vault connection, never a tenant fallback.
   * E.g. createAuthorizedPlatformModelConfiguration(...).invocation. */
  platformConnection?: GatewayConnectionResolver;
  /** Optional server-bound identity/authority port for the explicit SaaS
   * platform principal. Absent keeps the workspace operator/staff behaviour;
   * a present port replaces ONLY current-identity resolution and route
   * authority, never the Gateway, ledger, receipts or task engine. */
  identity?: TextCapabilityProbeIdentityPort;
};

/** Structural authority contract shared by the workspace and platform hosts. */
export interface TextCapabilityProbeAuthorityPort {
  resolve(value: TextProbeContext, required: readonly import('./provider-profile.ports').AiProfileCapability[]): Promise<import('./gateway-routing.service').GatewayRoutingResolution>;
  assertCurrent(context: TextProbeContext, resolution: import('./gateway-routing.service').GatewayRoutingResolution): Promise<void>;
  authorizeDispatch(context: import('./model-gateway.ports').GatewayContext, request: import('./model-gateway.ports').ModelProtocolRequest,
    route: import('./provider-router.ports').ProviderRouteDecision, mode?: 'invoke' | 'stream', signal?: AbortSignal): Promise<void>;
  readonly media?: import('./gateway-intent').GatewayMediaAttachmentResolver | undefined;
}
export interface TextCapabilityProbeIdentityPort {
  currentRequest(): Promise<{ context: TextProbeContext; binding: string }>;
  authority(context: TextProbeContext, command: TextProbeCommand): TextCapabilityProbeAuthorityPort;
}
export class TextCapabilityProbeApplication {
  private readonly profiles;
  private readonly receipts;
  /** Same persisted evidence consumer for the ordinary authorized Gateway. */
  readonly capabilities: ProviderCapabilityService;
  /** Read-only evidence from the SAME accounting facts as this Gateway ledger.
   * Runner consumers cannot substitute a different success/dispatch source. */
  readonly financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  /** Original-key recovery from the SAME ledger and current principal. This
   * port grants no reserve, runner claim or replacement provider dispatch. */
  readonly financialRecovery: ReturnType<typeof createPersistedGatewayBudget>['recovery'];
  private readonly accounting;
  private readonly admission;
  private readonly dispatch;
  private readonly protocol: ModelJsonTransport;
  constructor(private readonly input: TextCapabilityProbeDependencies) {
    if (!input || [input.management?.authorize, input.scopes?.resolveCurrent, input.scopes?.resolveRoutingScopes,
      input.configuration?.selectionForInvocation, input.configuration?.profile, input.configuration?.credential,
      input.authorization?.resolveContext, input.authorization?.authorize, input.subscriptions?.readCategoryCommercialContext,
      input.pricing?.quote, input.pricing?.quantity].some(method => typeof method !== 'function')
      || input.audit !== undefined && typeof input.audit?.append !== 'function'
      || input.auditForTask !== undefined && typeof input.auditForTask !== 'function'
      || input.audit === undefined && input.auditForTask === undefined && (typeof input.db.operationLog?.create !== 'function'
        || typeof input.db.operationLog.findUnique !== 'function')) {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
    this.profiles = new PrismaProviderProfileRepository(input.db);
    this.receipts = new PrismaTextCapabilityReceiptRepository(input.db, input.clock);
    this.capabilities = createPersistedTextCapabilityEvidence(input.db, input.clock);
    this.accounting = createPersistedGatewayBudget(input);
    this.financialRecovery = this.accounting.recovery;
    this.financialEvidence = Object.freeze({ readDispatch: (reservationId: string) =>
      this.accounting.facts.readDispatch(reservationId) });
    const admissions = new PrismaAdmissionRepository(input.db);
    this.admission = new InvocationAdmissionService(admissions, input.clock);
    this.dispatch = new InvocationDispatchService(admissions);
    this.protocol = input.protocol ?? createNativeModelEgressTransport();
  }
  private adapter(protocol: string, command: TextProbeCommand, scopeId: string) {
    const prepared = textProbeIntent(command.operationId, scopeId, textProbeCapability(command));
    const adapter = createNativeModelAdapter(protocol,
      textProbeCapability(command) === 'embedding' ? { embeddingProbe: true } : textProbeCapability(command) === 'structured_output' ? { structuredOutput: {
        name: 'rental_capability_token', schema: { type: 'object', properties: { token: { type: 'string', maxLength: 22,
          const: (JSON.parse(prepared.expected) as { token: string }).token } }, required: ['token'], additionalProperties: false } } }
        : textProbeCapability(command) === 'tools' ? { orderExplainTool: { name: 'rental_order_explain', version: AI_TOOL_DRAFT_VERSION } }
          : { mediaInput: ['image', 'audio'] }, this.protocol);
    if (!modelAdapterSupportsCapabilities(adapter, textProbeRequirements(command))) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return adapter;
  }
  private authority(context: TextProbeContext, command: TextProbeCommand): TextCapabilityProbeAuthorityPort {
    if (this.input.identity) return this.input.identity.authority(context, command);
    return new TextCapabilityProbeAuthority({ management: this.input.management, scopes: this.input.scopes,
      configuration: this.input.configuration, profiles: this.profiles, bindings: this.accounting.bindings }, context, command);
  }
  private requirePlatformConnection(mode: string) {
    if (mode === 'platform_managed' && typeof this.input.platformConnection?.resolve !== 'function') {
      throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE');
    }
  }
  /** Request hosts do not supply actor/tenant/workspace fields. The same real
   * scope authority used by budget resolves them afresh for every operation;
   * the injected platform identity port resolves the SaaS principal instead. */
  private async currentRequest(): Promise<{ context: TextProbeContext; binding: string }> {
    if (this.input.identity) {
      const resolved = structuredClone(await this.input.identity.currentRequest());
      probeContextSchema.parse(resolved.context);
      if (typeof resolved.binding !== 'string' || !resolved.binding) throw new ModelGatewayError('FORBIDDEN');
      return resolved;
    }
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
  private async forCurrentRequest<T>(operation: (context: TextProbeContext) => Promise<T>): Promise<T> {
    const before = await this.currentRequest();
    const result = await operation(before.context);
    if ((await this.currentRequest()).binding !== before.binding) throw new ModelGatewayError('FORBIDDEN');
    return result;
  }
  /** Management request preparation is metadata-only. The request key never
   * chooses a model/profile; the platform ID is fixed by the server factory.
   * Persist this command once, then read it back instead of preparing on retry. */
  prepareRequestCurrent(requestKey: string, platformProfileId: string, capability: TextProbeCapability = 'text') {
    if (!textProbeCommandSchema.shape.capability.unwrap().safeParse(capability).success) throw new ModelGatewayError('INVALID_REQUEST');
    const key = textProbeCommandSchema.shape.operationId.parse(requestKey);
    const platformId = textProbeProfileIdSchema.parse(platformProfileId);
    return this.forCurrentRequest(async context => {
      // Workspace-only preparation flow: it selects the tenant configuration.
      // The platform principal prepares through its own composition instead.
      if (isPlatformProbeContext(context)) throw new ModelGatewayError('FORBIDDEN');
      await this.input.management.authorize(context, 'manage');
      const selection = await this.input.configuration.selectionForInvocation(context);
      const resolved = await this.input.scopes.resolveRoutingScopes(selection.mode);
      const candidates = (await this.profiles.list(resolved.configurationScope)).filter(profile =>
        profile.enabled && !profile.disabledAt && (capability === 'embedding' || profile.allowedCapabilities.includes('text'))
        && profile.serviceMode === selection.mode && profile.configRevision === selection.revision
        && (selection.mode === 'platform_managed' ? profile.id === platformId : profile.role === 'DEFAULT'));
      if (candidates.length !== 1) throw new ModelGatewayError('CONFIG_INVALID');
      const profile = candidates[0];
      const command = textProbeCommandSchema.parse({ operationId: `text-probe:${requestFingerprint({ requestKey: key, context })}`,
        profileKey: profile.profileKey, profileFingerprint: capabilityProfileFingerprint(profile),
        ...(capability !== 'text' ? { capability } : {}) });
      // The existing authority rechecks selection, scope, config revision and
      // enabled/text policy. No configuration credential() or Vault read here.
      const prepared = await this.prepare(context, command);
      return { command, capability, configurationRevision: prepared.configuration.configRevision, methodVersion: textProbeMethod(command, prepared.intent ? prepared.configuration.protocol : undefined) };
    });
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
  /** First registration ownership stays in this request-local closure, never a
   * serialized task field/dispatch permit. Lost registration replies or worker
   * restarts cannot reconstruct it by reading the invocation. Gateway admission
   * and financial/task resource gates still own actual dispatch authorization. */
  async prepareHeldInvocationCurrent(commandValue: TextProbeCommand,
    executionValue: Pick<RegisterGatewayInvocation, 'stepId' | 'lease' | 'priceVersion' | 'expiresAt'>) {
    const command = textProbeCommandSchema.parse(structuredClone(commandValue)), execution = structuredClone(executionValue);
    const owner = await this.currentRequest();
    const prepared = await this.prepare(owner.context, command);
    // Metadata-only unavailable selections cannot acquire an invocation or task
    // charge, even through this server-only held-step entry.
    if (!prepared.intent) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const registered = structuredClone(await this.accounting.bindings.register({ ...execution,
      intent: prepared.intent, configuration: prepared.configuration, mode: textProbeMode(command) }));
    if (registered.replayed) throw new ModelGatewayError('ACCOUNTING_PENDING');
    if ((await this.currentRequest()).binding !== owner.binding) throw new ModelGatewayError('FORBIDDEN');
    let used = false;
    return Object.freeze({ invocationId: registered.id, execute: async (signal?: AbortSignal) => {
      if (used) throw new ModelGatewayError('ACCOUNTING_PENDING');
      used = true; // consume before the first await, including failed execution
      if ((await this.currentRequest()).binding !== owner.binding) throw new ModelGatewayError('FORBIDDEN');
      let result: AiGatewayResultDraft | undefined;
      await this.forCurrentRequest(context => this.#runRegistered(context, command, execution, signal, registered.id,
        observed => { result = structuredClone(observed); }));
      if (!result) throw new ModelGatewayError('ACCOUNTING_PENDING');
      return result;
    } });
  }
  async prepare(value: TextProbeContext, commandValue: TextProbeCommand) {
    const context = probeContextSchema.parse(structuredClone(value)), command = textProbeCommandSchema.parse(structuredClone(commandValue));
    const authority = this.authority(context, command), resolution = await authority.resolve(context, textProbeRequirements(command));
    if (canExecuteTextProbe(command, resolution.route.profile)) {
      this.adapter(resolution.route.profile.protocol, command, resolution.consumerScope.id);
      this.requirePlatformConnection(resolution.route.profile.serviceMode);
    } else await authority.assertCurrent(context, resolution);
    const prepared = textProbePreparation(command.operationId, resolution.consumerScope.id, textProbeCapability(command), textProbeExecutionProtocol(command, resolution.route.profile));
    return { ...prepared, configuration: textProbeConfiguration(resolution.route.profile,
      isPlatformProbeContext(context) ? { kind: 'platform' } : { kind: 'workspace', tenantId: context.tenantId }) };
  }
  private async collect(context: TextProbeContext, command: TextProbeCommand) {
    const capability = textProbeCapability(command);
    const authority = this.authority(context, command), resolution = await authority.resolve(context, textProbeRequirements(command));
    if (!canExecuteTextProbe(command, resolution.route.profile)) {
      await authority.assertCurrent(context, resolution);
      return { capability, status: 'unverified' as const, reason: hasObjectiveProbeMethod(capability, resolution.route.profile.protocol)
        ? 'capability_not_enabled' : 'objective_method_unavailable', observation: null };
    }
    const row = await this.receipts.find(resolution.consumerScope.id, command.operationId);
    if (!row) return { capability, status: 'unverified' as const, reason: 'receipt_unavailable' };
    const descriptor = row.descriptor, profile = resolution.route.profile;
    if (requestFingerprint(descriptor.context) !== requestFingerprint(context)
      || requestFingerprint(descriptor.command) !== requestFingerprint(command)
      || !matchesProbeProfile(descriptor, profile)) throw new ModelGatewayError('FORBIDDEN');
    await authority.assertCurrent(context, resolution);
    if (!row.observation) return { capability, status: 'unverified' as const, receiptId: row.id, reason: 'original_receipt_pending' };
    const observation = row.observation;
    const observed = { methodVersion: descriptor.methodVersion,
      mode: observation.transport === 'node_https' ? 'live' as const : 'mock' as const,
      configurationRevision: profile.configRevision, checkedAt: observation.checkedAt, expiresAt: observation.expiresAt };
    const candidate = { profile, capability,
      status: observation.transport === 'node_https' && observation.matched ? 'supported' as const : 'unverified' as const,
      source: 'connection_test' as const, evidenceHash: textProbeEvidenceHash(row), checkedAt: new Date(observation.checkedAt),
      expiresAt: new Date(observation.expiresAt), details: { receiptId: row.id, verification: {
        evidence: observation.transport === 'node_https' ? 'live' : 'mock', methodVersion: textProbeMethod(command, profile.protocol),
        capability, profileFingerprint: descriptor.profileFingerprint
      } } };
    if (candidate.status === 'supported' && !await this.receipts.verify(candidate)) {
      return { capability, status: 'unverified' as const, receiptId: row.id, reason: 'original_receipt_pending', observation: observed };
    }
    let saved: Awaited<ReturnType<ProviderCapabilityService['record']>>;
    try { saved = await this.capabilities.record(candidate); }
    catch {
      // The shared service collapses storage/commit uncertainty to CONFIG_INVALID.
      // Recheck config outside that write boundary, then conservatively require
      // the original receipt again; never claim the evidence write did not commit.
      await authority.assertCurrent(context, resolution);
      throw new ModelGatewayError('ACCOUNTING_PENDING');
    }
    await authority.assertCurrent(context, resolution);
    return { capability, status: saved.status, receiptId: row.id, evidenceHash: saved.evidenceHash, observation: observed };
  }
  async run(value: TextProbeContext, commandValue: TextProbeCommand,
    execution: Pick<RegisterGatewayInvocation, 'stepId' | 'lease' | 'priceVersion' | 'expiresAt'>, signal?: AbortSignal) {
    return this.#runRegistered(value, commandValue, execution, signal);
  }
  async #runRegistered(value: TextProbeContext, commandValue: TextProbeCommand,
    execution: Pick<RegisterGatewayInvocation, 'stepId' | 'lease' | 'priceVersion' | 'expiresAt'>,
    signal?: AbortSignal, ownedInvocationId?: string, observedResult?: (result: AiGatewayResultDraft) => void) {
    const context = probeContextSchema.parse(structuredClone(value)), command = textProbeCommandSchema.parse(structuredClone(commandValue));
    execution = structuredClone(execution);
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    const authority = this.authority(context, command), resolution = await authority.resolve(context, textProbeRequirements(command));
    if (!canExecuteTextProbe(command, resolution.route.profile)) return this.collect(context, command);
    const prepared = textProbeIntent(command.operationId, resolution.consumerScope.id, textProbeCapability(command)), profile = resolution.route.profile;
    // Refuse an absent local protocol capability before registration, receipt
    // creation or a budget/dispatch attempt; remote proof cannot add audio.
    const adapter = this.adapter(profile.protocol, command, resolution.consumerScope.id);
    const configuration = textProbeConfiguration(profile, isPlatformProbeContext(context) ? { kind: 'platform' } : { kind: 'workspace', tenantId: context.tenantId });
    const descriptor = textProbeDescriptorSchema.parse({ command, context, scopeId: resolution.consumerScope.id, profileId: profile.id,
      profileFingerprint: command.profileFingerprint, methodVersion: textProbeMethod(command, profile.protocol), callId: prepared.intent.requestId,
      intentHash: prepared.intentHash, challengeHash: prepared.challengeHash, configuration,
      configurationHash: requestFingerprint(configuration), stepId: execution.stepId, runId: execution.lease.runId });
    // An original receipt is observational only, never permission to dispatch
    // again. In particular, a retry must not need a still-active old lease.
    const existing = await this.receipts.find(resolution.consumerScope.id, command.operationId);
    if (existing) return this.collect(context, command);
    this.requirePlatformConnection(profile.serviceMode);
    // Validate and persist the real task/step/lease association before reserving
    // the probe operation key. A rejected execution must not poison that key.
    const registered = ownedInvocationId ? { id: ownedInvocationId, replayed: false }
      : await this.accounting.bindings.register({ ...execution, intent: prepared.intent, configuration, mode: textProbeMode(command) });
    // Registration may have committed before its response (or the probe receipt)
    // was lost. Re-reading that association cannot reacquire dispatch permission.
    if (registered.replayed) return this.collect(context, command);
    // Registration alone is not a runner resource admission. Require the
    // already reserved original model-call charge, under this exact holder.
    const charges = await this.input.db.aiTaskExecutionCharge.findMany({ where: {
      scopeId: descriptor.scopeId, runId: execution.lease.runId, stepId: execution.stepId,
      gatewayInvocationId: registered.id, resource: 'CALLS', status: 'RESERVED', amount: 1n,
      leaseOwnerId: execution.lease.holderId, fencingToken: execution.lease.fencingToken,
    }, take: 2 });
    if (charges.length !== 1) throw new ModelGatewayError('BUDGET_UNAVAILABLE');
    const started = await this.receipts.begin(descriptor);
    if (!started.created) return this.collect(context, command);
    await authority.assertCurrent(context, resolution);
    // Platform hosts assemble their own producer against the SAME accounting
    // facts and persisted task charge. Direct callers without it still fail
    // closed before admission/reserve; a workspace journal is never a fallback.
    const audit = this.input.audit ?? this.input.auditForTask?.(charges[0].taskId, this.accounting.facts);
    if (audit !== undefined && typeof audit?.append !== 'function'
      || isPlatformProbeContext(context) && audit === undefined) throw new ModelGatewayError('CONFIG_INVALID');
    const tenant = new TenantModelConnectionResolver(this.input.configuration);
    const platform = this.input.platformConnection ?? { resolve: async () => { throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE'); } };
    // The transport consumes authorizeDispatch/media only; the injected
    // platform authority implements exactly that structural surface.
    const transport = new RoutedModelTransport({ tenant, platform }, [adapter],
      authority as unknown as TextCapabilityProbeAuthority);
    const gateway = new PublicAiGatewayService({ ports: { routing: authority, admission: this.admission, dispatch: this.dispatch,
      budget: this.accounting.budget, transport, audit: audit
        // Task ownership comes from the persisted charge, not a caller's lease.
        // The audit independently checks its invocation/task/ledger association.
        ?? new PrismaTaskGatewayAudit(this.input.db, this.input.scopes, this.accounting.facts, charges[0].taskId, this.input.clock),
      ...(authority.media ? { media: authority.media } : {}),
      observation: { record: observation => this.receipts.observe(started.receipt.id, observation,
        adapter.evidenceMode === 'live' ? 'node_https' : 'mock') }
    }, evidence: adapter.evidenceMode, verifyEvidence: async (route, mode) => {
      await authority.assertCurrent(context, route);
      const proof = route.route.probe;
      return mode === adapter.evidenceMode && proof?.purpose === 'capability_text_probe'
        && proof.operationId === command.operationId && proof.profileFingerprint === command.profileFingerprint
        && proof.intentHash === prepared.intentHash;
    } }, [{ sceneCode: TEXT_PROBE_SCENE, routeScene: textProbeRouteScene(command), maxOutputTokens: 32,
      ...(textProbeCapability(command) === 'embedding' ? { embeddingProbe: true } : {}),
      ...(textProbeCapability(command) === 'reasoning' ? { reasoningChannel: true } : {}),
      ...(textProbeCapability(command) === 'structured_output' ? { structuredOutput: true } : {}),
      ...(textProbeCapability(command) === 'tools' ? { orderExplainTool: true } : {}) }], 30000);
    try {
      let result: AiGatewayResultDraft | undefined;
      if (textProbeMode(command) === 'stream') {
        for await (const event of gateway.stream(resolution.context, prepared.intent, signal)) {
          if (event.kind === 'terminal') result = event.result;
        }
        if (!result) throw new ModelGatewayError('ACCOUNTING_PENDING');
      } else result = await gateway.invoke(resolution.context, prepared.intent, signal);
      observedResult?.(result);
    }
    catch (error) {
      if (signal?.aborted || error instanceof ModelGatewayError && error.code === 'FORBIDDEN') throw error;
      await authority.assertCurrent(context, resolution);
      return { ...await this.collect(context, command), errorCode: error instanceof ModelGatewayError ? error.code : 'ACCOUNTING_PENDING' };
    }
    return this.collect(context, command);
  }
  async reconcile(context: TextProbeContext, command: TextProbeCommand) {
    return this.collect(probeContextSchema.parse(structuredClone(context)), textProbeCommandSchema.parse(structuredClone(command)));
  }
  async preflight(context: TextProbeContext, command: TextProbeCommand) {
    context = probeContextSchema.parse(structuredClone(context));
    command = textProbeCommandSchema.parse(structuredClone(command));
    const authority = this.authority(context, command), current = await authority.resolve(context, textProbeRequirements(command));
    if (!canExecuteTextProbe(command, current.route.profile)) {
      await authority.assertCurrent(context, current);
      return { allowed: false, required: textProbeRequirements(command), missing: textProbeRequirements(command), stale: [] };
    }
    this.adapter(current.route.profile.protocol, command, current.consumerScope.id);
    const result = await this.capabilities.preflight(current.route.profile, textProbeRequirements(command));
    await authority.assertCurrent(context, current);
    return result;
  }
}
