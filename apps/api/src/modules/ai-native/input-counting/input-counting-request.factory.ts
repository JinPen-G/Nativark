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
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { BudgetError } from '../budget/budget.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
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
import type { SecretBox } from '../../../common/secret-box';
import { AiScopeRepository } from '../ai-scope.repository';
import { TenantModelConfigurationAuthority } from '../tenant-model-config.authority';
import { createPersistedTenantModelConfiguration, createScopeBoundTenantModelConnection } from '../tenant-model-config.composition';
import { createAuthorizedPlatformModelConfiguration } from '../platform-model-config.composition';
import { gatewayBudgetPrincipal } from '../budget/gateway-budget-principal';
import { CountTokensGatewayPricingEvidenceSource } from './input-count-tokens.composition';
import type { AiExecutionContext, AiGatewayToolResultReferenceDraft } from '@rental-os/shared';
import { taskModelIdentity, type TaskModelPolicy } from '../model-input/task-model-input';
import { nativeToolResultReferenceSchema, resolvedNativeToolResultSchema,
  type NativeToolResultResolver } from '../model-input/native-tool-result.ports';

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
  /** Original server scene registration, not a detected provider capability. */
  nativeToolResults?: boolean;
  timeoutMs?: number;
}
export interface InputCountingNativeSourceRequest {
  reference: AiGatewayToolResultReferenceDraft;
  db: InputCountingRequestDependencies['db'];
  guard: InputCountingRequestDependencies['guard'];
  /** Request-local identity wrapper, not the singleton Auth dependency. */
  auth: InputCountingRequestDependencies['auth'];
  /** Current request session port for the original business Guard/ALS read.
   * Server-only; expires with the call and is never model or HTTP body data. */
  credentials: AiOrderRouteCredentialSource;
  execution: { authorize(taskId: string): Promise<AiExecutionContext> };
  /** Original read/action authority, distinct from new execution admission. */
  taskAuthority: Pick<AiTaskRepositoryAuthority, 'resolve'>;
  scenePolicy: TaskModelPolicy;
  clock: () => Date;
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
  /** Standard host: construct the existing encrypted connection resolvers only
   * inside this request, after the frozen invocation selects its original task.
   * Mutually exclusive with explicit resolver ports. Never HTTP body data. */
  connectionConfiguration?: { db: Parameters<typeof createAuthorizedPlatformModelConfiguration>[0]['db']
    & Parameters<typeof createPersistedTenantModelConfiguration>[0]['db']; secrets: SecretBox; platformProfileId: string };
  /** Optional platform-rate read delegate for bound publication alongside
   * counting evidence. */
  priceDelegate?: Pick<GatewayPricingEvidenceSource, 'readPrice'>;
  /** Omit only on an original-receipt host; absence never enables new dispatch
   * or pricing publication. Original settlement uses its stored price basis. */
  configuration?: InputCountingServerConfiguration;
  /** Build the original Task/Core resolver inside this request, after the
   * frozen invocation identifies its task/reference. Never a singleton bound
   * to another request, body material, default adapter or dispatch operation. */
  nativeToolResultsForRequest?: (input: InputCountingNativeSourceRequest) => NativeToolResultResolver | Promise<NativeToolResultResolver>;
  clock?: () => Date;
}

/** Request-local bridge to the existing private resolver. Its caller supplies
 * only server dependencies; original selectors come from the frozen reader.
 * Creation is lazy and occurs once, with no retry after a failed dependency. */
export function composeRequestNativeCountingSource(input: {
  create: NonNullable<InputCountingRequestDependencies['nativeToolResultsForRequest']>;
  request: Omit<InputCountingNativeSourceRequest, 'reference'>;
  task: { id(): string | undefined; resolve(): Promise<AiExecutionContext> };
  active(): boolean;
}): NativeToolResultResolver {
  if (typeof input?.create !== 'function' || input.request?.scenePolicy.nativeToolResults !== true
    || input.request.scenePolicy.orderExplainTool !== true || typeof input.task?.id !== 'function'
    || typeof input.task.resolve !== 'function' || typeof input.active !== 'function'
    || typeof input.request.taskAuthority?.resolve !== 'function'
    || typeof input.request.credentials?.current !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const request = { ...input.request, scenePolicy: Object.freeze(structuredClone(input.request.scenePolicy)) };
  let originalReference: string | undefined, source: Promise<NativeToolResultResolver> | undefined;
  const check = async (context: Parameters<NativeToolResultResolver['resolve']>[0],
    reference: AiGatewayToolResultReferenceDraft, signal: AbortSignal) => {
    const open = () => {
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      if (!input.active() || !input.task.id() || reference.taskId !== input.task.id()) throw new ModelGatewayError('FORBIDDEN');
    };
    open();
    const current = await input.task.resolve(); open();
    const { actorKind: _, ...principal } = gatewayBudgetPrincipal(current);
    if (hash(context) !== hash(principal)) throw new ModelGatewayError('FORBIDDEN');
    return taskModelIdentity(current);
  };
  const reference = (value: unknown) => {
    const parsed = nativeToolResultReferenceSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    return parsed.data;
  };
  return {
    async resolve(context, value, signal) {
      context = structuredClone(context);
      const selected = reference(value), before = await check(context, selected, signal), key = hash(selected);
      if (originalReference !== undefined && originalReference !== key) throw new ModelGatewayError('FORBIDDEN');
      if (!source) {
        originalReference = key;
        source = Promise.resolve().then(async () => {
          if (await check(context, selected, signal) !== before) throw new ModelGatewayError('FORBIDDEN');
          return input.create({ ...request, scenePolicy: structuredClone(request.scenePolicy), reference: structuredClone(selected) });
        });
      }
      const resolver = await source;
      if (await check(context, selected, signal) !== before) throw new ModelGatewayError('FORBIDDEN');
      if (typeof resolver?.resolve !== 'function' || typeof resolver.assertCurrent !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
      const result = resolvedNativeToolResultSchema.safeParse(structuredClone(await resolver.resolve(context, selected, signal)));
      if (!result.success || hash(result.data.reference) !== key) throw new ModelGatewayError('INVALID_RESPONSE');
      if (await check(context, selected, signal) !== before) throw new ModelGatewayError('FORBIDDEN');
      return result.data;
    },
    async assertCurrent(context, value, signal) {
      context = structuredClone(context);
      const material = resolvedNativeToolResultSchema.safeParse(structuredClone(value));
      if (!material.success) throw new ModelGatewayError('INVALID_REQUEST');
      const selected = reference(material.data.reference), before = await check(context, selected, signal);
      if (!source || originalReference !== hash(selected)) throw new ModelGatewayError('FORBIDDEN');
      const resolver = await source;
      if (typeof resolver?.resolve !== 'function' || typeof resolver.assertCurrent !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
      if (await check(context, selected, signal) !== before) throw new ModelGatewayError('FORBIDDEN');
      await resolver.assertCurrent(context, material.data, signal);
      if (await check(context, selected, signal) !== before) throw new ModelGatewayError('FORBIDDEN');
    }
  };
}
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const actions: readonly InputCountingRequestAction[] = ['count', 'observeCountKey', 'readCountReceipt',
  'publishInputBound', 'readInputBound', 'readPublication', 'usagePage', 'usageSummary', 'usagePricingBases', 'taskCosts'];
const hash = requestFingerprint;
const denied = () => new BudgetError('FORBIDDEN');

export class InputCountingRequestFactory {
  private readonly server: InputCountingRequestDependencies;
  constructor(server: InputCountingRequestDependencies) {
    if (!server || typeof server.auth?.resolveAccessContext !== 'function' || typeof server.guard?.canActivate !== 'function'
      || typeof server.db?.$transaction !== 'function' || typeof server.db.aiScope?.findFirst !== 'function'
      || typeof server.subscriptions?.readCategoryCommercialContext !== 'function'
      || server.resolvers !== undefined && (typeof server.resolvers.platform?.resolve !== 'function'
        || typeof server.resolvers.tenant?.resolve !== 'function')
      || server.transport !== undefined && typeof server.transport.post !== 'function'
      || server.nativeToolResultsForRequest !== undefined && typeof server.nativeToolResultsForRequest !== 'function'
      || server.connectionConfiguration !== undefined && (server.resolvers !== undefined
        || !Object.is(server.connectionConfiguration.db, server.db)
        || typeof server.connectionConfiguration.secrets?.encrypt !== 'function' || typeof server.connectionConfiguration.secrets?.decrypt !== 'function'
        || !z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u).safeParse(server.connectionConfiguration.platformProfileId).success)
      || server.configuration !== undefined && (!z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u).safeParse(server.configuration.sceneCode).success
        || !z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u).safeParse(server.configuration.countingPriceVersion).success
        || !server.configuration.toolPolicy || typeof server.configuration.toolPolicy !== 'object'
        || !Number.isSafeInteger(server.configuration.sceneMaxOutputTokens)
        || server.configuration.sceneMaxOutputTokens < 1 || server.configuration.sceneMaxOutputTokens > 32768
        || server.configuration.nativeToolResults !== undefined && typeof server.configuration.nativeToolResults !== 'boolean'
        || server.configuration.nativeToolResults === true && !server.configuration.toolPolicy.orderExplainTool)
      || server.clock !== undefined && typeof server.clock !== 'function') throw new BudgetError('UNAVAILABLE');
    this.server = Object.freeze({ ...server,
      ...(server.configuration ? { configuration: Object.freeze({ ...structuredClone(server.configuration),
        toolPolicy: Object.freeze(structuredClone(server.configuration.toolPolicy)) }) } : {}),
      ...(server.connectionConfiguration ? { connectionConfiguration: Object.freeze({ ...server.connectionConfiguration }) } : {}),
      ...(server.resolvers ? { resolvers: Object.freeze({ ...server.resolvers }) } : {}) });
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
    const credentials = Object.freeze({ current: async () => { if (!active) throw denied(); return { ...credential }; } });
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
        let originalTaskId: string | undefined;
        const invocation = { resolve: async () => {
          if (!originalTaskId || !active) throw denied();
          const current = await taskAuthorization.execution.authorize(originalTaskId);
          if (!active) throw denied();
          return current;
        } };
        const scenePolicy: TaskModelPolicy | undefined = configuration ? {
          sceneCode: configuration.sceneCode, maxOutputTokens: configuration.sceneMaxOutputTokens,
          ...(configuration.toolPolicy.orderExplainTool ? { orderExplainTool: true } : {}),
          ...(configuration.nativeToolResults === true ? { nativeToolResults: true } : {})
        } : undefined;
        const frozen = scenePolicy && action === 'count' ? new InputCountingFrozenInputReader({ db: server.db,
          execution: { authorize: async (taskId: string) => {
            if (originalTaskId !== undefined && originalTaskId !== taskId) throw denied();
            const context = await taskAuthorization.execution.authorize(taskId);
            if (!active) throw denied();
            originalTaskId = taskId;
            return context;
          } }, scenePolicy, clock }) : undefined;
        const nativeToolResults = action === 'count' && scenePolicy?.nativeToolResults === true && server.nativeToolResultsForRequest
          ? composeRequestNativeCountingSource({ create: server.nativeToolResultsForRequest,
            request: { db: server.db, auth, guard, credentials, scenePolicy, clock,
              execution: { authorize: async taskId => {
                if (taskId !== originalTaskId) throw denied();
                return invocation.resolve();
              } },
              taskAuthority: { resolve: async (taskId, action) => {
                if (!active || taskId !== originalTaskId) throw denied();
                const current = await taskAuthorization.authority.resolve(taskId, action);
                if (!active) throw denied();
                return current;
              } } }, task: { id: () => originalTaskId, resolve: invocation.resolve }, active: () => active })
          : undefined;
        let resolvers = server.resolvers;
        if (action === 'count' && server.connectionConfiguration) {
          const connection = server.connectionConfiguration;
          const configAuthority = new TenantModelConfigurationAuthority(guard, credentials, invocation);
          const tenantConfiguration = createPersistedTenantModelConfiguration({ db: connection.db, secrets: connection.secrets,
            authorize: configAuthority.authorize.bind(configAuthority) });
          const scopes = new AiScopeRepository(connection.db, invocation, clock);
          const tenant = createScopeBoundTenantModelConnection(tenantConfiguration, scopes);
          const platform = createAuthorizedPlatformModelConfiguration({ db: connection.db, guard, credentials,
            invocation, profileId: connection.platformProfileId, secrets: connection.secrets }).invocation;
          const boundResolver = (resolver: GatewayConnectionResolver): GatewayConnectionResolver => {
            const check = async (context: Parameters<GatewayConnectionResolver['resolve']>[0],
              profile: Parameters<GatewayConnectionResolver['resolve']>[1]) => {
              const principal = gatewayBudgetPrincipal(await invocation.resolve());
              if (!('tenantId' in context && 'workspaceId' in context) || principal.actorId !== context.actorId
                || principal.tenantId !== context.tenantId || principal.workspaceId !== context.workspaceId) throw denied();
              const selection = await tenantConfiguration.selectionForInvocation({ actorId: context.actorId,
                tenantId: context.tenantId, workspaceId: context.workspaceId });
              if (selection.mode !== profile.serviceMode) throw denied();
              return hash({ principal, selection });
            };
            return { resolve: async (context, profile) => {
              const before = await check(context, profile), result = await resolver.resolve(structuredClone(context), structuredClone(profile));
              if (!active || await check(context, profile) !== before) throw denied();
              return result;
            }, assertCurrent: async (context, profile) => {
              const before = await check(context, profile);
              await resolver.assertCurrent?.(structuredClone(context), structuredClone(profile));
              if (!active || await check(context, profile) !== before) throw denied();
            } };
          };
          resolvers = { tenant: boundResolver(tenant), platform: boundResolver(platform) };
        }
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
          authorization: countingAuthorization, budget, frozen, nativeToolResults,
          resolvers, transport: server.transport ?? (resolvers ? createNativeModelEgressTransport() : undefined),
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
