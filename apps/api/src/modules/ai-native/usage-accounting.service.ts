import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileScope } from './provider-profile.ports';
import type { AiUsageRecord, UsageAccountingRepository, UsageReserveInput } from './usage-accounting.ports';
export class UsageAccountingService {
  constructor(private readonly repository: UsageAccountingRepository) {}
  async reserve(input: UsageReserveInput): Promise<AiUsageRecord> {
    if (!input.scope.tenantId || !input.scope.workspaceId || !input.callId || !input.idempotencyKey || !Number.isSafeInteger(input.reservedUnits) || input.reservedUnits < 1 || input.expiresAt.getTime() <= Date.now()) throw new ModelGatewayError('INVALID_REQUEST');
    const existing = await this.repository.get(input.scope, { idempotencyKey: input.idempotencyKey });
    if (existing) { if (existing.callId === input.callId && existing.status === 'reserved') return existing; throw new ModelGatewayError('CONFIG_INVALID'); }
    try { return await this.repository.reserve(input); } catch { const raced = await this.repository.get(input.scope, { idempotencyKey: input.idempotencyKey }); if (raced?.callId === input.callId && raced.status === 'reserved') return raced; throw new ModelGatewayError('BUDGET_UNAVAILABLE'); }
  }
  async settle(scope: AiProfileScope, id: string, eventKey: string, input: number, output: number) {
    return this.commit(scope, id, eventKey, input, output, 'settlement');
  }
  private async commit(scope: AiProfileScope, id: string, eventKey: string, input: number, output: number, kind: 'settlement' | 'reconcile') {
    if (!id || !eventKey || !Number.isSafeInteger(input) || input < 0 || input > 4294967295 || !Number.isSafeInteger(output) || output < 0 || output > 4294967295) throw new ModelGatewayError('INVALID_REQUEST');
    // No append-then-transition fallback: old adapters must be upgraded atomically.
    if (typeof this.repository.commitUsage !== 'function') throw new ModelGatewayError('ACCOUNTING_PENDING');
    try { return await this.repository.commitUsage(structuredClone({ scope, id, eventKey, kind, input, output })); }
    catch (error) { if (error instanceof ModelGatewayError) throw error; throw new ModelGatewayError('ACCOUNTING_PENDING'); }
  }
  async release(scope: AiProfileScope, id: string) { const next = await this.repository.transition(scope, id, 'reserved', 'released'); if (!next) throw new ModelGatewayError('BUDGET_UNAVAILABLE'); return next; }
  async markUnknown(scope: AiProfileScope, id: string, reason: string) { if (!reason) throw new ModelGatewayError('INVALID_REQUEST'); const next = await this.repository.transition(scope, id, 'reserved', 'unknown', { reason }); if (!next) throw new ModelGatewayError('ACCOUNTING_PENDING'); return next; }
  async reconcile(scope: AiProfileScope, id: string, eventKey: string, input: number, output: number) {
    return this.commit(scope, id, eventKey, input, output, 'reconcile');
  }
}
