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
    if (!eventKey || !Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) throw new ModelGatewayError('INVALID_REQUEST');
    const current = await this.repository.get(scope, { id });
    if (!current || current.id !== id) throw new ModelGatewayError('BUDGET_UNAVAILABLE');
    if (current.status === 'settled') return current;
    if (current.status !== 'reserved') throw new ModelGatewayError('ACCOUNTING_PENDING');
    await this.repository.appendLedger({ reservationId: id, tenantId: scope.tenantId!, eventKey, kind: 'settlement', input, output });
    const next = await this.repository.transition(scope, id, 'reserved', 'settled', { input, output });
    if (!next) throw new ModelGatewayError('ACCOUNTING_PENDING');
    return next;
  }
  async release(scope: AiProfileScope, id: string) { const next = await this.repository.transition(scope, id, 'reserved', 'released'); if (!next) throw new ModelGatewayError('BUDGET_UNAVAILABLE'); return next; }
  async markUnknown(scope: AiProfileScope, id: string, reason: string) { if (!reason) throw new ModelGatewayError('INVALID_REQUEST'); const next = await this.repository.transition(scope, id, 'reserved', 'unknown', { reason }); if (!next) throw new ModelGatewayError('ACCOUNTING_PENDING'); return next; }
  async reconcile(scope: AiProfileScope, id: string, eventKey: string, input: number, output: number) { const current = await this.repository.get(scope, { id }); if (!current || current.id !== id || current.status !== 'unknown') throw new ModelGatewayError('ACCOUNTING_PENDING'); await this.repository.appendLedger({ reservationId: id, tenantId: scope.tenantId!, eventKey, kind: 'reconcile', input, output }); const next = await this.repository.transition(scope, id, 'unknown', 'settled', { input, output }); if (!next) throw new ModelGatewayError('ACCOUNTING_PENDING'); return next; }
}
