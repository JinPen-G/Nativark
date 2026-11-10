/** Immutable provider count-tokens receipts. One deterministic row per
 * (tenant, workspace, actor, original call), persisted before the admission
 * settles: a lost write acknowledgement is recovered by re-reading the
 * original key, never by re-dispatching the count. The row is audit evidence,
 * not a task state and not a second ledger — financial admission stays in the
 * original budget account and the published bound stays in
 * aiGatewayInputBoundRecord. */
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { BudgetError } from '../budget/budget.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { modelRequestSchema } from '../model-gateway.ports';

/** Server-derived request id for a counting admission: one deterministic id
 * per original call, never caller-chosen. Leaf location so read-side
 * consumers can derive it without importing the admission stack. */
export function countTokensCallId(callId: string) {
  return `count-${createHash('sha256').update(JSON.stringify(['ai-count-tokens-call-1', callId])).digest('hex')}`;
}
export function countTokensSceneCode(sceneCode: string) {
  const derived = `${sceneCode}:count-tokens`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(derived)) throw new BudgetError('UNAVAILABLE');
  return derived;
}

const hash64 = z.string().regex(/^[a-f0-9]{64}$/u);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const isoTime = z.string().datetime({ offset: true });
export const COUNT_TOKENS_RECEIPT_ACTION = 'ai.model.count_tokens';
/** Provider outcome classes, kept distinct from budget statuses: 'observed'
 * attests a validated count; 'failed' is a definite provider rejection with no
 * count; 'unknown' preserves an interrupted operation for original-key
 * recovery. None of these grant a retry, a refund or a text dispatch. */
const countTokensReceiptFields = z.object({
  version: z.literal('ai-count-tokens-receipt-1'),
  state: z.enum(['observed', 'failed', 'unknown']),
  tenantId: identifier.max(191), workspaceId: identifier.max(191), actorId: identifier,
  callId: identifier, countCallId: identifier, invocationId: identifier, scopeId: identifier,
  sceneCode: identifier, protocol: identifier, model: modelRequestSchema.shape.model,
  registrationHash: hash64, intentHash: hash64, configurationHash: hash64,
  priceVersion: identifier.max(64), maxOutputTokens: z.number().int().min(1).max(32768),
  method: z.literal('provider_count_tokens_receipt'),
  inputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  failureCode: z.enum(['AUTHENTICATION_FAILED', 'PROVIDER_REJECTED']).optional(),
  countRequestHash: hash64,
  admission: z.object({ reservationId: identifier.max(36), sceneCode: identifier, unit: z.literal('calls') }).strict(),
  observedAt: isoTime, expiresAt: isoTime
}).strict();
export const countTokensReceiptSchema = countTokensReceiptFields.refine(value => (value.state === 'observed') === (value.inputTokens !== undefined)
  && (value.state === 'failed') === (value.failureCode !== undefined));
export type CountTokensReceipt = z.infer<typeof countTokensReceiptSchema>;
export const countTokensDispatchClaimSchema = countTokensReceiptFields.pick({ tenantId: true, workspaceId: true,
  actorId: true, callId: true, registrationHash: true, intentHash: true, configurationHash: true, countRequestHash: true })
  .extend({ reservationId: identifier.max(36) }).strict();
export type CountTokensReceiptDb = Pick<PrismaClient, 'operationLog'>;
/** Only a successful original-key lookup returning no row proves absence.
 * Storage/authorization errors must never be treated as a missing receipt. */
export class CountTokensReceiptNotFoundError extends BudgetError {
  constructor() { super('UNAVAILABLE'); }
}
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export function countTokensOperationId(value: Pick<CountTokensReceipt, 'tenantId' | 'workspaceId' | 'actorId' | 'callId'>) {
  return createHash('sha256').update(JSON.stringify(['ai-count-tokens-receipt-1',
    value.tenantId, value.workspaceId, value.actorId, value.callId])).digest('hex');
}
export function countTokensReference(receiptId: string) { return `count-tokens:${receiptId}`; }
export function countTokensDispatchOperationId(value: Pick<CountTokensReceipt, 'tenantId' | 'workspaceId' | 'actorId' | 'callId'>) {
  return createHash('sha256').update(JSON.stringify(['ai-count-tokens-dispatch-1', countTokensOperationId(value)])).digest('hex');
}
/** Stable document hash for evidence provenance: the receipt minus the
 * admission reservation id, which the budget account already attests. */
export function countTokensReceiptDocumentHash(value: CountTokensReceipt) {
  const { admission: { reservationId: _reservation }, ...document } = structuredClone(value);
  return requestFingerprint(document);
}
export class PrismaCountTokensReceipts {
  constructor(private readonly db: CountTokensReceiptDb) {
    if (typeof db?.operationLog?.findUnique !== 'function' || typeof db.operationLog.create !== 'function') throw new BudgetError('UNAVAILABLE');
  }
  /** Unique persisted execution ownership, separate from idempotent budget
   * events. Only the acknowledged INSERT winner may send. Reading this row,
   * a duplicate key or a lost acknowledgement can never reacquire ownership.
   * It is not a second ledger and never proves whether the provider received a call. */
  async claimDispatch(value: Pick<CountTokensReceipt, 'tenantId' | 'workspaceId' | 'actorId' | 'callId'
    | 'registrationHash' | 'intentHash' | 'configurationHash' | 'countRequestHash'> & { reservationId: string }) {
    const binding = structuredClone(value);
    const id = countTokensDispatchOperationId(binding);
    const action = 'ai.model.count_tokens.dispatch';
    try {
      const row = await this.db.operationLog.create({ data: { id, action, tenantId: binding.tenantId,
        workspaceId: binding.workspaceId, userId: binding.actorId, detail: json(binding) } });
      if (!row || row.id !== id || row.action !== action || row.tenantId !== binding.tenantId
        || row.workspaceId !== binding.workspaceId || row.userId !== binding.actorId
        || requestFingerprint(row.detail) !== requestFingerprint(binding)) throw new BudgetError('PENDING_RECONCILIATION');
    } catch {
      throw new BudgetError('PENDING_RECONCILIATION');
    }
  }
  /** Read the persisted dispatch-claim row for one original count key. This
   * proves a claim EXISTS, never that the provider received the call; it is
   * read-only lifecycle evidence for observations. */
  async readDispatchClaim(value: Pick<CountTokensReceipt, 'tenantId' | 'workspaceId' | 'actorId' | 'callId'>
    & Partial<Pick<CountTokensReceipt, 'registrationHash' | 'intentHash' | 'configurationHash' | 'countRequestHash'> & { reservationId: string }>) {
    const binding = structuredClone(value);
    const id = countTokensDispatchOperationId(binding);
    const row = structuredClone(await this.db.operationLog.findUnique({ where: { id } }));
    if (!row) return null;
    const detail = countTokensDispatchClaimSchema.safeParse(row.detail);
    if (row.id !== id || row.action !== 'ai.model.count_tokens.dispatch' || !detail.success
      || row.tenantId !== binding.tenantId || row.workspaceId !== binding.workspaceId || row.userId !== binding.actorId
      || Object.entries(binding).some(([key, value]) => detail.data[key as keyof typeof detail.data] !== value))
      throw new BudgetError('PENDING_RECONCILIATION');
    return detail.data;
  }
  async hasDispatchClaim(value: Parameters<PrismaCountTokensReceipts['readDispatchClaim']>[0]): Promise<boolean> {
    return await this.readDispatchClaim(value) !== null;
  }
  async read(id: string): Promise<CountTokensReceipt> {
    if (!hash64.safeParse(id).success) throw new BudgetError('INVALID');
    const row = structuredClone(await this.db.operationLog.findUnique({ where: { id } }));
    if (!row) throw new CountTokensReceiptNotFoundError();
    const parsed = countTokensReceiptSchema.safeParse(row.detail);
    // A present-but-unreadable audit row is NOT absence: surface it as an
    // unreadable original outcome instead of a silent "no receipt".
    if (row.id !== id || row.action !== COUNT_TOKENS_RECEIPT_ACTION || !parsed.success)
      throw new BudgetError('PENDING_RECONCILIATION');
    if (countTokensOperationId(parsed.data) !== id || row.tenantId !== parsed.data.tenantId || row.workspaceId !== parsed.data.workspaceId
      || row.userId !== parsed.data.actorId) throw new BudgetError('PENDING_RECONCILIATION');
    return parsed.data;
  }
  /** Same original key replays the stored fact; a different payload for the
   * key is a conflict, not an overwrite or a fresh count. A concurrent append
   * racing on the same key converges by re-reading the committed original.
   * The return value is always the committed original receipt. */
  async append(receipt: CountTokensReceipt): Promise<CountTokensReceipt> {
    const value = countTokensReceiptSchema.parse(structuredClone(receipt));
    const id = countTokensOperationId(value);
    const existing = structuredClone(await this.db.operationLog.findUnique({ where: { id } }));
    if (!existing) {
      try { await this.db.operationLog.create({ data: { id, tenantId: value.tenantId, workspaceId: value.workspaceId,
        userId: value.actorId, action: COUNT_TOKENS_RECEIPT_ACTION, detail: json(value) } }); }
      catch { /* unique race: fall through to the committed original read */ }
    }
    const row = structuredClone(await this.db.operationLog.findUnique({ where: { id } }));
    const stored = countTokensReceiptSchema.safeParse(row?.detail);
    if (!row || row.id !== id || row.action !== COUNT_TOKENS_RECEIPT_ACTION || !stored.success
      || row.tenantId !== value.tenantId || row.workspaceId !== value.workspaceId || row.userId !== value.actorId)
      throw new BudgetError('PENDING_RECONCILIATION');
    if (requestFingerprint(stored.data) !== requestFingerprint(value)) throw new BudgetError('IDEMPOTENCY_CONFLICT');
    return stored.data;
  }
}
