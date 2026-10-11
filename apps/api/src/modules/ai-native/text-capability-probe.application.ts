import type { ModelJsonTransport } from './chat-completions.adapter';
import { ChatCompletionsAdapter } from './chat-completions.adapter';
import { createNativeModelEgressTransport } from './model-egress.transport';
import { RoutedModelTransport, TenantModelConnectionResolver } from './routed-model-transport';
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

export type TextCapabilityProbeDependencies = Omit<Parameters<typeof createPersistedGatewayBudget>[0], 'scopes' | 'db'> & {
  db: Parameters<typeof createPersistedGatewayBudget>[0]['db'] & TextProbeReceiptDb
    & ConstructorParameters<typeof PrismaProviderCapabilityEvidenceRepository>[0];
  scopes: Pick<AiScopeRepository, 'resolveCurrent' | 'resolveRoutingScopes'>;
  management: Pick<TenantModelConfigurationAuthority, 'authorize'>;
  configuration: Pick<TenantModelConfigService, 'selectionForInvocation' | 'profile' | 'credential'>;
  audit: UnifiedGatewayAudit;
  protocol?: ModelJsonTransport;
};
export class TextCapabilityProbeApplication {
  private readonly profiles;
  private readonly receipts;
  /** Same persisted evidence consumer for the ordinary authorized Gateway. */
  readonly capabilities: ProviderCapabilityService;
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
    const admissions = new PrismaAdmissionRepository(input.db);
    this.admission = new InvocationAdmissionService(admissions, input.clock);
    this.dispatch = new InvocationDispatchService(admissions);
    this.adapter = new ChatCompletionsAdapter(input.protocol ?? createNativeModelEgressTransport());
  }
  private authority(context: GatewayContext, command: TextProbeCommand) {
    return new TextCapabilityProbeAuthority({ management: this.input.management, scopes: this.input.scopes,
      configuration: this.input.configuration, profiles: this.profiles, bindings: this.accounting.bindings }, context, command);
  }
  async prepare(value: GatewayContext, commandValue: TextProbeCommand) {
    const context = probeContextSchema.parse(structuredClone(value)), command = textProbeCommandSchema.parse(structuredClone(commandValue));
    const authority = this.authority(context, command), resolution = await authority.resolve(context, ['text']);
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
    const started = await this.receipts.begin(descriptor);
    if (!started.created) return this.collect(context, command);
    await this.accounting.bindings.register({ ...execution, intent: prepared.intent, configuration, mode: 'invoke' });
    await authority.assertCurrent(context, resolution);
    const tenant = new TenantModelConnectionResolver(this.input.configuration);
    const transport = new RoutedModelTransport({ tenant, platform: tenant }, [this.adapter], authority);
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
