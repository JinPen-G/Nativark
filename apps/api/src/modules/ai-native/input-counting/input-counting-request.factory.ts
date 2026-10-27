/** Request-level server entry for the counting→bound→recorded-pricing→cost
 * chain. Every call is bound to THIS request's bearer, original Auth/Guard
 * chain and ALS identity: the counting service, frozen-input reader, budget
 * subsystem and observation readers are constructed per call and closed when
 * the request ends — no credential-carrying singleton is shared across
 * requests. Scene, counting price version, tool policy, connection resolvers
 * and transport come from server dependencies only; the caller may supply
 * nothing but the original call/task identifiers. All counting admissions
 * keep the single budget ledger and the unique INSERT-won dispatch claim. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { BudgetError } from '../budget/budget.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiScopeResolutionError } from '../ai-scope.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { createPersistedBudgetSubsystem } from '../budget/budget.module';
import { GatewayPricingRecordManagement } from '../budget/prisma-gateway-pricing-records';
import { presentGatewayInputBoundSummary, presentGatewayPriceSummary } from '../budget/gateway-pricing-request.composition';
import type { GatewayPricingEvidenceSource } from '../budget/prisma-gateway-pricing-records';
import { PrismaGatewayInvocationBindings } from '../budget/prisma-gateway-invocation-bindings';
import { TaskBudgetUsageReader } from '../budget/task-budget-usage.reader';
import { composeTaskCostObservation } from '../observability/task-cost-observation.composition';
import { createNativeModelEgressTransport } from '../model-egress.transport';
import type { ModelJsonTransport } from '../chat-completions.adapter';
import type { GatewayConnectionResolver } from '../routed-model-transport';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import type { AiRequestAbortSource } from '../scenes/request-abort';
import { InputCountTokensAuthorizationSource, InputCountTokensCallPricing, InputCountTokensEvidence } from './input-count-tokens.admission';
import { InputCountTokensService, type CountTokensServiceDb } from './input-count-tokens.service';
import { InputCountingFrozenInputReader, type InputCountingFrozenReaderDb } from './input-counting-frozen.reader';
import { CountTokensGatewayPricingEvidenceSource } from './input-count-tokens.composition';

export type InputCountingRequestAction = 'count' | 'observeCountKey' | 'readCountReceipt'
  | 'publishInputBound' | 'readInputBound' | 'readPublication' | 'usagePage' | 'usageSummary'
  | 'usagePricingBases' | 'taskCosts';
export type InputCountingHttpRequest = { headers: { authorization?: unknown } } & AiRequestAbortSource;
export interface InputCountingServerConfiguration {
  /** Server-resolved scene the counting entry serves; invocations from any
   * other scene are refused by the frozen reader's fingerprint binding. */
  sceneCode: string;
  countingPriceVersion: string;
  /** The scene's registered per-request output ceiling — the same value the
   * scene's task gateway was composed with. Refused material never exceeds
   * it; a drifted (too-small) value only fails closed. */
  sceneMaxOutputTokens: number;
  /** The scene's registered protocol tool policy. Explicit and mandatory:
   * a silent default here could make the counted serialization diverge from
   * the dispatch serialization with no fail-safe able to detect it. */
  toolPolicy: { orderExplainTool?: { name: string; version: typeof AI_TOOL_DRAFT_VERSION } };
  timeoutMs?: number;
}
export interface InputCountingRequestDependencies {
  db: CountTokensServiceDb & InputCountingFrozenReaderDb & ConstructorParameters<typeof TaskBudgetUsageReader>[0]
    & Pick<Parameters<typeof composePersistedTaskAuthorization>[0]['db'],
      'aiTaskActionPolicy' | 'aiTaskExecutionBudget' | 'aiTaskExecutionCharge' | 'aiRun' | 'aiTaskRunPlan'>;
  auth: Pick<AuthService, 'resolveAccessContext'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
  /** Platform/tenant connection resolvers from the server's model-config
   * compositions; never request-supplied. */
  resolvers?: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver };
  transport?: ModelJsonTransport;
  /** Optional platform-rate read delegate for bound publication alongside
   * counting evidence. */
  priceDelegate?: Pick<GatewayPricingEvidenceSource, 'readPrice'>;
  /** Omit only on an original-receipt host; absence never enables new dispatch
   * or pricing publication. Original settlement uses its stored price basis. */
  configuration?: InputCountingServerConfiguration;
  clock?: () => Date;
}
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const actions: readonly InputCountingRequestAction[] = ['count', 'observeCountKey', 'readCountReceipt',
  'publishInputBound', 'readInputBound', 'readPublication', 'usagePage', 'usageSummary', 'usagePricingBases', 'taskCosts'];
const hash = requestFingerprint;
const denied = () => new BudgetError('FORBIDDEN');

export class InputCountingRequestFactory {
  constructor(private readonly server: InputCountingRequestDependencies) {
    if (!server || typeof server.auth?.resolveAccessContext !== 'function' || typeof server.guard?.canActivate !== 'function'
      || typeof server.db?.$transaction !== 'function' || typeof server.db.aiScope?.findFirst !== 'function'
      || typeof server.subscriptions?.readCategoryCommercialContext !== 'function'
      || server.resolvers !== undefined && (typeof server.resolvers.platform?.resolve !== 'function'
        || typeof server.resolvers.tenant?.resolve !== 'function')
      || server.transport !== undefined && typeof server.transport.post !== 'function'
      || server.configuration !== undefined && (!z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u).safeParse(server.configuration.sceneCode).success
        || !z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u).safeParse(server.configuration.countingPriceVersion).success
        || !server.configuration.toolPolicy || typeof server.configuration.toolPolicy !== 'object'
        || !Number.isSafeInteger(server.configuration.sceneMaxOutputTokens)
        || server.configuration.sceneMaxOutputTokens < 1 || server.configuration.sceneMaxOutputTokens > 32768)
      || server.clock !== undefined && typeof server.clock !== 'function') throw new BudgetError('UNAVAILABLE');
    if (server.resolvers) Object.freeze(server.resolvers);
  }

  async call(request: InputCountingHttpRequest, action: InputCountingRequestAction, value: unknown, signal?: AbortSignal) {
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success) throw denied();
    if (!actions.includes(action)) throw new BudgetError('INVALID');
    let command: unknown;
    try {
      if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > 65536) throw new Error();
      command = structuredClone(value);
    } catch { throw new BudgetError('INVALID'); }
    const server = this.server, clock = server.clock ?? (() => new Date());
    const credential = Object.freeze({ authorization: header.data, audience: 'operator' as const, requestId: randomUUID() });
    let active = true, initialIdentity: string | undefined, mutationReturned = false;
    const close = () => { active = false; };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) close();
    const credentials = { current: async () => { if (!active) throw denied(); return { ...credential }; } };
    const auth: InputCountingRequestDependencies['auth'] = { resolveAccessContext: async (authorization, options) => {
      if (!active || authorization !== credential.authorization || options?.audience !== 'operator') throw denied();
      const access = structuredClone(await server.auth.resolveAccessContext(authorization, options));
      if (!active || !access) throw denied();
      const context = await new AiTaskCurrentIdentityAuthority({ resolveAccessContext: async () => access }, credentials, clock).resolve();
      if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator' || !('access' in context)) throw denied();
      const fingerprint = hash({ actor: context.actor, scope: context.scope, audience: context.audience,
        access: context.access, organizationId: access.user.organizationId ?? null });
      if (initialIdentity !== undefined && initialIdentity !== fingerprint) throw denied();
      initialIdentity = fingerprint;
      return access;
    } };
    const identity = new AiTaskCurrentIdentityAuthority(auth, credentials, clock);
    const guard: InputCountingRequestDependencies['guard'] = { canActivate: async execution => {
      await identity.resolve();
      if (await server.guard.canActivate(execution) !== true) throw denied();
      const context = await identity.resolve(), stored = getRequestIdentity();
      if (!stored || context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || !('access' in context)
        || stored.userId !== context.actor.userId || stored.tenantId !== context.scope.tenantId
        || stored.workspaceId !== context.scope.workspaceId || stored.staffApi || stored.isSaasAdmin
        || stored.dataScope !== context.access.dataScope
        || hash(stored.locationScope) !== hash(context.access.locationScope)) throw denied();
      return true;
    } };
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        await identity.resolve();
        const configuration = server.configuration;
        const taskAuthorization = composePersistedTaskAuthorization({
          // The composition declares PrismaClient, but its internals touch a
          // bounded table set already included in this factory's db union;
          // the single cast keeps that contract visible in one place.
          db: server.db as unknown as Parameters<typeof composePersistedTaskAuthorization>[0]['db'],
          auth, credentials, subscriptions: server.subscriptions, clock });
        const frozen = configuration ? new InputCountingFrozenInputReader({ db: server.db,
          execution: { authorize: async (taskId: string) => taskAuthorization.execution.authorize(taskId) },
          scenePolicy: { sceneCode: configuration.sceneCode,
            maxOutputTokens: configuration.sceneMaxOutputTokens,
            ...(configuration.toolPolicy.orderExplainTool ? { orderExplainTool: true } : {}) }, clock }) : undefined;
        const countingAuthorization = new InputCountTokensAuthorizationSource(
          { db: server.db as unknown as Parameters<typeof composePersistedTaskAuthorization>[0]['db'],
            auth, credentials, subscriptions: server.subscriptions, guard, clock }, server.db);
        const quotes = new InputCountTokensCallPricing(server.db, countingAuthorization.scopes,
          configuration?.countingPriceVersion, clock);
        const evidence = new InputCountTokensEvidence(server.db);
        const budget = createPersistedBudgetSubsystem({
          db: server.db as unknown as Parameters<typeof createPersistedBudgetSubsystem>[0]['db'],
          subscriptions: server.subscriptions, authorization: countingAuthorization, quotes, evidence, clock });
        const service = new InputCountTokensService({ db: server.db, scopes: countingAuthorization.scopes,
          authorization: countingAuthorization, budget, frozen,
          resolvers: server.resolvers, transport: server.transport ?? (server.resolvers ? createNativeModelEgressTransport() : undefined),
          policyOptions: configuration?.toolPolicy,
          sceneCode: configuration?.sceneCode, countingPriceVersion: configuration?.countingPriceVersion,
          ...(configuration?.timeoutMs !== undefined ? { timeoutMs: configuration.timeoutMs } : {}), clock });
        const pricingEvidence = new CountTokensGatewayPricingEvidenceSource(server.db, server.priceDelegate);
        const management = () => {
          if (!configuration) throw new BudgetError('UNAVAILABLE');
          return new GatewayPricingRecordManagement(
            server.db as unknown as ConstructorParameters<typeof GatewayPricingRecordManagement>[0], countingAuthorization.scopes,
            countingAuthorization, pricingEvidence, new PrismaGatewayInvocationBindings(
              server.db as unknown as ConstructorParameters<typeof PrismaGatewayInvocationBindings>[0],
              countingAuthorization.scopes, clock), configuration.sceneCode, clock);
        };
        const usage = new TaskBudgetUsageReader(
          server.db as unknown as ConstructorParameters<typeof TaskBudgetUsageReader>[0], taskAuthorization.authority,
          countingAuthorization.scopes, clock);
        const observation = composeTaskCostObservation({
          db: server.db as unknown as Parameters<typeof composeTaskCostObservation>[0]['db'], actions: taskAuthorization.authority,
          scopes: countingAuthorization.scopes, counting: { readCountReceipt: cmd => service.readCountReceipt(cmd) }, clock });
        let result: unknown;
        if (action === 'count') {
          const receipt = await service.count(command, signal);
          // The first returned receipt means reserve/claim/dispatch/receipt all
          // committed: any later failure (replay drift, revoked permission
          // during the re-read) must surface as an original-key unknown, never
          // as a denial or an availability failure for a completed mutation.
          mutationReturned = true;
          const replay = await service.count(command, signal);
          const stable = (item: unknown) => { const { admission: _admission, ...rest } = (item ?? {}) as Record<string, unknown>; return rest; };
          if (hash(stable(receipt)) !== hash(stable(replay))) throw new BudgetError('PENDING_RECONCILIATION');
          result = receipt;
        } else if (action === 'observeCountKey') result = await service.observeCountKey(command);
        else if (action === 'readCountReceipt') {
          const receipt = await service.readCountReceipt(command);
          if (hash(receipt) !== hash(await service.readCountReceipt(command))) throw new BudgetError('PENDING_RECONCILIATION');
          result = receipt;
        } else if (action === 'publishInputBound') {
          const receipt = await management().publishInputBound(command);
          mutationReturned = true;
          const original = await management().readInputBound({ callId: receipt.callId });
          if (original.id !== receipt.id || original.hash !== receipt.payloadHash) throw new BudgetError('PENDING_RECONCILIATION');
          result = receipt;
        } else if (action === 'readInputBound') {
          const original = await management().readInputBound(command);
          if (hash(original) !== hash(await management().readInputBound(command))) throw new BudgetError('PENDING_RECONCILIATION');
          result = presentGatewayInputBoundSummary(original);
        } else if (action === 'readPublication') {
          const original = await management().readPublication(command);
          if (hash(original) !== hash(await management().readPublication(command))) throw new BudgetError('PENDING_RECONCILIATION');
          result = presentGatewayPriceSummary(original);
        } else if (action === 'usagePage') result = await usage.read(command);
        else if (action === 'usageSummary') result = await usage.summary(command);
        else if (action === 'usagePricingBases') result = await usage.pricingBases(command);
        else result = await observation.taskCosts(command);
        await identity.resolve();
        return result;
      }), action === 'count' || action === 'publishInputBound', signal);
    } catch (error) {
      if (mutationReturned) throw new BudgetError('PENDING_RECONCILIATION');
      // Error surface mirrors gateway-pricing-request.composition: an
      // original-outcome unknown (dependency wait, lost acknowledgement) stays
      // a 409 reconcile; authorization denials from any original chain stay
      // denials; only the remainder is unavailable.
      if (error instanceof AiTaskRunnerError && (error as AiTaskRunnerError).code === 'AI_RESULT_UNKNOWN') throw new BudgetError('PENDING_RECONCILIATION');
      if (error instanceof ModelGatewayError && error.code === 'FORBIDDEN') throw denied();
      if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw denied();
      if (error instanceof AiScopeResolutionError && ['AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED'].includes(error.code)) throw denied();
      if (error instanceof BudgetError) throw error;
      throw new BudgetError('UNAVAILABLE');
    } finally { active = false; signal?.removeEventListener('abort', close); }
  }
}
