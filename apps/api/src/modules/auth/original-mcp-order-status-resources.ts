/** Original order-resource preflight in the caller's Native transaction.
 * Reuses real Auth/tickets, order GET Guard/ALS, Core/fact-store and original scene
 * projection/preparation. Legacy status-only entry stays closed to other questions.
 * Optional history/finance/action gaps stay explicit; no Web/global fallback,
 * quote/payment/action execution, model call, field release or MCP publication. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import { AI_CONTRACT_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, type AiExecutionContext, type AiSceneRequestBody } from '@rental-os/shared';
import type { OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { MCP_BUSINESS_CAPABILITIES } from '@rental-os/mcp-server/capability-mapping' with { 'resolution-mode': 'import' };
import type { AuthService } from './auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { RentalCoreService } from '../rental-core/rental-core.service';
import type { RentalBusinessService } from '../rental-core/rental-business.service';
import { AiNativeOrderSavedQuoteSource } from '../ai-native/tools/order-saved-quote.source';
import type { OriginalMcpCatalogReadContext } from './original-mcp-read-context';
import { captureOriginalMcpRequestCall, createOriginalMcpRequestScopeSource } from './original-mcp-request-scope';
import { isAiStepExecutionContext } from '../ai-native/task-contract-validation';
import { originalIdentityHash } from '../ai-native/task-request/original-request.authority';
import { freezeOriginalInput, parseOriginalRequest, originalBody } from '../ai-native/task-request/original-request.validation';
import { AiTaskRepositoryError } from '../ai-native/ai-task.repository';
import type { AiOrderRouteContextAuthority } from '../ai-native/order-route-context.authority';
import { AiOrderReadFactsService } from '../ai-native/order-read-facts.service';
import { AiOrderExplanationFactsService } from '../ai-native/tools/order-explanation-facts.service';
import { AiOrderExplanationPreparationService } from '../ai-native/tools/order-explanation-preparation.service';
import { AiOrderNextStepsService } from '../ai-native/tools/order-next-steps.service';
import { AiOrderInspectionFactsService } from '../ai-native/tools/order-inspection-facts.service';
import { AiOrderPaymentFactsService } from '../ai-native/tools/order-payment-facts.service';
import type { PaymentRuntimeService } from '../integrations/payment.runtime.service';
import type { AiBusinessReadAuthority } from '../ai-native/business-read-route.authority';
import type { RequestIdentity } from '../../common/request-identity';

export interface OriginalMcpOrderResources {
  authorizeResourcesIn(body: AiSceneRequestBody, native: Prisma.TransactionClient, signal: AbortSignal): Promise<AiExecutionContext>;
}
export type OriginalMcpOrderStatusResources = OriginalMcpOrderResources;
type OrderResourceDependencies = [
  mcp: { MCP_BUSINESS_CAPABILITIES: typeof MCP_BUSINESS_CAPABILITIES }, context: OriginalMcpCatalogReadContext,
  call: OriginalMcpReadCallRef, requiredScopes: readonly string[],
  auth: Pick<AuthService, 'withTrustedWorkspacePrincipal'>, guard: Pick<ApiAuthGuard, 'withTrustedOrderRead'>,
  core: Pick<RentalCoreService, 'getOrderInTransaction'>, clock?: () => Date,
  originalQuotes?: Pick<RentalBusinessService, 'readQuoteInTransaction'>,
  originalInspections?: Pick<RentalCoreService, 'listInspectionsPageInTransaction'>,
  originalPayments?: {
    source: Pick<PaymentRuntimeService, 'listPaymentIntentsPageInTransaction' | 'listPaymentRefundsPageInTransaction'>;
    guard: Pick<ApiAuthGuard, 'withTrustedOrderPaymentRead'>;
  }
];
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
/** Preserve the legacy status-only consumer. Adding the broader original reader
 * must not silently enable other questions in an existing status-bound host. */
export function createOriginalMcpOrderStatusResources(...input: OrderResourceDependencies): OriginalMcpOrderStatusResources {
  return createOrderResources('status', input);
}
/** Original order questions only, with the original optional-evidence semantics.
 * Owner supplies approved tool scopes; names/mapping never grant permission.
 * Construct inside the authorized callback; this returns no business material. */
export function createOriginalMcpOrderResources(...input: OrderResourceDependencies): OriginalMcpOrderResources {
  return createOrderResources('all', input);
}
function createOrderResources(mode: 'status' | 'all', [mcp, context, raw, requiredScopes, auth, guard, core,
  clock = () => new Date(), originalQuotes, originalInspections, originalPayments]: OrderResourceDependencies): OriginalMcpOrderResources {
  const mapping = mcp?.MCP_BUSINESS_CAPABILITIES?.find(row => row.code === 'rental.order.explain');
  if (!mapping || mapping.operation !== 'read' || typeof context?.current !== 'function'
    || typeof auth?.withTrustedWorkspacePrincipal !== 'function' || typeof guard?.withTrustedOrderRead !== 'function'
    || typeof core?.getOrderInTransaction !== 'function' || !Array.isArray(requiredScopes) || !requiredScopes.length
    || requiredScopes.some(value => typeof value !== 'string' || !value || /\s/u.test(value))) throw unavailable();
  if (originalQuotes !== undefined && typeof originalQuotes?.readQuoteInTransaction !== 'function') throw unavailable();
  const originalQuoteRead = originalQuotes?.readQuoteInTransaction.bind(originalQuotes);
  if (originalInspections !== undefined && typeof originalInspections?.listInspectionsPageInTransaction !== 'function') throw unavailable();
  const originalInspectionRead = originalInspections?.listInspectionsPageInTransaction.bind(originalInspections);
  if (originalPayments !== undefined && (typeof originalPayments?.source?.listPaymentIntentsPageInTransaction !== 'function'
    || typeof originalPayments?.source?.listPaymentRefundsPageInTransaction !== 'function'
    || typeof originalPayments?.guard?.withTrustedOrderPaymentRead !== 'function')) throw unavailable();
  const intentRead = originalPayments?.source.listPaymentIntentsPageInTransaction.bind(originalPayments.source);
  const refundRead = originalPayments?.source.listPaymentRefundsPageInTransaction.bind(originalPayments.source);
  const withFinance = originalPayments?.guard.withTrustedOrderPaymentRead.bind(originalPayments.guard);
  const call = captureOriginalMcpRequestCall(raw), current = context.current.bind(context);
  if (call.toolName !== mapping.name || requiredScopes.some(value => !call.authorization.scopes.includes(value))) throw unavailable();
  const subject = structuredClone(current(call)), scopes = createOriginalMcpRequestScopeSource(context, clock);
  const withPrincipal = auth.withTrustedWorkspacePrincipal.bind(auth), withOrder = guard.withTrustedOrderRead.bind(guard);
  const getOrder = core.getOrderInTransaction.bind(core);
  const live = (signal: AbortSignal) => { if (signal.aborted || !isDeepStrictEqual(subject, structuredClone(current(call)))) throw unavailable(); };
  return Object.freeze({ async authorizeResourcesIn(rawBody: AiSceneRequestBody, native: Prisma.TransactionClient, signal: AbortSignal) {
    live(signal);
    if (!native || '$transaction' in native) throw unavailable();
    const body = originalBody(parseOriginalRequest({ ...structuredClone(rawBody), draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: 'resource-check' }));
    if (body.sceneCode !== 'order_explanation' || (mode === 'status' && body.input.question !== 'status')) throw unavailable();
    const expected = await scopes.currentIn(call, native, signal); live(signal);
    const orderId = body.input.orderId;
    const read = async <T>(consume: (value: AiExecutionContext, id: string) => Promise<T>,
      finance?: { kind: 'payment_intents' | 'payment_refunds'; input: unknown }): Promise<T> => {
      live(signal);
      return withPrincipal(native, async (tx, stop) => {
        live(stop); if (tx !== native) throw unavailable();
        const original = current(call);
        if (!original.userId || !original.tenantId || !original.workspaceId || original.audience !== 'operator') throw unavailable();
        return { userId: original.userId, tenantId: original.tenantId, workspaceId: original.workspaceId, audience: 'operator' };
      }, signal, resolve => {
        const authorized = async (identity: RequestIdentity) => {
          live(signal);
          const now = clock();
          if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
          const candidate = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: call.callId, authorizedAt: now.toISOString(),
            audience: 'operator', actor: { kind: 'user', userId: identity.userId },
            scope: { kind: 'workspace', tenantId: identity.tenantId, workspaceId: identity.workspaceId },
            access: { permissions: [...(identity.permissions ?? [])], dataScope: identity.dataScope, locationScope: identity.locationScope,
              ...(identity.organizationId === undefined ? {} : { organizationId: identity.organizationId }) } };
          if (!isAiStepExecutionContext(candidate) || originalIdentityHash(candidate) !== originalIdentityHash(expected.context)) throw unavailable();
          const result = await consume(freezeOriginalInput(structuredClone(candidate)), orderId); live(signal);
          return result;
        };
        if (finance) {
          if (!withFinance) throw unavailable();
          return withFinance(finance.kind, finance.input, resolve, authorized, signal);
        }
        return withOrder(orderId, resolve, authorized, signal);
      });
    };
    const authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead' | 'resolve'> = {
      withOrderRead: read, resolve: () => read(async value => value)
    };
    // The quote ID comes only from the guarded original order; current pricing
    // context is never a historical source. Absence retains original not_loaded.
    const history = originalQuoteRead ? new AiNativeOrderSavedQuoteSource({ readQuoteInTransaction: originalQuoteRead },
      { getOrderInTransaction: getOrder }, authority, native, signal, () => live(signal)) : undefined;
    const facts = new AiOrderReadFactsService({ readOrderFacts: async (tenant, id) => { live(signal); const order = await getOrder(tenant, id, native, signal, () => live(signal)); live(signal); return { ...order, workspaceId: expected.context.scope.kind === 'workspace' ? expected.context.scope.workspaceId : '' }; } }, authority, clock, history);
    // Optional persisted observations use the same order authority/Native; the
    // original reader bounds and projects them, never loads templates or URLs.
    const inspections = originalInspectionRead ? new AiOrderInspectionFactsService({
      getOrder: (tenant, id) => { live(signal); return getOrder(tenant, id, native, signal, () => live(signal)); },
      listInspectionsPage: (tenant, id, query) => { live(signal); return originalInspectionRead(tenant, id, query, native, signal, () => live(signal)); }
    }, authority, clock) : undefined;
    const paymentRoutes: AiBusinessReadAuthority = { withRead: async (kind, input, consume) => {
      live(signal);
      if ((kind !== 'payment_intents' && kind !== 'payment_refunds') || !input || typeof input !== 'object'
        || Array.isArray(input) || !('orderId' in input) || input.orderId !== orderId) throw unavailable();
      return read(value => consume(value), { kind, input: structuredClone(input) });
    } };
    const payments = intentRead && refundRead ? new AiOrderPaymentFactsService({
      // The original facts service requires these legacy signatures, but this
      // bounded Native source must never fall back to an unbounded/global list.
      listPaymentIntents: async () => { throw unavailable(); }, listPaymentRefunds: async () => { throw unavailable(); },
      listPaymentIntentsPage: (tenant, space, id, query) => { live(signal); return intentRead(tenant, space, id, query, native, signal, () => live(signal)); },
      listPaymentRefundsPage: (tenant, space, id, intent, query) => { live(signal); return refundRead(tenant, space, id, intent, query, native, signal, () => live(signal)); }
    }, { getOrder: (tenant, id) => { live(signal); return getOrder(tenant, id, native, signal, () => live(signal)); } }, authority, paymentRoutes, clock) : undefined;
    const explanation = new AiOrderExplanationFactsService(authority, facts, payments, clock, inspections);
    const prepare = new AiOrderExplanationPreparationService(authority, explanation, new AiOrderNextStepsService(authority, explanation));
    await prepare.prepare({ question: body.input.question }); live(signal);
    const after = await scopes.currentIn(call, native, signal); live(signal);
    if (after.scopeId !== expected.scopeId || originalIdentityHash(after.context) !== originalIdentityHash(expected.context)) throw unavailable();
    return after.context;
  } });
}
