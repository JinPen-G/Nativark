import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AiTaskExecutionBudgetError } from '../task-execution-budget.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), shortId = id.max(36);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), revision = z.number().int().min(1).max(4294967294);
export const taskExecutionPhaseStartSchema = z.object({ scopeId: shortId, taskId: shortId, id: shortId, runId: shortId, stepId: shortId,
  originalArtifactId: shortId, inputRef: shortId, stepsChargeId: shortId, activeMsChargeId: shortId, outputBytesChargeId: shortId,
  actionId: id, leaseOwnerId: id, stepFingerprint: hash, planHash: hash,
  fencingToken: z.instanceof(Prisma.Decimal).refine(v => v.isInteger() && v.gt(0) && v.lte('99999999999999999999')).transform(v => v.toFixed(0)),
  runRevision: revision, stepRevision: revision, sequence: z.union([z.literal(1), z.literal(2)]),
  previousReceiptId: shortId.nullable(), decisionRef: shortId.nullable(), createdAt: z.date() }).strict();
export const taskExecutionPhaseReceiptSchema = z.object({ scopeId: shortId, taskId: shortId, id: shortId, runId: shortId, stepId: shortId, phaseId: shortId,
  kind: z.enum(['confirmation', 'succeeded', 'failed', 'unknown']), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u).nullable(),
  payload: z.unknown(), contentHash: hash, activeMs: z.bigint().min(0n).max(86400000n), outputBytes: z.bigint().min(0n).max(16777216n),
  proposalId: shortId.nullable(), proposalRevision: revision.nullable(), reviewedPayloadHash: hash.nullable(),
  decisionRef: shortId.nullable(), businessResultRef: id.nullable(), createdAt: z.date() }).strict();
export type TaskExecutionPhaseStart = z.infer<typeof taskExecutionPhaseStartSchema>;
export type TaskExecutionPhaseReceipt = z.infer<typeof taskExecutionPhaseReceiptSchema>;
type Query = { where: Record<string, unknown>; take?: number; orderBy?: Record<string, string> };
const unavailable = () => new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');

type Delegate = {
  findFirst(args: Query): Promise<unknown>;
  findMany(args: Query): Promise<unknown>;
  create(args: { data: unknown }): Promise<unknown>;
};
function delegate(tx: Prisma.TransactionClient, name: string): Delegate {
  const value: unknown = (tx as unknown as Record<string, unknown>)[name];
  if (!value || typeof value !== 'object' || !('findFirst' in value) || typeof value.findFirst !== 'function'
    || !('findMany' in value) || typeof value.findMany !== 'function' || !('create' in value) || typeof value.create !== 'function') throw unavailable();
  return { findFirst: value.findFirst.bind(value), findMany: value.findMany.bind(value), create: value.create.bind(value) };
}
function start(value: unknown) {
  const row = taskExecutionPhaseStartSchema.parse(value);
  if (row.sequence === 1 ? row.previousReceiptId !== null || row.decisionRef !== null : row.previousReceiptId === null || row.decisionRef === null) throw unavailable();
  return row;
}
function receipt(value: unknown) {
  const row = taskExecutionPhaseReceiptSchema.parse(value);
  const refs = [row.proposalId, row.proposalRevision, row.reviewedPayloadHash];
  if (refs.some(v => v === null) && refs.some(v => v !== null)) throw unavailable();
  if (row.decisionRef !== null && row.proposalId === null) throw unavailable();
  if (row.kind === 'confirmation' && (row.proposalId === null || row.decisionRef !== null || row.businessResultRef !== null || row.errorCode !== null)) throw unavailable();
  if (row.kind === 'succeeded' && (row.businessResultRef === null || row.errorCode !== null)) throw unavailable();
  if (row.kind === 'failed' && (row.errorCode === null || row.businessResultRef !== null)) throw unavailable();
  if (row.kind === 'unknown' && (row.errorCode !== null || row.businessResultRef !== null)) throw unavailable();
  return row;
}

export function taskExecutionPhaseStore(tx: Prisma.TransactionClient) {
  const starts = delegate(tx, 'aiTaskExecutionPhaseStart'), receipts = delegate(tx, 'aiTaskExecutionPhaseReceipt');
  return {
    async createStart(data: z.input<typeof taskExecutionPhaseStartSchema>) {
      start(data);
      return start(await starts.create({ data }));
    },
    async createReceipt(data: z.input<typeof taskExecutionPhaseReceiptSchema>) {
      receipt(data);
      return receipt(await receipts.create({ data }));
    },
    async readStart(where: Query['where']) { const row = await starts.findFirst({ where }); return row ? start(row) : null; },
    async readReceipt(where: Query['where']) { const row = await receipts.findFirst({ where }); return row ? receipt(row) : null; },
    async readStarts(where: Query['where']) {
      const rows = await starts.findMany({ where, take: 3, orderBy: { sequence: 'asc' } });
      if (!Array.isArray(rows) || rows.length > 2) throw unavailable();
      return rows.map(start);
    },
    async readReceipts(where: Query['where']) {
      const rows = await receipts.findMany({ where, take: 3 });
      if (!Array.isArray(rows) || rows.length > 2) throw unavailable();
      return rows.map(receipt);
    }
  };
}
