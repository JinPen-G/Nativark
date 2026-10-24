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
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { BudgetError } from '../budget/budget.ports';
import { createPersistedBudgetSubsystem } from '../budget/budget.module';
import { GatewayPricingRecordManagement } from '../budget/prisma-gateway-pricing-records';
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
  /** Must mirror the scene's task-gateway registration. */
  toolPolicy?: { orderExplainTool?: { name: string; version: typeof AI_TOOL_DRAFT_VERSION } };
  timeoutMs?: number;
}
export interface InputCountingRequestDependencies {
  db: CountTokensServiceDb & InputCountingFrozenReaderDb & ConstructorParameters<typeof TaskBudgetUsageReader>[0]
    & Pick<RentalCoreService, never>;
  auth: Pick<AuthService, 'resolveAccessContext'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
  /** Platform/tenant connection resolvers from the server's model-config
   * compositions; never request-supplied. */
  resolvers: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver };
  transport?: ModelJsonTransport;
  /** Optional platform-rate read delegate for bound publication alongside
   * counting evidence. */
  priceDelegate?: Pick<GatewayPricingEvidenceSource, 'readPrice'>;
  configuration: InputCountingServerConfiguration;
  clock?: () => Date;
}
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const actions: readonly InputCountingRequestAction[] = ['count', 'observeCountKey', 'readCountReceipt',
  'publishInputBound', 'readInputBound', 'readPublication', 'usagePage', 'usageSummary', 'usagePricingBases', 'taskCosts'];
const hash = (value: unknown) => {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item as Record<string, unknown>)
      .sort().map(key => [key, canonical((item as Record<string, unknown>)[key])])) : item;
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};
const denied = () => new BudgetError('FORBIDDEN');

export class InputCountingRequestFactory {
  constructor(private readonly server: InputCountingRequestDependencies) {
    if (!server || typeof server.auth?.resolveAccessContext !== 'function' || typeof server.guard?.canActivate !== 'function'
      || typeof server.db?.$transaction !== 'function' || typeof server.db.aiScope?.findFirst !== 'function'
      || typeof server.subscriptions?.readCategoryCommercialContext !== 'function'
      || !server.resolvers?.platform || typeof server.resolvers.platform.resolve !== 'function'
      || !server.resolvers.tenant || typeof server.resolvers.tenant.resolve !== 'function'
      || server.transport !== undefined && typeof server.transport.post !== 'function'
      || !server.configuration || !z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u).safeParse(server.configuration.sceneCode).success
      || !z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u).safeParse(server.configuration.countingPriceVersion).success
      || server.clock !== undefined && typeof server.clock !== 'function') throw new BudgetError('UNAVAILABLE');
    Object.freeze(server.resolvers);
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
        const taskAuthorization = composePersistedTaskAuthorization({ db: server.db as never, auth, credentials,
          subscriptions: server.subscriptions, clock });
        const frozen = new InputCountingFrozenInputReader({ db: server.db,
          execution: { authorize: async (taskId: string) => taskAuthorization.execution.authorize(taskId) },
          scenePolicy: { sceneCode: configuration.sceneCode,
            maxOutputTokens: 32768,
            ...(configuration.toolPolicy?.orderExplainTool ? { orderExplainTool: true } : {}) }, clock });
        const countingAuthorization = new InputCountTokensAuthorizationSource(
          { db: server.db as never, auth, credentials, subscriptions: server.subscriptions, guard, clock } as never, server.db as never);
        const quotes = new InputCountTokensCallPricing(server.db as never, countingAuthorization.scopes,
          configuration.countingPriceVersion, clock);
        const evidence = new InputCountTokensEvidence(server.db as never);
        const budget = createPersistedBudgetSubsystem({ db: server.db as never, subscriptions: server.subscriptions,
          authorization: countingAuthorization, quotes, evidence, clock });
        const service = new InputCountTokensService({ db: server.db, scopes: countingAuthorization.scopes,
          authorization: countingAuthorization, budget, frozen,
          resolvers: server.resolvers, transport: server.transport ?? createNativeModelEgressTransport(),
          policyOptions: configuration.toolPolicy ?? { orderExplainTool: { name: 'rental_order_explain', version: AI_TOOL_DRAFT_VERSION } },
          sceneCode: configuration.sceneCode, countingPriceVersion: configuration.countingPriceVersion,
          ...(configuration.timeoutMs !== undefined ? { timeoutMs: configuration.timeoutMs } : {}), clock });
        const pricingEvidence = new CountTokensGatewayPricingEvidenceSource(server.db, server.priceDelegate);
        const management = new GatewayPricingRecordManagement(server.db as never, countingAuthorization.scopes,
          countingAuthorization, pricingEvidence, new PrismaGatewayInvocationBindings(server.db as never,
          countingAuthorization.scopes, clock), configuration.sceneCode, clock);
        const usage = new TaskBudgetUsageReader(server.db as never, taskAuthorization.authority,
          countingAuthorization.scopes, clock);
        const observation = composeTaskCostObservation({ db: server.db as never, actions: taskAuthorization.authority,
          scopes: countingAuthorization.scopes, counting: { readCountReceipt: cmd => service.readCountReceipt(cmd) }, clock });
        let result: unknown;
        if (action === 'count') {
          const receipt = await service.count(command, signal);
          const replay = await service.count(command, signal);
          const stable = (item: unknown) => { const { admission: _admission, ...rest } = (item ?? {}) as Record<string, unknown>; return rest; };
          if (hash(stable(receipt)) !== hash(stable(replay))) throw new BudgetError('PENDING_RECONCILIATION');
          mutationReturned = true; result = receipt;
        } else if (action === 'observeCountKey') result = await service.observeCountKey(command);
        else if (action === 'readCountReceipt') {
          const receipt = await service.readCountReceipt(command);
          if (hash(receipt) !== hash(await service.readCountReceipt(command))) throw new BudgetError('PENDING_RECONCILIATION');
          result = receipt;
        } else if (action === 'publishInputBound') {
          const receipt = await management.publishInputBound(command);
          mutationReturned = true; result = receipt;
        } else if (action === 'readInputBound') {
          const original = await management.readInputBound(command);
          if (hash(original) !== hash(await management.readInputBound(command))) throw new BudgetError('PENDING_RECONCILIATION');
          result = original;
        } else if (action === 'readPublication') {
          const original = await management.readPublication(command);
          if (hash(original) !== hash(await management.readPublication(command))) throw new BudgetError('PENDING_RECONCILIATION');
          result = original;
        } else if (action === 'usagePage') result = await usage.read(command);
        else if (action === 'usageSummary') result = await usage.summary(command);
        else if (action === 'usagePricingBases') result = await usage.pricingBases(command);
        else result = await observation.taskCosts(command);
        await identity.resolve();
        return result;
      }), action === 'count' || action === 'publishInputBound', signal);
    } catch (error) {
      if (mutationReturned) throw new BudgetError('PENDING_RECONCILIATION');
      if (error instanceof BudgetError) throw error;
      throw new BudgetError('UNAVAILABLE');
    } finally { active = false; signal?.removeEventListener('abort', close); }
  }
}

/** Explicit opt-in factory; no Nest provider or route is registered here. */
export function createInputCountingRequestFactory(dependencies: InputCountingRequestDependencies,
  options: { enabled?: boolean } = {}) {
  if (options.enabled !== true) return null;
  return new InputCountingRequestFactory(dependencies);
}
