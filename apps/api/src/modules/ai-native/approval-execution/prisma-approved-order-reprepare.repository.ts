import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AiTaskRepositoryError } from '../ai-task.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), shortId = id.max(36);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), revision = z.number().int().min(1).max(4294967294);
export const reprepareRowSchema = z.object({
  id: shortId, scopeId: shortId, operationKey: id, commandHash: hash, actorId: id, audience: z.enum(['operator', 'staff']),
  originalTaskId: shortId, originalProposalId: shortId, originalRevision: revision, originalPayloadHash: hash,
  originalActionId: id, originalFingerprint: hash, replacementTaskId: shortId, replacementRunId: shortId,
  replacementActionId: id, replacementFingerprint: hash, replacementInputRef: shortId, originalInputRef: id,
  quoteSelectionRef: shortId, planHash: hash, proofHash: hash, replacementProposalId: shortId,
  replacementRevision: revision, replacementPayloadHash: hash, createdAt: z.date()
}).strict();
export type ApprovedOrderReprepareRow = z.infer<typeof reprepareRowSchema>;
const columns = Object.keys(reprepareRowSchema.shape) as (keyof ApprovedOrderReprepareRow)[];
type Reader = Pick<PrismaClient, '$queryRaw'>;

export class PrismaApprovedOrderReprepareRepository {
  constructor(private readonly db: Reader) {}

  async find(scopeId: string, operationKey: string, db: Reader = this.db) {
    if (!shortId.safeParse(scopeId).success || !id.safeParse(operationKey).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const rows = await db.$queryRaw<unknown[]>(Prisma.sql`SELECT * FROM ai_approval_reprepares WHERE scopeId = ${scopeId} AND operationKey = ${operationKey} LIMIT 1`);
    if (!rows.length) return null;
    const row = reprepareRowSchema.parse(rows[0]);
    if (row.scopeId !== scopeId || row.operationKey !== operationKey) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    return row;
  }

  async insert(value: ApprovedOrderReprepareRow, tx: Prisma.TransactionClient) {
    const row = reprepareRowSchema.parse(value);
    if (row.originalTaskId === row.replacementTaskId) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    // Identifiers come only from the fixed schema; every stored value is a bound parameter.
    await tx.$executeRaw(Prisma.sql`INSERT INTO ai_approval_reprepares (${Prisma.raw(columns.map(key => `\`${key}\``).join(', '))}) VALUES (${Prisma.join(columns.map(key => row[key]))})`);
    return row;
  }
}
