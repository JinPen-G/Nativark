import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AiScopeRepository } from '../ai-scope.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';
import { BudgetError, type BudgetGrant, type BudgetQuotePort, type BudgetRecord, type BudgetReserveCommand } from './budget.ports';
import type { GatewayActualUsagePricing } from './prisma-gateway-accounting-facts';
import type { ModelUsage } from '../model-gateway.ports';
import { gatewayBudgetPrincipal } from './gateway-budget-principal';
import { byokMeterScene, ensureByokMeterPolicy } from './byok-usage-meter';

const identity = (context: AiExecutionContext) => {
  const { requestId: _id, authorizedAt: _at, ...value } = context;
  return requestFingerprint(value);
};

/** Actual original invocation count, NOT a monetary/provider-price estimate or
 * token tokenizer. Opt-in server version, all three policies must use calls.
 * Repository transactions still enforce current gates/limits and one ledger.
 */
export class PrismaGatewayCallPricing implements BudgetQuotePort, GatewayActualUsagePricing {
  private readonly bindings;
  constructor(private readonly db: ConstructorParameters<typeof PrismaGatewayInvocationBindings>[0]
    & Pick<PrismaClient, 'aiBudgetPolicy'>, private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly priceVersion: string, private readonly clock: () => Date = () => new Date(),
    private readonly automaticByokMetering = false) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(priceVersion)
      || typeof db?.aiBudgetPolicy?.findFirst !== 'function') throw new BudgetError('UNAVAILABLE');
    this.bindings = new PrismaGatewayInvocationBindings(db, scopes, clock);
  }
  private async current() {
    const result = structuredClone(await this.scopes.resolveCurrent());
    const context = result.context;
    const principal = gatewayBudgetPrincipal(context);
    if (result.scope.kind !== 'WORKSPACE' || principal.tenantId !== result.scope.tenantId
      || principal.workspaceId !== result.scope.workspaceId) throw new BudgetError('FORBIDDEN');
    const { actorKind: _, ...gateway } = principal;
    return { ...result, gateway };
  }
  async quote(value: Readonly<BudgetReserveCommand>, grantValue: Readonly<BudgetGrant>) {
    const command = structuredClone(value), grant = structuredClone(grantValue), before = await this.current();
    if (!grant.entitled || identity(grant.context) !== identity(before.context)
      || command.association.priceVersion !== this.priceVersion || command.callId !== command.association.requestId) throw new BudgetError('FORBIDDEN');
    const row = await this.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
      scopeId: before.scope.id, callId: command.callId } } });
    if (!row || row.scopeId !== before.scope.id || row.actorId !== before.gateway.actorId || row.sceneCode !== command.sceneCode) throw new BudgetError('FORBIDDEN');
    const binding = structuredClone(await this.bindings.resolveForReserve(before.gateway, {
      callId: row.callId, model: command.association.config.model, maxOutputTokens: row.maxOutputTokens, intentHash: row.intentHash,
    }));
    if (requestFingerprint(binding.association) !== requestFingerprint(command.association)) throw new BudgetError('FORBIDDEN');
    const policies = [];
    for (const scope of [{ kind: 'platform' as const }, { kind: 'tenant' as const, tenantId: before.gateway.tenantId },
      { kind: 'workspace' as const, tenantId: before.gateway.tenantId, workspaceId: before.gateway.workspaceId }]) {
      const columns = aiPersistenceScopeColumns(scope);
      const canonical = await this.db.aiScope.findFirst({ where: columns });
      if (!canonical || Object.entries(columns).some(([key, item]) => canonical[key as keyof typeof canonical] !== item)) throw new BudgetError('UNAVAILABLE');
      const metered = this.automaticByokMetering && command.association.config.serviceMode === 'tenant_managed';
      const key = { scopeKind: columns.kind, scopeId: canonical.id, sceneCode: metered ? byokMeterScene(row.sceneCode, command.association) : row.sceneCode };
      const policy = metered ? await ensureByokMeterPolicy(this.db, key, command.association, row.sceneCode, grant.entitled)
        : await this.db.aiBudgetPolicy.findFirst({ where: key });
      if (!policy || policy.scopeKind !== key.scopeKind || policy.scopeId !== key.scopeId || policy.sceneCode !== key.sceneCode) throw new BudgetError('UNAVAILABLE');
      if (policy.unitKind !== 'calls' || policy.priceVersion && policy.priceVersion !== this.priceVersion) throw new BudgetError('UNAVAILABLE');
      policies.push(key);
    }
    const after = await this.current();
    if (before.scope.id !== after.scope.id || identity(before.context) !== identity(after.context)) throw new BudgetError('FORBIDDEN');
    // Grant expiry gates this admission, but must not change the persisted
    // request quantity/hash/expiry on a same-key replay a few seconds later.
    const expiresAt = new Date(Math.min(command.expiresAt.getTime(), binding.expiresAt.getTime()));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= this.clock()
      || !(grant.expiresAt instanceof Date) || grant.expiresAt <= this.clock()) throw new BudgetError('FORBIDDEN');
    return { association: binding.association, callId: row.callId, sceneCode: row.sceneCode,
      model: command.association.config.model, actorId: binding.actorId, quantity: { unit: 'calls' as const, value: 1 },
      policies, consumerScope: policies[2], expiresAt,
      evidenceHash: requestFingerprint({ method: 'original-invocation-call-1', priceVersion: this.priceVersion,
        invocationId: row.id, registrationHash: row.registrationHash, association: binding.association, policies }) };
  }
  /** Called by accounting facts only after its original dispatch/usage evidence
   * checks. Missing usage still stays unknown; this never synthesizes usage.
   * The selected price version gates new quotes, not an original reservation's
   * accounting after configuration rotation or execution shutdown. */
  async quantity(value: Readonly<BudgetRecord>, usageValue: Readonly<ModelUsage>) {
    const record = structuredClone(value), usage = structuredClone(usageValue), before = await this.current();
    if (!record.dispatched || record.reserved.unit !== 'calls' || record.reserved.value !== 1
      || record.actorId !== before.gateway.actorId
      || ![usage.inputTokens, usage.outputTokens].every(count => Number.isSafeInteger(count) && count >= 0)) throw new BudgetError('UNAVAILABLE');
    const binding = await this.bindings.resolveForReservation(before.gateway, record.id);
    if (requestFingerprint(binding.association) !== requestFingerprint(record.association)) throw new BudgetError('FORBIDDEN');
    const stored = await this.db.aiBudgetReservation.findFirst({ where: { id: record.id, scopeId: before.scope.id,
      scopeKind: 'WORKSPACE', actorId: before.gateway.actorId, callId: record.callId } });
    if (!stored || stored.unitKind !== 'calls' || stored.reservedCalls !== 1
      || stored.priceVersion !== record.association.priceVersion || stored.dispatchState === 'not_dispatched') throw new BudgetError('FORBIDDEN');
    const after = await this.current();
    if (before.scope.id !== after.scope.id || identity(before.context) !== identity(after.context)) throw new BudgetError('FORBIDDEN');
    return { unit: 'calls' as const, value: 1 };
  }
}
