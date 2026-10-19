import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiScopeResolutionError } from '../ai-scope.repository';
import { BudgetError } from './budget.ports';
import { PrismaTaskBudgetAuthorizationSource } from './prisma-task-budget-authorization.source';
import { createRecordedPricingGatewayBudget, createRecordedPricingGatewayAccountingRecovery } from './gateway-budget.composition';
import { GatewayPricingRecordManagement } from './prisma-gateway-pricing-records';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import type { AiRequestAbortSource } from '../scenes/request-abort';
import { ModelGatewayError } from '../model-gateway.ports';

type ServerDependencies = Omit<ConstructorParameters<typeof PrismaTaskBudgetAuthorizationSource>[0], 'credentials' | 'taskId'>
  & Pick<Parameters<typeof createRecordedPricingGatewayBudget>[0], 'db' | 'sceneCode'>
  & Partial<Pick<Parameters<typeof createRecordedPricingGatewayBudget>[0], 'pricingEvidence'>>;
export type GatewayPricingRequestAction = 'publishPrice' | 'publishInputBound' | 'readPublication' | 'readPrice' | 'readInputBound' | 'readPricing' | 'readPricingCall';
export type GatewayPricingHttpRequest = { headers: { authorization?: unknown } } & AiRequestAbortSource;
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const actions = ['publishPrice', 'publishInputBound', 'readPublication', 'readPrice', 'readInputBound', 'readPricing', 'readPricingCall'];
const denied = () => new BudgetError('FORBIDDEN');
const priceSummary = (record: Awaited<ReturnType<GatewayPricingRecordManagement['readPrice']>>) => {
  const price = record.evidence, billing = price.billing;
  return { id: record.id, evidenceHash: record.hash, priceVersion: price.priceVersion,
    configurationHash: hash(price.configuration), unit: billing.unit, scale: billing.scale,
    currency: billing.unit === 'money' ? billing.currency : null, rounding: billing.rounding,
    validFrom: price.validFrom, expiresAt: price.expiresAt,
    executionPermission: false as const, configurationMeaning: 'historical_reference_not_current_selection' as const };
};
const boundSummary = (record: Awaited<ReturnType<GatewayPricingRecordManagement['readInputBound']>>) => ({
  id: record.id, evidenceHash: record.hash, inputFingerprint: record.evidence.intentHash,
  maxInputTokens: record.evidence.maxInputTokens, maxOutputTokens: record.evidence.maxOutputTokens,
  method: record.evidence.method, validFrom: record.evidence.validFrom, expiresAt: record.evidence.expiresAt,
  price: priceSummary(record.price), executionPermission: false as const
});

/** Current Auth/ALS request boundary. Historical reservation pricing reads
 * need only stored evidence; publishing still requires the trusted producer.
 * Neither path selects a model, grants dispatch or starts a background job. */
export class GatewayPricingRequestFactory {
  private readonly server: ServerDependencies;
  /** No live price source and no scene selected by the HTTP caller. Price
   * records are workspace-wide; an input bound additionally derives its exact
   * scene from the owned original invocation after current read authorization. */
  static history(input: Omit<ServerDependencies, 'sceneCode' | 'pricingEvidence'>) {
    if ('pricingEvidence' in input || 'sceneCode' in input) throw new BudgetError('UNAVAILABLE');
    return new GatewayPricingRequestFactory({ ...input, sceneCode: 'ai.pricing.history' }, true);
  }
  constructor(input: ServerDependencies, private readonly historyOnly = false) {
    if (!input || Object.keys(input).some(key => !['db', 'auth', 'guard', 'subscriptions', 'clock', 'pricingEvidence', 'sceneCode'].includes(key))
      || typeof input.auth?.resolveAccessContext !== 'function' || typeof input.guard?.canActivate !== 'function'
      || typeof input.db?.$transaction !== 'function' || typeof input.db.aiScope?.findFirst !== 'function'
      || input.pricingEvidence !== undefined && (typeof input.pricingEvidence?.readPrice !== 'function'
        || typeof input.pricingEvidence.readInputBound !== 'function')
      || typeof input.subscriptions?.readCategoryCommercialContext !== 'function'
      || !z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u).safeParse(input.sceneCode).success
      || input.clock !== undefined && typeof input.clock !== 'function') throw new BudgetError('UNAVAILABLE');
    this.server = { ...input, ...(input.pricingEvidence ? { pricingEvidence: Object.freeze({
      readPrice: input.pricingEvidence.readPrice.bind(input.pricingEvidence),
      readInputBound: input.pricingEvidence.readInputBound.bind(input.pricingEvidence) }) } : {}) };
  }
  async call(request: GatewayPricingHttpRequest, action: GatewayPricingRequestAction, value: unknown, signal?: AbortSignal) {
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success) throw denied();
    if (!actions.includes(action)) throw new BudgetError('INVALID');
    if (this.historyOnly && !['readPrice', 'readPublication', 'readInputBound'].includes(action)) throw denied();
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
    const auth: ServerDependencies['auth'] = { resolveAccessContext: async (authorization, options) => {
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
    const guard: ServerDependencies['guard'] = { canActivate: async execution => {
      await identity.resolve();
      if (await server.guard.canActivate(execution) !== true) throw denied();
      const context = await identity.resolve(), stored = getRequestIdentity();
      if (!stored || context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || !('access' in context)
        || stored.userId !== context.actor.userId || stored.tenantId !== context.scope.tenantId || stored.workspaceId !== context.scope.workspaceId
        || stored.staffApi || stored.isSaasAdmin || stored.dataScope !== context.access.dataScope
        || hash(stored.locationScope) !== hash(context.access.locationScope)) throw denied();
      return true;
    } };
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        await identity.resolve();
        const authorization = new PrismaTaskBudgetAuthorizationSource({ db: server.db, auth, credentials,
          subscriptions: server.subscriptions, guard, clock });
        let result: unknown;
        const accounting = { db: server.db, scopes: authorization.scopes, authorization,
          subscriptions: server.subscriptions, clock };
        if (action === 'readPricing' || action === 'readPricingCall') {
          const recovery = createRecordedPricingGatewayAccountingRecovery(accounting);
          result = await recovery[action](command);
        } else {
          // Reopening immutable history needs current management authority,
          // not a live producer, current profile or dispatch-capable adapter.
          const publishing = action === 'publishPrice' || action === 'publishInputBound';
          if (publishing && !server.pricingEvidence) throw new BudgetError('UNAVAILABLE');
          let sceneCode = server.sceneCode;
          if (this.historyOnly && action === 'readInputBound') {
            const parsed = z.object({ callId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u) }).strict().safeParse(command);
            if (!parsed.success) throw new BudgetError('INVALID');
            const current = structuredClone(await authorization.scopes.resolveCurrent());
            await authorization.authorize('settings_read', current.context, {
              policy: { scopeId: current.scope.id, scopeKind: 'WORKSPACE', sceneCode } });
            const row = structuredClone(await server.db.aiGatewayInvocation.findUnique({ where: {
              scopeId_callId: { scopeId: current.scope.id, callId: parsed.data.callId } },
              select: { scopeId: true, actorId: true, callId: true, sceneCode: true } }));
            if (!active || !row || current.context.actor.kind !== 'user' || row.actorId !== current.context.actor.userId
              || row.scopeId !== current.scope.id || row.callId !== parsed.data.callId
              || !z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u).safeParse(row.sceneCode).success) throw denied();
            sceneCode = row.sceneCode;
          }
          const management = publishing && server.pricingEvidence
            ? createRecordedPricingGatewayBudget({ ...accounting,
              pricingEvidence: server.pricingEvidence, sceneCode: server.sceneCode }).pricingRecords
            : new GatewayPricingRecordManagement(server.db, authorization.scopes, authorization,
              undefined, undefined, sceneCode, clock);
          if (action === 'publishPrice') {
            const receipt = await management.publishPrice(command);
            mutationReturned = true;
            const original = await management.readPublication(command);
            if (original.id !== receipt.id || original.hash !== receipt.payloadHash) throw new BudgetError('PENDING_RECONCILIATION');
            result = receipt;
          } else if (action === 'publishInputBound') {
            const receipt = await management.publishInputBound(command);
            mutationReturned = true;
            const original = await management.readInputBound({ callId: receipt.callId });
            if (original.id !== receipt.id || original.hash !== receipt.payloadHash) throw new BudgetError('PENDING_RECONCILIATION');
            result = receipt;
          } else if (action === 'readInputBound') {
            const original = await management.readInputBound(command);
            if (hash(original) !== hash(await management.readInputBound(command))) throw new BudgetError('PENDING_RECONCILIATION');
            result = boundSummary(original);
          } else {
            const original = action === 'readPrice' ? await management.readPrice(command) : await management.readPublication(command);
            const again = action === 'readPrice' ? await management.readPrice(command) : await management.readPublication(command);
            if (hash(original) !== hash(again)) throw new BudgetError('PENDING_RECONCILIATION');
            result = priceSummary(original);
          }
        }
        await identity.resolve();
        return result;
      }), action === 'publishPrice' || action === 'publishInputBound', signal);
    } catch (error) {
      if (mutationReturned) throw new BudgetError('PENDING_RECONCILIATION');
      if (error instanceof BudgetError) throw error;
      if (error instanceof ModelGatewayError && error.code === 'FORBIDDEN') throw denied();
      if (error instanceof Error && 'code' in error && error.code === 'AI_RESULT_UNKNOWN') throw new BudgetError('PENDING_RECONCILIATION');
      if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw denied();
      if (error instanceof AiScopeResolutionError && ['AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED'].includes(error.code)) throw denied();
      throw new BudgetError('UNAVAILABLE');
    } finally { active = false; signal?.removeEventListener('abort', close); }
  }
}

export function createGatewayPricingRequestConsumer(options: { enabled?: boolean; dependencies?: ServerDependencies } = {}) {
  if (options.enabled !== true) return null;
  if (!options.dependencies) throw new BudgetError('UNAVAILABLE');
  return new GatewayPricingRequestFactory(options.dependencies);
}
