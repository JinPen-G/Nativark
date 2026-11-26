/** Tenant model accounting uses the original reservations, usage evidence and
 * settlement. The caller supplies current action grants on root or Native. */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import type { AiUsageAssociationDraft } from '@rental-os/platform-contracts/ai-usage';
import type { AiTaskTransactionBoundary } from '../../task-transactions';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import type { AiScopeRepository } from '../ai-scope.repository';
import { BudgetError, isOriginalBudgetLifecycleAction, type BudgetAction, type BudgetAuthority, type BudgetGrant } from './budget.ports';
import { BudgetGatewayAdapter } from './budget-gateway-adapter';
import { PersistedBudgetEvidenceAdapter } from './budget-dependency-adapters';
import { BudgetService, createPublicBudgetLedger } from './public-budget-ledger';
import { GatewayCallPricing } from './gateway-call-pricing';
import { GatewayRecordedPricing } from './gateway-recorded-pricing';
import { PrismaGatewayAccountingFacts } from './prisma-gateway-accounting-facts';
import { PersistentGatewayBudget } from './persistent-gateway-budget';
import type { GatewayInvocationStore } from './prisma-gateway-invocation.store';
import { gatewayTenantBudgetPrincipal } from './gateway-budget-principal';

type Tx = Prisma.TransactionClient;
type Resource = Parameters<BudgetAuthority['resolve']>[1];
const locator = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
/** New reserve/dispatch must use current scene and commercial policy. Original
 * accounting uses its own action policy. A supplied Native owns all DB reads. */
export type TenantGatewayBudgetGrant = (action: BudgetAction, context: Readonly<AiExecutionContext>, resource: Resource,
  database?: Tx) => Promise<Omit<BudgetGrant, 'context'>>;

export function createTenantGatewayAccounting(input: {
  db: ConstructorParameters<typeof PrismaGatewayAccountingFacts>[0] & ConstructorParameters<typeof GatewayRecordedPricing>[0];
  scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
  bindings: GatewayInvocationStore;
  transactions: AiTaskTransactionBoundary<Tx>;
  context(transaction?: Tx): Promise<AiExecutionContext>;
  grant: TenantGatewayBudgetGrant;
  clock: () => Date;
}) {
  const { db, bindings, transactions, scopes, clock } = input;
  const ledger = createPublicBudgetLedger({ db, taskTransactions: transactions, nativeAuthorization: true, clock });
  const recorded = new GatewayRecordedPricing(db, scopes, clock, true, bindings, 'tenant');
  const calls = (version: string) => new GatewayCallPricing(db, scopes, version, clock, true, bindings, 'tenant');
  const pricing = {
    async quote(...[command, grant]: Parameters<typeof recorded.quote>) {
      return command.association.config.serviceMode === 'tenant_managed'
        ? calls(command.association.priceVersion).quote(command, grant) : recorded.quote(command, grant);
    },
    quantity(...[record, usage]: Parameters<typeof recorded.quantity>) {
      return record.association.config.serviceMode === 'tenant_managed' && record.reserved.unit === 'calls'
        ? calls(record.association.priceVersion).quantity(record, usage) : recorded.quantity(record, usage);
    }
  };
  const authority: BudgetAuthority = { async resolve(action, resource, tx) {
    if (!resource.association || !isOriginalBudgetLifecycleAction(action) && action !== 'reserve' && action !== 'dispatch')
      throw new BudgetError('FORBIDDEN');
    const context = structuredClone(await input.context(tx));
    const caller = gatewayTenantBudgetPrincipal(context);
    if (resource.association.scope.kind !== 'tenant' || resource.association.scope.tenantId !== caller.tenantId)
      throw new BudgetError('FORBIDDEN');
    const grant = structuredClone(await input.grant(action, structuredClone(context), structuredClone(resource), tx));
    if (identity(await input.context(tx)) !== identity(context)) throw new BudgetError('FORBIDDEN');
    return { ...grant, context };
  } };
  const facts = new PrismaGatewayAccountingFacts(db, bindings, scopes, pricing, clock, transactions);
  const service = new BudgetService(ledger, authority, pricing, new PersistedBudgetEvidenceAdapter(facts), clock);
  const budget = new PersistentGatewayBudget(new BudgetGatewayAdapter(service, bindings), facts);
  async function original(value: string) {
    const parsed = locator.max(36).safeParse(value);
    if (!parsed.success) throw new BudgetError('INVALID');
    const { context } = await scopes.resolveCurrent(), { actorKind: _, ...caller } = gatewayTenantBudgetPrincipal(context);
    const binding = await bindings.resolveForReservation(caller, parsed.data);
    const record = await service.read(parsed.data, binding.association);
    return { binding, record };
  }
  const recovery = Object.freeze({
    async readCall(value: string) {
      const parsed = locator.safeParse(value);
      if (!parsed.success) throw new BudgetError('INVALID');
      const { context, scope } = await scopes.resolveCurrent(), caller = gatewayTenantBudgetPrincipal(context);
      if (scope.kind !== 'TENANT' || scope.tenantId !== caller.tenantId || scope.workspaceId !== undefined) throw new BudgetError('FORBIDDEN');
      const row = await db.aiBudgetReservation.findUnique({ where: { scopeId_scopeKind_callId: {
        scopeId: scope.id, scopeKind: 'TENANT', callId: parsed.data } },
        select: { id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true, actorId: true, callId: true } });
      if (!row) throw new BudgetError('PENDING_RECONCILIATION');
      if (row.scopeKind !== 'TENANT' || row.scopeId !== scope.id || row.tenantId !== caller.tenantId || row.workspaceId !== null
        || row.actorId !== caller.actorId || row.callId !== parsed.data) throw new BudgetError('FORBIDDEN');
      const { record } = await original(row.id);
      if (record.callId !== parsed.data || record.scopeId !== scope.id || record.actorId !== caller.actorId
        || identity((await scopes.resolveCurrent()).context) !== identity(context)) throw new BudgetError('FORBIDDEN');
      return record;
    },
    async reconcile(reservationId: string) {
      const { binding, record } = await original(reservationId);
      const evidenceRef = await facts.originalUsageReference(record.id);
      if (record.status === 'settled') {
        const verified = await facts.readUsage(record.id, evidenceRef, true), current = await original(record.id);
        if (current.record.status !== 'settled' || requestFingerprint(current.record.actual) !== requestFingerprint(verified.quantity))
          throw new BudgetError('PENDING_RECONCILIATION');
        return current.record;
      }
      return service.reconcile(record.id, binding.association, requestFingerprint({
        method: 'persisted-original-usage-reconcile-1', reservationId: record.id, evidenceRef, association: binding.association }), evidenceRef);
    },
    async releaseUnsent(reservationId: string) {
      const { binding, record } = await original(reservationId);
      if (record.dispatched || !['reserved', 'released'].includes(record.status)
        || (await facts.readDispatch(record.id)).state !== 'not_dispatched') throw new BudgetError('PENDING_RECONCILIATION');
      if (record.status === 'released') return (await original(record.id)).record;
      return service.release(record.id, binding.association, requestFingerprint({
        method: 'persisted-original-unsent-release-1', reservationId: record.id, association: binding.association }));
    }
  });
  return { budget, recovery, async assertDispatch(tx: Tx, reservationId: string, association: AiUsageAssociationDraft) {
    const grant = await authority.resolve('dispatch', { reservationId, association }, tx);
    if (grant.entitled !== true || !(grant.expiresAt instanceof Date) || !(grant.expiresAt > clock())) throw new BudgetError('FORBIDDEN');
  }, async readDispatch(reservationId: string) {
    const { record } = await original(reservationId), evidence = await facts.readDispatch(record.id);
    const current = await original(record.id);
    if (current.record.scopeId !== record.scopeId || current.record.callId !== record.callId
      || current.record.actorId !== record.actorId) throw new BudgetError('FORBIDDEN');
    return evidence;
  } };
}

const identity = ({ requestId: _request, authorizedAt: _at, ...value }: AiExecutionContext) => requestFingerprint(value);
