import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AiScopeRepository } from '../ai-scope.repository';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { isGatewayConfig } from '../gateway-contract-validation';
import { modelUsageSchema, type ModelUsage } from '../model-gateway.ports';
import { BudgetError, type BudgetGrant, type BudgetQuotePort, type BudgetRecord, type BudgetReserveCommand } from './budget.ports';
import type { GatewayActualUsagePricing } from './prisma-gateway-accounting-facts';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';
import { PrismaGatewayPricingRecords, gatewayPricingInvocationSelect, type GatewayPricingRecordDb } from './prisma-gateway-pricing-records';
import { priceGatewayTokens, priceGatewayTokenBound } from './gateway-pricing-evidence';
import { gatewayBudgetPrincipal } from './gateway-budget-principal';
import { quantityAtoms, sameUnit } from './budget-quantity';

const identity = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...value } = context;
  return hash(value);
};
const usageSchema = modelUsageSchema;
export class PrismaGatewayRecordedPricing implements BudgetQuotePort, GatewayActualUsagePricing {
  private readonly records;
  private readonly bindings;
  constructor(private readonly db: GatewayPricingRecordDb & ConstructorParameters<typeof PrismaGatewayInvocationBindings>[0]
    & Pick<PrismaClient, 'aiBudgetPolicy'>, private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly clock: () => Date = () => new Date()) {
    this.records = new PrismaGatewayPricingRecords(db);
    this.bindings = new PrismaGatewayInvocationBindings(db, scopes, clock);
  }
  private async current() {
    const current = structuredClone(await this.scopes.resolveCurrent());
    const principal = gatewayBudgetPrincipal(current.context);
    if (current.scope.kind !== 'WORKSPACE' || current.scope.tenantId !== principal.tenantId
      || current.scope.workspaceId !== principal.workspaceId) throw new BudgetError('FORBIDDEN');
    const { actorKind: _, ...context } = principal;
    return { ...current, gateway: context };
  }
  private async evidence(current: Awaited<ReturnType<PrismaGatewayRecordedPricing['current']>>, callId: string) {
    const invocation = structuredClone(await this.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: current.scope.id, callId } },
      select: gatewayPricingInvocationSelect }));
    if (!invocation || invocation.callId !== callId || invocation.scopeId !== current.scope.id || invocation.actorId !== current.gateway.actorId
      || !isGatewayConfig(invocation.configuration) || hash(invocation.configuration) !== invocation.configurationHash) throw new BudgetError('FORBIDDEN');
    const proof = await this.records.bound(current.scope.id, invocation.id), b = proof.evidence;
    if (b.registrationHash !== invocation.registrationHash || b.intentHash !== invocation.intentHash
      || b.configurationHash !== invocation.configurationHash || b.priceVersion !== invocation.priceVersion
      || b.maxOutputTokens !== invocation.maxOutputTokens) throw new BudgetError('FORBIDDEN');
    return { invocation, proof, quantity: priceGatewayTokenBound(proof.price.evidence, b.maxInputTokens, b.maxOutputTokens) };
  }
  private async recheck(current: Awaited<ReturnType<PrismaGatewayRecordedPricing['current']>>) {
    const latest = await this.current();
    if (latest.scope.id !== current.scope.id || identity(latest.context) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
  }
  async quote(value: Readonly<BudgetReserveCommand>, grantValue: Readonly<BudgetGrant>) {
    const command = structuredClone(value), grant = structuredClone(grantValue), current = await this.current();
    if (!grant.entitled || identity(grant.context) !== identity(current.context) || command.callId !== command.association.requestId
      || !(grant.expiresAt instanceof Date) || grant.expiresAt <= this.clock()) throw new BudgetError('FORBIDDEN');
    const original = await this.evidence(current, command.callId), { invocation, proof, quantity } = original;
    // Old receipts remain readable/accountable, but cannot admit generation
    // without proof of the actual adapter serialization's counted material.
    if (proof.evidence.method === 'provider_count_tokens_receipt'
      && (!proof.evidence.countRequestHash || command.countRequestHash !== proof.evidence.countRequestHash))
      throw new BudgetError('FORBIDDEN');
    const now = this.clock().getTime();
    for (const record of [proof.price.evidence, proof.evidence]) {
      if (!Number.isFinite(now) || Date.parse(record.validFrom) > now || Date.parse(record.expiresAt) <= now) throw new BudgetError('UNAVAILABLE');
    }
    const binding = await this.bindings.resolveForReserve(current.gateway, { callId: invocation.callId,
      intentHash: invocation.intentHash, model: command.association.config.model, maxOutputTokens: invocation.maxOutputTokens });
    if (hash(binding.association) !== hash(command.association) || invocation.sceneCode !== command.sceneCode) throw new BudgetError('FORBIDDEN');
    const policies = [];
    for (const scope of [{ kind: 'platform' as const }, { kind: 'tenant' as const, tenantId: current.gateway.tenantId },
      { kind: 'workspace' as const, tenantId: current.gateway.tenantId, workspaceId: current.gateway.workspaceId }]) {
      const columns = aiPersistenceScopeColumns(scope), canonical = await this.db.aiScope.findFirst({ where: columns });
      if (!canonical || Object.entries(columns).some(([name, expected]) => canonical[name as keyof typeof canonical] !== expected)) throw new BudgetError('UNAVAILABLE');
      const key = { scopeId: canonical.id, scopeKind: columns.kind, sceneCode: command.sceneCode };
      const policy = await this.db.aiBudgetPolicy.findFirst({ where: key });
      if (!policy || policy.scopeId !== key.scopeId || policy.scopeKind !== key.scopeKind || policy.sceneCode !== key.sceneCode
        || policy.unitKind !== quantity.unit || policy.priceVersion && policy.priceVersion !== invocation.priceVersion) throw new BudgetError('UNAVAILABLE');
      policies.push(key);
    }
    if (quantityAtoms(quantity) <= 0n) throw new BudgetError('UNAVAILABLE');
    const expiresAt = new Date(Math.min(command.expiresAt.getTime(), binding.expiresAt.getTime(),
      Date.parse(proof.evidence.expiresAt), Date.parse(proof.price.evidence.expiresAt)));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= this.clock()) throw new BudgetError('FORBIDDEN');
    const again = await this.evidence(current, command.callId);
    if (again.proof.hash !== proof.hash || again.proof.price.hash !== proof.price.hash
      || again.invocation.registrationHash !== invocation.registrationHash) throw new BudgetError('FORBIDDEN');
    await this.recheck(current);
    if (expiresAt <= this.clock() || grant.expiresAt <= this.clock()) throw new BudgetError('FORBIDDEN');
    return { association: binding.association, callId: command.callId, sceneCode: command.sceneCode,
      model: command.association.config.model, actorId: binding.actorId, quantity, policies, consumerScope: policies[2], expiresAt,
      evidenceHash: hash({ kind: 'recorded-gateway-quote-1', invocationId: invocation.id, registrationHash: invocation.registrationHash,
        priceRecordId: proof.price.id, priceHash: proof.price.hash, boundRecordId: proof.id, boundHash: proof.hash, association: binding.association, policies }) };
  }
  async receipt(value: Readonly<BudgetRecord>) {
    const record = structuredClone(value), current = await this.current();
    if (record.scopeId !== current.scope.id || record.scopeKind !== 'WORKSPACE'
      || record.actorId !== current.gateway.actorId || record.reserved.unit === 'calls') throw new BudgetError('FORBIDDEN');
    const binding = await this.bindings.resolveForReservation(current.gateway, record.id);
    if (hash(binding.association) !== hash(record.association)) throw new BudgetError('FORBIDDEN');
    const original = await this.evidence(current, record.callId), { invocation, proof, quantity } = original;
    if (record.callId !== binding.association.requestId || record.sceneCode !== binding.sceneCode
      || !sameUnit(record.reserved, quantity) || quantityAtoms(record.reserved) !== quantityAtoms(quantity)
      || record.expiresAt.getTime() > Math.min(Date.parse(proof.evidence.expiresAt), Date.parse(proof.price.evidence.expiresAt))) throw new BudgetError('FORBIDDEN');
    const billing = proof.price.evidence.billing;
    const receipt = { reservationId: record.id, callId: record.callId, priceVersion: proof.price.evidence.priceVersion,
      pricing: { unit: billing.unit, scale: billing.scale, currency: billing.unit === 'money' ? billing.currency : null,
        rounding: billing.rounding, recordHash: proof.price.hash,
        validFrom: proof.price.evidence.validFrom, expiresAt: proof.price.evidence.expiresAt },
      inputBound: { inputFingerprint: invocation.intentHash, recordHash: proof.hash, method: proof.evidence.method,
        maxInputTokens: proof.evidence.maxInputTokens, maxOutputTokens: proof.evidence.maxOutputTokens },
      reservedQuantity: quantity, meaning: 'historical_pricing_basis_not_usage_or_charge' as const,
      readOnly: true as const, executionPermission: false as const, usageAttested: false as const };
    const again = await this.evidence(current, record.callId);
    if (again.proof.hash !== proof.hash || again.proof.price.hash !== proof.price.hash
      || again.invocation.registrationHash !== invocation.registrationHash) throw new BudgetError('PENDING_RECONCILIATION');
    const latestBinding = await this.bindings.resolveForReservation(current.gateway, record.id);
    if (hash(latestBinding.association) !== hash(binding.association)) throw new BudgetError('FORBIDDEN');
    await this.recheck(current);
    return receipt;
  }
  async quantity(value: Readonly<BudgetRecord>, usageValue: Readonly<ModelUsage>) {
    const record = structuredClone(value), parsed = usageSchema.safeParse(structuredClone(usageValue)), current = await this.current();
    if (!parsed.success || !record.dispatched || record.actorId !== current.gateway.actorId || record.reserved.unit === 'calls') throw new BudgetError('UNAVAILABLE');
    if (record.scopeId !== current.scope.id || record.scopeKind !== 'WORKSPACE') throw new BudgetError('FORBIDDEN');
    const binding = await this.bindings.resolveForReservation(current.gateway, record.id);
    if (hash(binding.association) !== hash(record.association) || record.callId !== binding.association.requestId
      || record.sceneCode !== binding.sceneCode) throw new BudgetError('FORBIDDEN');
    const original = await this.evidence(current, record.callId), { proof } = original;
    if (!sameUnit(record.reserved, original.quantity) || quantityAtoms(record.reserved) !== quantityAtoms(original.quantity)
      || record.association.priceVersion !== proof.price.evidence.priceVersion
      || record.expiresAt.getTime() > Math.min(Date.parse(proof.evidence.expiresAt), Date.parse(proof.price.evidence.expiresAt))) throw new BudgetError('FORBIDDEN');
    const usage = parsed.data;
    // A pre-dispatch upper bound is admission evidence, not an accounting cap.
    // This method is called with usage from the original persisted dispatch
    // receipt. Truthful excess must reach the existing settlement/debt logic;
    // never clip it or pretend missing usage merely because the bound failed.
    const actual = priceGatewayTokens(proof.price.evidence, usage.inputTokens, usage.outputTokens, usage.billingDetails);
    const again = await this.evidence(current, record.callId);
    if (again.proof.hash !== proof.hash || again.proof.price.hash !== proof.price.hash) throw new BudgetError('PENDING_RECONCILIATION');
    await this.recheck(current);
    return actual;
  }
}
