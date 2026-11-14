/** Durable bounded candidate journals in the original OperationLog. The caller
 * supplies current business authorization before/after selection and writes.
 * A duplicate key observes only; this repository never claims events, retries a
 * batch, starts a worker or infers non-commit from time or a missing journal. */
import { Prisma, type PrismaClient, type OperationLog } from '@prisma/client';
import { z } from 'zod';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { BusinessFailureError } from './prisma-business-failure-outbox';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const key = id.max(128), uuid = z.string().uuid(), fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const instant = z.string().datetime({ offset: true });
const reference = z.object({ tenantId: id, workspaceId: id, userId: id, audience: z.enum(['operator', 'staff']),
  operationKey: key, limit: z.number().int().min(1).max(10) }).strict();
export type PendingCandidateBatchReference = z.infer<typeof reference>;
export const pendingCandidateEventSchema = z.object({ eventId: uuid, bindingHash: fingerprint,
  originalHash: fingerprint }).strict();
export type PendingCandidateEvent = z.infer<typeof pendingCandidateEventSchema>;
const journalSchema = z.object({ version: z.literal('human-pending-candidate-batch-1'), key: reference,
  recordedAt: instant, events: z.array(pendingCandidateEventSchema).max(10), confirmed: z.array(uuid).max(10),
  bindingHash: fingerprint }).strict().refine(value => value.events.length <= value.key.limit
    && new Set(value.events.map(event => event.eventId)).size === value.events.length
    && value.confirmed.length <= value.events.length
    && value.confirmed.every((eventId, index) => eventId === value.events[index].eventId));
export type PendingCandidateBatchJournal = z.infer<typeof journalSchema>;
export type PendingCandidateBatchDb = Pick<PrismaClient, 'operationLog' | 'aiBusinessFailureOutbox' | '$transaction'>;
type Reader = Pick<PrismaClient, 'operationLog'>;
const action = 'ai.automation.pending_candidates';
const unavailable = () => new BusinessFailureError('unavailable');
const unknown = () => new BusinessFailureError('result_unknown');
const same = (left: unknown, right: unknown) => hash(left) === hash(right);

function batchId(value: PendingCandidateBatchReference) {
  const chars = hash({ version: 'human-pending-candidate-batch-key-1', tenantId: value.tenantId,
    workspaceId: value.workspaceId, userId: value.userId, audience: value.audience, operationKey: value.operationKey }).slice(0, 32).split('');
  chars[12] = '5'; chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
  const text = chars.join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
const original = (journal: Omit<PendingCandidateBatchJournal, 'bindingHash'>) => ({ version: journal.version,
  key: journal.key, recordedAt: journal.recordedAt, events: journal.events });

export class PendingCandidateBatchRepository {
  constructor(private readonly db: PendingCandidateBatchDb, private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.$transaction !== 'function' || typeof db.operationLog?.findFirst !== 'function'
      || typeof db.operationLog.create !== 'function' || typeof db.operationLog.updateMany !== 'function') throw unavailable();
  }

  id(value: PendingCandidateBatchReference) { return batchId(reference.parse(value)); }

  private receipt(row: OperationLog, value: PendingCandidateBatchReference) {
    const parsed = journalSchema.safeParse(row.detail), now = this.clock();
    if (!parsed.success || !(now instanceof Date) || !Number.isFinite(now.getTime()) || row.id !== batchId(value)
      || row.action !== action || row.tenantId !== value.tenantId || row.workspaceId !== value.workspaceId
      || row.userId !== value.userId || !same(parsed.data.key, value)
      || parsed.data.bindingHash !== hash(original(parsed.data)) || Date.parse(parsed.data.recordedAt) > now.getTime()
      || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())
      || row.createdAt.getTime() !== Date.parse(parsed.data.recordedAt)) throw unavailable();
    return parsed.data;
  }

  async read(value: PendingCandidateBatchReference, db: Reader = this.db) {
    const input = reference.parse(value);
    // The deterministic ID is queried without a scope predicate so that a
    // corrupt scope/action cannot masquerade as an absent original journal.
    const row = await db.operationLog.findFirst({ where: { id: batchId(input) } });
    return row ? this.receipt(row, input) : null;
  }

  async create(value: PendingCandidateBatchReference,
    select: (tx: Prisma.TransactionClient) => Promise<PendingCandidateEvent[]>,
    revalidate: (tx: Prisma.TransactionClient, events: PendingCandidateEvent[]) => Promise<void>) {
    const input = reference.parse(value);
    return this.db.$transaction(async tx => {
      const existing = await this.read(input, tx);
      if (existing) return { created: false, journal: existing };
      const events = await select(tx), recordedAt = this.clock();
      if (!(recordedAt instanceof Date) || !Number.isFinite(recordedAt.getTime())) throw unavailable();
      const detail = { version: 'human-pending-candidate-batch-1' as const, key: input,
        recordedAt: recordedAt.toISOString(), events, confirmed: [] as string[] };
      const journal = journalSchema.parse({ ...detail, bindingHash: hash(original(detail)) });
      await revalidate(tx, journal.events);
      // Unique OperationLog.id admits only one creator. A duplicate insert or
      // a lost COMMIT acknowledgement never reaches the preparation loop.
      const row = await tx.operationLog.create({ data: { id: batchId(input), tenantId: input.tenantId,
        workspaceId: input.workspaceId, userId: input.userId, action, detail: journal, createdAt: recordedAt } });
      if (!same(this.receipt(row, input), journal)) throw unknown();
      await revalidate(tx, journal.events);
      return { created: true, journal };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }

  async confirm(journal: PendingCandidateBatchJournal, eventId: string) {
    const before = journalSchema.parse(journal);
    if (before.events[before.confirmed.length]?.eventId !== eventId) throw unavailable();
    const after = journalSchema.parse({ ...before, confirmed: [...before.confirmed, eventId] });
    const updated = await this.db.operationLog.updateMany({ where: { id: batchId(before.key), action,
      tenantId: before.key.tenantId, workspaceId: before.key.workspaceId, userId: before.key.userId,
      detail: { equals: before } }, data: { detail: after } });
    if (updated.count !== 1 || !same(await this.read(before.key), after)) throw unknown();
    return after;
  }
}
