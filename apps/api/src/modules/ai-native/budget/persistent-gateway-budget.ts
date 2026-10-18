import type { GatewayAccountingCall, UnifiedGatewayBudget } from '../gateway-accounting.ports';
import { ModelGatewayError, type ModelUsage } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { BudgetError } from './budget.ports';
import type { BudgetGatewayLifecycle } from './budget-gateway-adapter';
import { checkedAccountingCall, type GatewayAccountingFacts } from './prisma-gateway-accounting-facts';

export class PersistentGatewayBudget implements UnifiedGatewayBudget {
  constructor(private readonly lifecycle: BudgetGatewayLifecycle, private readonly facts: GatewayAccountingFacts) {
    if ([lifecycle?.reserve, lifecycle?.dispatch, lifecycle?.settle, lifecycle?.release, lifecycle?.markUnknown, lifecycle?.reconcile,
      facts?.assertClaim, facts?.link, facts?.dispatch, facts?.cancelIfUnsent, facts?.recordUsage].some(method => typeof method !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      const code = error instanceof BudgetError ? error.code : 'PENDING_RECONCILIATION';
      throw new ModelGatewayError(code === 'FORBIDDEN' ? 'FORBIDDEN' : code === 'INVALID' ? 'INVALID_REQUEST'
        : code === 'EXHAUSTED' || code === 'UNAVAILABLE' ? 'BUDGET_UNAVAILABLE' : 'ACCOUNTING_PENDING');
    }
  }
  private event(call: GatewayAccountingCall, phase: string) {
    return requestFingerprint({ binding: call.binding, phase });
  }
  async reserve(value: GatewayAccountingCall) {
    const call = checkedAccountingCall(value);
    return this.run(async () => {
      await this.facts.assertClaim(structuredClone(call));
      const id = await this.lifecycle.reserve(structuredClone(call.context), structuredClone(call.request));
      await this.facts.link(structuredClone(call), id);
      return { id };
    });
  }
  async dispatch(value: GatewayAccountingCall, reservationId: string) {
    const call = checkedAccountingCall(value);
    await this.run(async () => {
      await this.facts.assertClaim(structuredClone(call));
      const record = await this.lifecycle.dispatch(structuredClone(call.context), reservationId, this.event(call, 'dispatch'));
      if (record.id !== reservationId || record.status !== 'reserved' || !record.dispatched) throw new BudgetError('PENDING_RECONCILIATION');
      await this.facts.dispatch(structuredClone(call), reservationId);
    });
  }
  async settle(value: GatewayAccountingCall, reservationId: string, eventKey: string, valueUsage: ModelUsage) {
    const call = checkedAccountingCall(value), usage = structuredClone(valueUsage);
    await this.run(async () => {
      const evidenceRef = await this.facts.recordUsage(structuredClone(call), reservationId, usage);
      const record = await this.lifecycle.settle(structuredClone(call.context), reservationId, this.event(call, eventKey), evidenceRef);
      if (record.id !== reservationId || record.status !== 'settled') throw new BudgetError('PENDING_RECONCILIATION');
    });
  }
  async recordUsage(value: GatewayAccountingCall, reservationId: string, valueUsage: ModelUsage) {
    const call = checkedAccountingCall(value), usage = structuredClone(valueUsage);
    await this.run(async () => { await this.facts.recordUsage(call, reservationId, usage); });
  }
  async abandon(value: GatewayAccountingCall, reservationId: string, reason: string) {
    const call = checkedAccountingCall(value);
    await this.run(async () => {
      if (await this.facts.cancelIfUnsent(structuredClone(call), reservationId)) {
        await this.lifecycle.release(structuredClone(call.context), reservationId, this.event(call, 'release'));
      } else {
        await this.lifecycle.markUnknown(structuredClone(call.context), reservationId, this.event(call, `unknown:${reason}`), reason);
      }
    });
  }
  async reconcile(value: GatewayAccountingCall, reservationId: string, evidenceRef: string) {
    const call = checkedAccountingCall(value);
    await this.run(async () => {
      const record = await this.lifecycle.reconcile(structuredClone(call.context), reservationId, this.event(call, 'reconcile'), evidenceRef);
      if (record.id !== reservationId || record.status !== 'settled') throw new BudgetError('PENDING_RECONCILIATION');
    });
  }
}
