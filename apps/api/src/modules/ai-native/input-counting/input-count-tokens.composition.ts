/** Explicit server composition for input counting. No Nest provider, route,
 * timer or production switch is created here: the mainline mounts this beside
 * the existing pricing publication surface and keeps every default-closed
 * gate. The admission subsystem is the SAME budget repository/ledger as model
 * calls — only the quote port (one real call per count) and the counting
 * authorization adapter are counting-specific. */
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { AiExecutionContext } from '@rental-os/shared';
import { BudgetError } from '../budget/budget.ports';
import { createPersistedBudgetSubsystem } from '../budget/budget.module';
import { gatewayBudgetPrincipal } from '../budget/gateway-budget-principal';
import type { GatewayPricingEvidenceSource } from '../budget/prisma-gateway-pricing-records';
import { GatewayPricingRecordManagement } from '../budget/prisma-gateway-pricing-records';
import { PrismaGatewayInvocationBindings } from '../budget/prisma-gateway-invocation-bindings';
import { gatewayInputBoundEvidenceSchema, type GatewayInputBoundEvidence } from '../budget/gateway-pricing-evidence';
import { createNativeModelEgressTransport } from '../model-egress.transport';
import type { ChatProtocolOptions, ModelJsonTransport } from '../chat-completions.adapter';
import type { GatewayConnectionResolver } from '../routed-model-transport';
import type { PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { InputCountTokensAuthorizationSource, InputCountTokensCallPricing, InputCountTokensEvidence } from './input-count-tokens.admission';
import { CountingTaskModelInvocationPreparation, TaskCountingGateSource, TaskInputBoundPublisher } from './input-count-tokens.task-bound';
import { InputCountTokensService, type CountTokensFrozenInputSource } from './input-count-tokens.service';
import { PrismaCountTokensReceipts, countTokensReceiptDocumentHash, type CountTokensReceiptDb } from './input-count-tokens.receipt';
import { countTokensSupport } from './count-tokens.protocol';
import type { AiTaskModelInvocationPreparation } from '../runner/prisma-task-runner-resource.source';

/** Trusted source behind publishInputBound: reads the persisted provider count
 * receipt and binds it to the exact invocation/price the caller presents. The
 * price hash itself is only attested by the stored price record the caller
 * already verified; this source never invents a count, rounds a number or
 * accepts a client-supplied bound. */
export class CountTokensGatewayPricingEvidenceSource implements GatewayPricingEvidenceSource {
  private readonly receipts;
  constructor(private readonly db: CountTokensReceiptDb, private readonly priceDelegate?: Pick<GatewayPricingEvidenceSource, 'readPrice'>) {
    this.receipts = new PrismaCountTokensReceipts(db);
    if (priceDelegate !== undefined && typeof priceDelegate.readPrice !== 'function') throw new BudgetError('UNAVAILABLE');
  }
  readPrice(reference: string, context: Readonly<AiExecutionContext>) {
    if (!this.priceDelegate) throw new BudgetError('UNAVAILABLE');
    return this.priceDelegate.readPrice(reference, context);
  }
  async readInputBound(reference: string, context: Readonly<AiExecutionContext>, binding: Readonly<{
    invocationId: string; scopeId: string; registrationHash: string; intentHash: string;
    configurationHash: string; priceVersion: string; priceHash: string; maxOutputTokens: number;
  }>): Promise<unknown> {
    const parsed = /^count-tokens:([a-f0-9]{64})$/u.exec(reference);
    const principal = gatewayBudgetPrincipal(context);
    if (!parsed || !['operator', 'staff'].includes(context.audience) || principal.actorKind !== 'USER') throw new BudgetError('FORBIDDEN');
    const receipt = await this.receipts.read(parsed[1]);
    const scope = context.scope as { kind: string; tenantId?: string; workspaceId?: string };
    if (receipt.state !== 'observed' || receipt.tenantId !== scope.tenantId || receipt.workspaceId !== scope.workspaceId
      || receipt.actorId !== principal.actorId || receipt.scopeId !== binding.scopeId
      || receipt.invocationId !== binding.invocationId || receipt.registrationHash !== binding.registrationHash
      || receipt.intentHash !== binding.intentHash || receipt.configurationHash !== binding.configurationHash
      || receipt.priceVersion !== binding.priceVersion || receipt.maxOutputTokens !== binding.maxOutputTokens)
      throw new BudgetError('UNAVAILABLE');
    const evidence: GatewayInputBoundEvidence = gatewayInputBoundEvidenceSchema.parse({
      kind: 'gateway-input-bound-1', invocationId: binding.invocationId, scopeId: binding.scopeId,
      registrationHash: binding.registrationHash, intentHash: binding.intentHash,
      configurationHash: binding.configurationHash, priceVersion: binding.priceVersion, priceHash: binding.priceHash,
      maxInputTokens: receipt.inputTokens, maxOutputTokens: binding.maxOutputTokens,
      // Bind the serialized count material actually sent so a changed tool
      // schema or input serialization can never reuse this bound.
      countRequestHash: receipt.countRequestHash,
      modality: 'text', additionalBillingDimensions: 'none', method: receipt.method,
      validFrom: receipt.observedAt, expiresAt: receipt.expiresAt,
      // The receipt row is immutable and single-version; the document hash
      // below is the durable content binding, not a mutable revision counter.
      provenance: { reference, revision: '1', documentHash: countTokensReceiptDocumentHash(receipt) }
    });
    return evidence;
  }
}

export interface InputCountTokensCompositionDependencies extends PersistedTaskAuthorizationDependencies {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  frozen?: CountTokensFrozenInputSource;
  resolvers?: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver };
  transport?: ModelJsonTransport;
  /** Must match the original task gateway adapter registration so a counted
   * tool schema is the schema the dispatch will send. */
  policyOptions?: ChatProtocolOptions;
  /** Management entries only. Omitted for task-only compositions: the
   * in-task counting entry derives the scene from the persisted invocation. */
  sceneCode?: string;
  taskExecution?: TaskCountingGateSource;
  countingPriceVersion?: string;
  priceDelegate?: Pick<GatewayPricingEvidenceSource, 'readPrice'>;
  timeoutMs?: number;
}
export function composeInputCountTokensService(input: InputCountTokensCompositionDependencies) {
  if (!input || input.frozen !== undefined && typeof input.frozen.readFrozenCountingInput !== 'function'
    || input.resolvers !== undefined && (typeof input.resolvers.platform?.resolve !== 'function'
      || typeof input.resolvers.tenant?.resolve !== 'function')) throw new BudgetError('UNAVAILABLE');
  const clock = input.clock ?? (() => new Date());
  const authorization = new InputCountTokensAuthorizationSource(input, input.db);
  const quotes = new InputCountTokensCallPricing(input.db, authorization.scopes, input.countingPriceVersion, clock);
  const evidence = new InputCountTokensEvidence(input.db);
  const budget = createPersistedBudgetSubsystem({ db: input.db, subscriptions: input.subscriptions,
    authorization, quotes, evidence, clock });
  const service = new InputCountTokensService({ db: input.db, scopes: authorization.scopes, authorization, budget,
    frozen: input.frozen, resolvers: input.resolvers,
    // Receipt-only hosts need no connection/codec/price for a new call.
    // Missing execution dependencies are validated only after no receipt exists.
    transport: input.transport ?? (input.resolvers ? createNativeModelEgressTransport() : undefined),
    policyOptions: input.policyOptions ?? (input.frozen ? { orderExplainTool: { name: 'rental_order_explain', version: AI_TOOL_DRAFT_VERSION } } : undefined),
    sceneCode: input.sceneCode, countingPriceVersion: input.countingPriceVersion,
    ...(input.taskExecution ? { taskExecution: input.taskExecution } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}), clock });
  const pricingEvidence = new CountTokensGatewayPricingEvidenceSource(input.db, input.priceDelegate);
  return Object.freeze({ service, pricingEvidence, authorization, budget, support: countTokensSupport,
    admissionScene: input.sceneCode !== undefined ? countTokensAdmissionScene(input.sceneCode) : null });
}
function countTokensAdmissionScene(sceneCode: string) {
  return `${sceneCode}:count-tokens`;
}
export { countTokensSupport as inputCountTokensSupport };

/** One explicit server entry for the whole counting-to-recorded-pricing chain:
 * count the frozen input of a registered invocation, observe the receipt by
 * its original keys, publish the input bound through the existing trusted
 * publication path, and hand the bound to the original recorded pricing. The
 * mainline mounts this beside the pricing publication surface; it creates no
 * route, timer or second ledger, and the settings-manage authority for
 * publication stays with the original budget authorization chain. */
export function composeInputCountingPricing(input: InputCountTokensCompositionDependencies) {
  if (input.sceneCode === undefined) throw new BudgetError('UNAVAILABLE');
  const counting = composeInputCountTokensService(input);
  const clock = input.clock ?? (() => new Date());
  const bindings = new PrismaGatewayInvocationBindings(input.db, counting.authorization.scopes, clock);
  const management = new GatewayPricingRecordManagement(input.db, counting.authorization.scopes,
    counting.authorization, counting.pricingEvidence, bindings, input.sceneCode, clock);
  return Object.freeze({ ...counting, management,
    pricingRequest: Object.freeze({
      countTokens: (command: unknown, signal?: AbortSignal) => counting.service.count(command, signal),
      readCountReceipt: (command: unknown) => counting.service.readCountReceipt(command),
      publishInputBound: (command: unknown) => management.publishInputBound(command),
      readInputBound: (command: unknown) => management.readInputBound(command),
      readPrice: (command: unknown) => management.readPrice(command)
    }) });
}

/** The in-task counting chain for recorded model hosts: the formal
 * task-internal permission (the same transition_task policy that may dispatch
 * the original call) authorizes counting the registered frozen input and
 * publishing its trusted input bound after both task CALLS reserves and BEFORE
 * generation's financial reserve.
 * Multi-scene by construction — the scene, configuration, input fingerprint
 * and plan basis come from the server-persisted invocation of each host; the
 * management counting entry, its settings_write gate and this chain stay
 * separate, and neither grants the other. */
export interface TaskInputCountingChainDependencies extends InputCountTokensCompositionDependencies {
  taskExecution: TaskCountingGateSource;
}
export function composeTaskInputCountingChain(input: TaskInputCountingChainDependencies) {
  if (typeof input?.taskExecution?.authorize !== 'function') throw new BudgetError('UNAVAILABLE');
  const counting = composeInputCountTokensService(input);
  const publisher = new TaskInputBoundPublisher({ db: input.db, scopes: counting.authorization.scopes,
    taskExecution: input.taskExecution, evidence: counting.pricingEvidence,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.clock !== undefined ? { clock: input.clock } : {}) });
  const chain = { taskCount: (command: unknown, signal?: AbortSignal) => counting.service.taskCount(command, signal),
    publish: (command: unknown, signal?: AbortSignal) => publisher.publish(command, signal) };
  return Object.freeze({ ...counting, publisher, chain,
    /** Registration stays separate from the budgeted count → publish stage.
     * Providing it is the recorded host's explicit server decision; a calls
     * host composes without it and never counts. */
    preparation: (inner: AiTaskModelInvocationPreparation): AiTaskModelInvocationPreparation =>
      new CountingTaskModelInvocationPreparation(inner, chain) });
}
