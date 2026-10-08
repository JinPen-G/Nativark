import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiUsageRecord, UsageCommitInput, UsageSettlementPort } from './usage-accounting.ports';
import { isAiStepExecutionContext } from './task-contract-validation';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const units = z.number().int().min(0).max(4294967295);
const scopeSchema = z.object({ id: id.max(36), kind: z.literal('WORKSPACE'), tenantId: id, workspaceId: id }).strict();
const commandSchema = z.object({ scope: scopeSchema, id: id.max(36), eventKey: id.max(128), kind: z.enum(['settlement', 'reconcile']), input: units, output: units }).strict();
const grantSchema = z.object({ context: z.unknown(), authorized: z.literal(true), authorizationKey: id, expiresAt: z.date() }).strict();
export interface UsageSettlementAuthority {
  /** Must reauthorize this reservation and, for reconcile, verified usage evidence.
   * Not a model-supplied context or an implicit tenant-wide bookkeeping permission.
   */
  resolve(input: Readonly<UsageCommitInput>): Promise<{ context: AiExecutionContext; authorized: true; authorizationKey: string; expiresAt: Date }>;
}
const select = {
  id: true, tenantId: true, workspaceId: true, callId: true, idempotencyKey: true, status: true,
  reservedUnits: true, actualInput: true, actualOutput: true, unknownReason: true, expiresAt: true, updatedAt: true, settledAt: true
} satisfies Prisma.AiUsageReservationSelect;
type Row = Prisma.AiUsageReservationGetPayload<{ select: typeof select }>;
const pending = () => new ModelGatewayError('ACCOUNTING_PENDING');

/** Atomic ledger and reservation settlement only. Budget reservation/admission and
 * platform/tenant-wide storage are not implemented by this workspace-only adapter.
 * No controller/worker registers it automatically and it never retries a transaction.
 */
export class PrismaUsageSettlementRepository implements UsageSettlementPort {
  constructor(private readonly db: Pick<PrismaClient, '$transaction'>, private readonly authority: UsageSettlementAuthority,
    private readonly clock: () => Date = () => new Date()) {
    if (!authority || typeof authority.resolve !== 'function') throw new ModelGatewayError('FORBIDDEN');
  }
  private async authorize(input: UsageCommitInput) {
    try {
      const grant = grantSchema.parse(structuredClone(await this.authority.resolve(structuredClone(input))));
      const context = grant.context, now = this.clock();
      if (!isAiStepExecutionContext(context) || !(now instanceof Date) || !Number.isFinite(now.getTime()) || grant.expiresAt <= now
        || Date.parse(context.authorizedAt) > now.getTime() || context.scope.kind !== 'workspace'
        || context.scope.tenantId !== input.scope.tenantId || context.scope.workspaceId !== input.scope.workspaceId
        || (context.actor.kind === 'automation' && Date.parse(context.actor.expiresAt) <= now.getTime())) throw Error();
      const { authorizedAt: _, requestId: __, ...binding } = context;
      return { now, key: requestFingerprint({ binding, authorizationKey: grant.authorizationKey }) };
    } catch { throw new ModelGatewayError('FORBIDDEN'); }
  }
  private result(row: Row, input: UsageCommitInput): AiUsageRecord {
    return { id: row.id, scope: structuredClone(input.scope), callId: row.callId, idempotencyKey: row.idempotencyKey,
      status: 'settled', reservedUnits: row.reservedUnits, actualInput: input.input, actualOutput: input.output, unknownReason: null, expiresAt: row.expiresAt };
  }
  async commitUsage(value: UsageCommitInput): Promise<AiUsageRecord> {
    const parsed = commandSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const input = structuredClone(parsed.data), initial = await this.authorize(input);
    const reauthorize = async () => { const current = await this.authorize(input); if (current.key !== initial.key) throw new ModelGatewayError('FORBIDDEN'); };
    try {
      return await this.db.$transaction(async tx => {
        const scope = await tx.aiScope.findFirst({ where: { ...input.scope }, select: { id: true, kind: true, tenantId: true, workspaceId: true } });
        if (!scope || scope.id !== input.scope.id || scope.kind !== 'WORKSPACE' || scope.tenantId !== input.scope.tenantId || scope.workspaceId !== input.scope.workspaceId) throw new ModelGatewayError('BUDGET_UNAVAILABLE');
        const where = { id: input.id, tenantId: scope.tenantId, workspaceId: scope.workspaceId };
        const row = await tx.aiUsageReservation.findFirst({ where, select });
        if (!row || row.id !== input.id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId) throw new ModelGatewayError('BUDGET_UNAVAILABLE');
        if (!units.safeParse(row.reservedUnits).success || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) throw pending();
        const entry = await tx.aiUsageLedgerEntry.findFirst({ where: { reservationId: row.id, tenantId: scope.tenantId, eventKey: input.eventKey },
          select: { reservationId: true, tenantId: true, eventKey: true, kind: true, inputUnits: true, outputUnits: true } });
        if (entry) {
          if (entry.reservationId !== row.id || entry.tenantId !== scope.tenantId || entry.eventKey !== input.eventKey
            || entry.kind !== input.kind || entry.inputUnits !== input.input || entry.outputUnits !== input.output
            || row.status !== 'settled' || row.actualInput !== input.input || row.actualOutput !== input.output || !row.settledAt) throw pending();
          await reauthorize();
          return this.result(row, input);
        }
        const from = input.kind === 'settlement' ? 'reserved' : 'unknown';
        if (row.status !== from || row.settledAt !== null || row.actualInput !== null || row.actualOutput !== null) throw pending();
        // Lock the reservation before appending the ledger. Any subsequent failure rolls both back.
        const changed = await tx.aiUsageReservation.updateMany({ where: { ...where, status: from, updatedAt: row.updatedAt,
          callId: row.callId, idempotencyKey: row.idempotencyKey, reservedUnits: row.reservedUnits, actualInput: null, actualOutput: null, settledAt: null },
          data: { status: 'settled', actualInput: input.input, actualOutput: input.output, unknownReason: null, settledAt: initial.now } });
        if (changed.count !== 1) throw pending();
        await reauthorize();
        await tx.aiUsageLedgerEntry.create({ data: { id: randomUUID(), reservationId: row.id, tenantId: scope.tenantId,
          eventKey: input.eventKey, kind: input.kind, inputUnits: input.input, outputUnits: input.output }, select: { id: true } });
        return this.result(row, input);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      // A unique conflict, deadlock or lost COMMIT acknowledgement is not permission to repeat writes.
      throw pending();
    }
  }
}
