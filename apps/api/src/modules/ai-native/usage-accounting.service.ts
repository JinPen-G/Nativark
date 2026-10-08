import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileScope } from './provider-profile.ports';
import type { AiUsageRecord, UsageAccountingRepository, UsageReserveInput } from './usage-accounting.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const scopeSchema = z.object({ id: id.max(36), kind: z.literal('WORKSPACE'), tenantId: id, workspaceId: id }).strict();
const reserveSchema = z.object({ scope: scopeSchema, callId: id.max(128), idempotencyKey: id.max(128),
  reservedUnits: z.number().int().min(1).max(4294967295), expiresAt: z.date() }).strict();
const reservationSchema = reserveSchema.extend({ id: id.max(36), status: z.enum(['reserved', 'released', 'settled', 'unknown']),
  actualInput: z.number().int().min(0).max(4294967295).nullable(), actualOutput: z.number().int().min(0).max(4294967295).nullable(),
  unknownReason: z.string().min(1).max(128).nullable() }).strip();

export class UsageAccountingService {
  constructor(private readonly repository: UsageAccountingRepository) {}
  private reservation(value: unknown, input: UsageReserveInput): AiUsageRecord {
    const parsed = reservationSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('ACCOUNTING_PENDING');
    const row = parsed.data;
    if (row.callId !== input.callId || row.idempotencyKey !== input.idempotencyKey || row.reservedUnits !== input.reservedUnits
      || row.scope.id !== input.scope.id || row.scope.kind !== input.scope.kind || row.scope.tenantId !== input.scope.tenantId
      || row.scope.workspaceId !== input.scope.workspaceId) throw new ModelGatewayError('CONFIG_INVALID');
    if (row.status === 'unknown' || row.expiresAt.getTime() <= Date.now()) throw new ModelGatewayError('ACCOUNTING_PENDING');
    if (row.status !== 'reserved' || row.actualInput !== null || row.actualOutput !== null || row.unknownReason !== null) throw new ModelGatewayError('CONFIG_INVALID');
    return structuredClone(row);
  }
  async reserve(value: UsageReserveInput): Promise<AiUsageRecord> {
    const parsed = reserveSchema.safeParse(value);
    if (!parsed.success || parsed.data.expiresAt.getTime() <= Date.now()) throw new ModelGatewayError('INVALID_REQUEST');
    const input = structuredClone(parsed.data);
    if (typeof this.repository?.get !== 'function' || typeof this.repository?.reserve !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    let existing: AiUsageRecord | null;
    try { existing = await this.repository.get(structuredClone(input.scope), { idempotencyKey: input.idempotencyKey }); }
    catch (error) { if (error instanceof ModelGatewayError) throw error; throw new ModelGatewayError('ACCOUNTING_PENDING'); }
    if (existing) return this.reservation(existing, input);
    if (input.expiresAt.getTime() <= Date.now()) throw new ModelGatewayError('INVALID_REQUEST');
    let created: AiUsageRecord;
    try { created = await this.repository.reserve(structuredClone(input)); }
    catch (error) {
      // Only a definite uniqueness conflict can identify a winner. A lost COMMIT ack is not a safe retry.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        if (error instanceof ModelGatewayError) throw error;
        throw new ModelGatewayError('ACCOUNTING_PENDING');
      }
      let raced: AiUsageRecord | null;
      try { raced = await this.repository.get(structuredClone(input.scope), { idempotencyKey: input.idempotencyKey }); }
      catch (readError) { if (readError instanceof ModelGatewayError) throw readError; throw new ModelGatewayError('ACCOUNTING_PENDING'); }
      return this.reservation(raced, input);
    }
    return this.reservation(created, input);
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
