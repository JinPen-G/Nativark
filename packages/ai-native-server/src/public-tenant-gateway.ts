/** Request-bound public model execution. The original Gateway owns dispatch
 * and accounting; the host owns published inputs, entitlements and HTTP. */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiGatewayIntentDraft } from '@rental-os/platform-contracts/ai-gateway';
import type { AiTaskRunnerLease, AiTaskRunnerStepRef } from '@rental-os/platform-server/ai-runtime';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { AiGatewayRoutingService, ModelGatewayError, ProviderCapabilityReader, ProviderRouterService, PublicAiGatewayService,
  RoutedModelTransport, gatewayRoutingBinding, gatewayTextIntentBindingSchema,
  modelAdapterSupportsCapabilities, tenantGatewayContextSchema, type GatewayCapacityPort, type GatewayContext,
  type GatewayConnectionResolver, type GatewayTextIntentBinding, type ModelAdapter, type TenantGatewayContext,
  type UnifiedGatewayAudit } from '@rental-os/platform-server/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiTaskRepositoryError } from './task-errors';
import { AiTaskExecutionBudgetError } from './task-resource-ledger';
import { isStrictAiTaskTransactionBoundary, type AiTaskTransactionBoundary } from './task-transactions';
import type { createPublicTenantTaskAuthority } from './public-tenant-task-authority';
import { createPublicTenantGatewayAdmission } from './gateway-admission';
import { AiScopeRepository } from './runtime/ai-scope.repository';
import { PrismaProviderProfileRepository } from './runtime/provider-profile.repository';
import { PrismaTextCapabilityEvidenceReader } from './configuration/text-capability-evidence.reader';
import { listCapabilityEvidence } from './configuration/provider-capability-evidence';
import { GatewayInvocationStore } from './runtime/budget/prisma-gateway-invocation.store';
import { gatewayPreparationReceipt } from './runtime/gateway-preparation-audit';
import { gatewayTenantBudgetPrincipal } from './runtime/budget/gateway-budget-principal';
import { createTenantGatewayAccounting, type TenantGatewayBudgetGrant } from './runtime/budget/public-tenant-gateway-accounting';
import { readPublicTenantModelInput, tenantModelStepCode, tenantRouteConfiguration, type TenantModelInput } from './runtime/model-input/public-tenant-model-invocation';
import { taskModelIdentity } from './runtime/model-input/task-model-input-binding';
import { readModelNonDispatchEvidence } from './runtime/model-input/prisma-model-nondispatch.evidence';
import type { TaskRegisteredExecutor } from './runtime/runner/task-measured-effects';
export type { TenantGatewayBudgetGrant } from './runtime/budget/public-tenant-gateway-accounting';

type Tx = Prisma.TransactionClient;
type BoundTenant = Awaited<ReturnType<ReturnType<typeof createPublicTenantTaskAuthority>['bind']>>;
type Database = Parameters<typeof createTenantGatewayAccounting>[0]['db'] & ConstructorParameters<typeof PrismaTextCapabilityEvidenceReader>[0]
  & Pick<PrismaClient, 'aiTaskActionInput' | 'aiProviderCapabilityEvidence' | 'operationLog'>;
const txOptions = { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 };
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unknown = () => new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');

export function createPublicTenantTaskGateway(input: {
  db: Database;
  authority: BoundTenant;
  transactions: AiTaskTransactionBoundary<Tx>;
  scene: GatewayTextIntentBinding;
  /** The registered configuration service uses the original current invocation permission. */
  selection: { selectionForInvocation(context: { tenantId: string; actorId: string }): Promise<{ mode: 'platform_managed' | 'tenant_managed'; revision: number }> };
  connections: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver };
  adapters: readonly (ModelAdapter & { readonly evidenceMode: 'mock' | 'live' })[];
  evidence: 'mock' | 'live';
  capacity: GatewayCapacityPort;
  budgetGrant: TenantGatewayBudgetGrant;
  /** Optional telemetry sink. The original preparation receipt is persisted separately. */
  audit?: Pick<UnifiedGatewayAudit, 'append'>;
  clock?: () => Date;
  timeoutMs?: number;
}) {
  const sceneResult = gatewayTextIntentBindingSchema.safeParse(input?.scene);
  if (!sceneResult.success || sceneResult.data.orderExplainTool || sceneResult.data.nativeToolResults
    || sceneResult.data.embeddingProbe || !isStrictAiTaskTransactionBoundary(input.transactions)
    || typeof input.authority?.principalOn !== 'function' || typeof input.authority.assertCurrent !== 'function'
    || typeof input.selection?.selectionForInvocation !== 'function'
    || typeof input.budgetGrant !== 'function' || typeof input.capacity?.acquire !== 'function'
    || typeof input.db?.operationLog?.findUnique !== 'function' || typeof input.db.operationLog.create !== 'function'
    || input.audit !== undefined && typeof input.audit.append !== 'function' || !Array.isArray(input.adapters) || !input.adapters.length
    || !['mock', 'live'].includes(input.evidence) || input.adapters.some(adapter => adapter?.evidenceMode !== input.evidence))
    throw new ModelGatewayError('CONFIG_INVALID');
  const { db, authority, transactions } = input, scene = sceneResult.data, clock = input.clock ?? (() => new Date());
  const adapters = Object.freeze([...input.adapters]), evidence = input.evidence;
  const scopes = new AiScopeRepository(db, authority.identities, clock);
  const verifier = new PrismaTextCapabilityEvidenceReader(db, clock);
  const capabilities = new ProviderCapabilityReader({ list: profile => listCapabilityEvidence(db, profile) },
    { liveEvidenceVerifier: verifier, allowMock: evidence === 'mock' }, clock);
  const router = new ProviderRouterService({ profiles: new PrismaProviderProfileRepository(db), capabilities });
  const routing = new AiGatewayRoutingService<TenantGatewayContext>(scopes,
    { selectionForInvocation: ({ tenantId, actorId }) => input.selection.selectionForInvocation({ tenantId, actorId }) }, router, scene.routeScene);
  const forTenant = (value: GatewayContext) => {
    const parsed = tenantGatewayContextSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('FORBIDDEN');
    return parsed.data;
  };
  const bindings = new GatewayInvocationStore(db, scopes, clock, transactions, {
    async prepare(tx, step, context, command) {
      if (!tx.aiTaskActionInput) throw denied();
      const frozen = await readPublicTenantModelInput({ aiTaskActionInput: tx.aiTaskActionInput }, step, context, scene, clock);
      if (frozen.mode !== command.mode || frozen.priceVersion !== command.priceVersion || command.expiresAt > frozen.expiresAt
        || requestFingerprint(frozen.intent) !== requestFingerprint(command.intent)
        || requestFingerprint(frozen.configuration) !== requestFingerprint(command.configuration)) throw denied();
      return frozen.prepared.intentHash;
    },
    async verify(_tx, step, invocation, audience) {
      if (audience !== 'operator' || invocation.sceneCode !== scene.sceneCode || !tenantModelStepCode(step)
        || !step.inputRef || step.requestFingerprint !== invocation.intentHash) throw denied();
    }
  }, 'tenant');
  const accounting = createTenantGatewayAccounting({ db, scopes, bindings, transactions, clock, grant: input.budgetGrant,
    context: tx => tx ? authority.principalOn(tx) : authority.identities.resolve() });
  const once = <T>(work: () => Promise<T>) => transactions.withAiTaskTransactionAuthority(authority.transaction, work);
  const ownership = createPublicTenantGatewayAdmission({ db, identities: authority.identities, transactions, clock });

  async function frozenStep(taskId: string, runId: string, stepId: string, revision?: number) {
    const { context, scope } = await scopes.resolveCurrent(), { actorKind: _, ...principal } = gatewayTenantBudgetPrincipal(context);
    const where = { id: stepId, scopeId: scope.id, taskId, runId, status: 'RUNNING' as const,
      ...(revision === undefined ? {} : { revision }) };
    const step = await db.aiStep.findFirst({ where });
    if (scope.kind !== 'TENANT' || !step || step.id !== stepId || step.scopeId !== scope.id || step.taskId !== taskId
      || step.runId !== runId || step.status !== 'RUNNING' || revision !== undefined && step.revision !== revision) throw denied();
    const stored = await readPublicTenantModelInput(db, step, context, scene, clock);
    if (taskModelIdentity(await authority.actions.resolve(taskId, 'transition_task')) !== taskModelIdentity(context)) throw denied();
    return { context, scope, principal, step, stored };
  }

  async function checkRoute(stored: TenantModelInput, principal: TenantGatewayContext,
    selected?: Awaited<ReturnType<typeof routing.resolve>>) {
    const route = selected ?? await routing.resolve(principal, stored.prepared.requiredCapabilities);
    if (gatewayRoutingBinding(route) !== stored.routingHash
      || requestFingerprint(tenantRouteConfiguration(route)) !== requestFingerprint(stored.configuration)) throw denied();
    const adapter = adapters.find(value => value.provider === route.route.profile.protocol);
    if (!modelAdapterSupportsCapabilities(adapter, route.requiredCapabilities) || adapter?.evidenceMode !== evidence)
      throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    await routing.assertCurrent(principal, route);
    return route;
  }

  const invocations = Object.freeze({ async prepare(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, signal?: AbortSignal) {
    step = structuredClone(step); lease = structuredClone(lease);
    if (signal?.aborted || step.plan.operation !== 'external_unknown' || !tenantModelStepCode(step.plan)) throw denied();
    const current = await frozenStep(lease.taskId, lease.runId, step.registered.stepId, step.registered.stepRevision);
    const { stored } = current;
    if (stored.registrationRef !== step.plan.registrationRef || step.registered.runId !== lease.runId) throw denied();
    await checkRoute(stored, current.principal);
    if (signal?.aborted) throw denied();
    const created = await once(() => bindings.register({ stepId: current.step.id, mode: stored.mode,
      lease: { runId: lease.runId, holderId: lease.holderId, fencingToken: lease.fencingToken }, intent: stored.intent,
      configuration: stored.configuration, priceVersion: stored.priceVersion,
      expiresAt: new Date(Math.min(Date.parse(lease.expiresAt), stored.expiresAt.getTime())) }));
    if (created.replayed || signal?.aborted) throw unknown();
    return { invocationId: created.id };
  } });

  const tools: TaskRegisteredExecutor = { async resolve(toolCode, toolVersion) {
    if (!tenantModelStepCode({ toolCode, toolVersion })) return null;
    return { operation: 'external_unknown', async execute(value, signal) {
      const command = structuredClone(value), initial = await frozenStep(command.taskId, command.runId, command.stepId);
      const { stored, principal, scope } = initial;
      if (signal.aborted || command.clarifications?.length || command.lease.taskId !== command.taskId || command.lease.runId !== command.runId
        || initial.step.actionId !== command.actionId
        || initial.step.requestFingerprint !== command.fingerprint || initial.step.inputRef !== command.inputRef) throw denied();
      const current = (caller: GatewayContext) => {
        if (requestFingerprint(forTenant(caller)) !== requestFingerprint(principal)) throw denied();
        return principal;
      };
      const assertInput = async () => {
        const next = await frozenStep(command.taskId, command.runId, command.stepId);
        if (next.scope.id !== scope.id || next.step.actionId !== command.actionId || next.step.inputRef !== command.inputRef
          || stableInput(next.stored) !== stableInput(stored)) throw denied();
      };
      const finalNative = async (profileHash: string, mode: 'prepare' | 'dispatch', providerSignal?: AbortSignal,
        preparation?: Parameters<NonNullable<UnifiedGatewayAudit['prepare']>>[0]) => {
        const effectiveSignal = providerSignal ?? signal;
        if (effectiveSignal.aborted || signal.aborted) throw new ModelGatewayError('CANCELLED');
        const request = { callId: stored.intent.requestId, model: stored.configuration.model, profileHash,
          maxOutputTokens: stored.intent.maxOutputTokens, intentHash: stored.prepared.intentHash,
          taskId: command.taskId, stepId: command.stepId, mode: stored.mode };
        const source = await db.$transaction(tx => transactions.withAiTaskTransaction(tx, { kind: 'invocation', callId: request.callId,
          tenantSubject: { tenantId: principal.tenantId, actorId: principal.actorId } }, async () => {
          const dispatch = mode === 'dispatch' ? await bindings.assertTenantDispatch(tx, scope.id, principal.tenantId, principal.actorId, request) : undefined;
          const invocation = dispatch?.invocation ?? await bindings.assertTenantInvocation(tx, scope.id, principal.tenantId, principal.actorId, request, true);
          if (invocation.taskId !== command.taskId || invocation.runId !== command.runId || invocation.stepId !== command.stepId
            || invocation.actionId !== command.actionId || invocation.leaseOwnerId !== command.lease.holderId
            || invocation.fencingToken.toFixed(0) !== command.lease.fencingToken) throw denied();
          const fresh = await readPublicTenantModelInput(tx, initial.step, await authority.principalOn(tx), scene, clock);
          if (stableInput(fresh) !== stableInput(stored)) throw denied();
          if (dispatch) await accounting.assertDispatch(tx, dispatch.reservationId, { scope: initial.context.scope, config: stored.configuration,
            requestId: invocation.callId, idempotencyKey: invocation.callId, stepId: invocation.stepId, runId: invocation.runId,
            actionId: invocation.actionId, priceVersion: invocation.priceVersion });
          if (preparation) {
            const data = gatewayPreparationReceipt(invocation, principal.tenantId, preparation.requestHash, preparation.configurationHash);
            const previous = await tx.operationLog.findUnique({ where: { id: data.id } });
            if (effectiveSignal.aborted || signal.aborted) throw new ModelGatewayError('CANCELLED');
            const saved = previous ?? await tx.operationLog.create({ data });
            if (saved.id !== data.id || saved.tenantId !== data.tenantId || saved.workspaceId !== null || saved.userId !== data.userId
              || saved.action !== data.action || requestFingerprint(saved.detail) !== requestFingerprint(data.detail)) throw denied();
          }
          return invocation;
        }), txOptions);
        if (effectiveSignal.aborted || signal.aborted) throw new ModelGatewayError('CANCELLED');
        return source;
      };
      let profileHash: string | undefined, preparedInvocation: Awaited<ReturnType<typeof finalNative>> | undefined;
      const transport = new RoutedModelTransport(input.connections, adapters, undefined, async (caller, request, providerSignal) => {
        current(caller);
        if (!profileHash || request.callId !== stored.intent.requestId || request.model !== stored.configuration.model
          || request.maxOutputTokens !== stored.intent.maxOutputTokens) throw denied();
        await finalNative(profileHash, 'dispatch', providerSignal);
        authority.assertCurrent();
      });
      const gateway = new PublicAiGatewayService({ evidence, async verifyEvidence(route) {
        await checkRoute(stored, principal, route);
        return true;
      }, ports: { ...ownership, budget: accounting.budget, capacity: input.capacity, transport, audit: {
        async prepare(preparation, signal) {
          current(preparation.context);
          if (!preparation.profile || preparation.callId !== stored.intent.requestId
            || preparation.mode !== stored.mode || preparation.intentHash !== stored.prepared.intentHash || !profileHash
            || profileHash !== preparation.configurationHash || profileHash !== requestFingerprint(preparation.profile)) throw denied();
          try { preparedInvocation = await finalNative(profileHash, 'prepare', signal, preparation); }
          catch (error) {
            if (error instanceof ModelGatewayError) throw error;
            if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw new ModelGatewayError('FORBIDDEN');
            throw new ModelGatewayError('ACCOUNTING_PENDING');
          }
        }, append: async entry => { await input.audit?.append(entry); }
      }, routing: {
        async resolve(caller, required) {
          const route = await routing.resolve(current(caller), required);
          await checkRoute(stored, principal, route);
          profileHash = requestFingerprint(route.route.profile);
          return route;
        },
        async assertCurrent(caller, route) {
          current(caller); await checkRoute(stored, principal, route); await assertInput();
        }
      } } }, [scene], input.timeoutMs, undefined, true);
      return once(async () => {
        const result = stored.mode === 'invoke' ? await gateway.invoke(initial.context, stored.intent, signal)
          : await terminalStream(gateway, initial.context, stored.intent, signal);
        if (result.requestId !== stored.intent.requestId || requestFingerprint(result.actual) !== requestFingerprint(stored.configuration)) throw denied();
        const payload: Prisma.InputJsonValue = JSON.parse(JSON.stringify(result));
        if (result.status === 'completed' && result.usage.kind === 'reported') return { kind: 'succeeded' as const, payload };
        if (result.status === 'failed' && preparedInvocation) {
          const original = await readModelNonDispatchEvidence(db, { scopeId: scope.id, scopeKind: 'TENANT',
            tenantId: principal.tenantId, actorId: principal.actorId }, preparedInvocation);
          await assertInput();
          if (original) return { kind: 'failed' as const, payload };
        }
        return { kind: 'unknown' as const, payload };
      });
    } };
  } };
  return Object.freeze({ invocations, tools: Object.freeze(tools), recovery: accounting.recovery,
    dispatchEvidence: Object.freeze({ readDispatch: accounting.readDispatch }) });
}

const stableInput = (value: TenantModelInput) =>
  requestFingerprint({ ...value, expiresAt: value.expiresAt.toISOString() });

async function terminalStream(gateway: PublicAiGatewayService, context: Parameters<PublicAiGatewayService['invoke']>[0], intent: AiGatewayIntentDraft, signal: AbortSignal) {
  for await (const event of gateway.stream(context, intent, signal)) if (event.kind === 'terminal') return event.result;
  throw unknown();
}
