import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { aiClientTaskReadRequestSchema, aiClientOrderActionSourceSchema, type AiClientOrderActionSource } from '@rental-os/shared';
import { requestFingerprint } from '../rental-adapters/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiClientMaterialScope } from './prisma-client-scene-material.repository';
import type { AiClientTaskDb } from './client-task.authority';
import { clientSqlInitialRevisionSchema, clientSqlPolicyRevisionSchema } from './client-sql-revisions';
import { withClientSelectedInputTransaction } from './client-selected-transactions';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const clientTaskCommandSchema = aiClientTaskReadRequestSchema;
const inputSchema = z.object({ id: z.string().uuid(), tenantId: id, workspaceId: id,
  channel: z.enum(['wechat_miniprogram', 'app', 'web']), principalKind: z.enum(['personal', 'corporate']), principalHash: hash,
  creationKey: id.max(128), materialRef: z.string().uuid(), materialInputHash: hash, materialHash: hash, materialRevision: clientSqlInitialRevisionSchema,
  bindingHash: hash, policyId: z.string().uuid(), policyRevision: clientSqlPolicyRevisionSchema, policyHash: hash,
  sceneCode: id.max(128), sceneVersion: id.max(64), inputHash: hash, revision: clientSqlInitialRevisionSchema,
  dispatchState: z.literal('UNKNOWN'), createdAt: z.date(), expiresAt: z.date() }).strict();
export type AiClientTaskInput = z.infer<typeof inputSchema>;
export const clientTaskInputHash = (row: Omit<AiClientTaskInput, 'inputHash'>) => {
  const { inputHash: _hash, ...value } = row as AiClientTaskInput;
  return requestFingerprint({ version: 'ain-client-task-input-1', ...value, createdAt: value.createdAt.toISOString(), expiresAt: value.expiresAt.toISOString() });
};
export const clientTaskCreationKey = (input: AiClientTaskInput) => `client-material:${input.id}`;
export class AiClientTaskUnknownError extends Error {
  readonly code = 'AI_CLIENT_TASK_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'readTaskCreation';
  constructor() { super('AI_CLIENT_TASK_RESULT_UNKNOWN'); }
}
const unavailable = () => new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
const scopeKeys = ['tenantId', 'workspaceId', 'channel', 'principalKind', 'principalHash'] as const;

export class PrismaClientTaskInputRepository {
  constructor(private readonly db: AiClientTaskDb) {}
  private decode(value: unknown, scope: AiClientMaterialScope) {
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success) throw unavailable();
    const row = parsed.data;
    if (scopeKeys.some(key => row[key] !== scope[key]) || row.expiresAt <= row.createdAt || row.inputHash !== clientTaskInputHash(row)) throw unavailable();
    return row;
  }
  async findCreation(scope: AiClientMaterialScope, creationKey: string, reader: Pick<Prisma.TransactionClient, '$queryRaw'> = this.db, locked = false) {
    try {
      const rows = await reader.$queryRaw<unknown[]>(prismaRuntime.sql`SELECT * FROM ai_client_task_inputs WHERE tenantId = ${scope.tenantId}
        AND workspaceId = ${scope.workspaceId} AND channel = ${scope.channel} AND principalHash = ${scope.principalHash}
        AND creationKey = ${creationKey} LIMIT 1 ${locked ? prismaRuntime.sql`FOR UPDATE` : prismaRuntime.empty}`);
      if (!Array.isArray(rows) || rows.length > 1) throw unavailable();
      if (!rows.length) return null;
      const row = this.decode(rows[0], scope);
      if (row.creationKey !== creationKey) throw unavailable();
      return row;
    } catch (error) { if (error instanceof AiTaskRepositoryError) throw error; throw unavailable(); }
  }
  /** Original own-order input metadata, not a scene selected by the caller.
   * The request host still checks the original material and current read policy. */
  async readOrderNavigationSource(scope: AiClientMaterialScope, value: AiClientOrderActionSource) {
    const source = aiClientOrderActionSourceSchema.parse(structuredClone(value));
    const row = await this.findCreation(scope, source.task.creationKey);
    if (!row || row.materialRef !== source.task.materialRef
      || row.materialInputHash !== requestFingerprint({ kind: 'order', orderId: source.material.orderId })
      || !['quote_clarification', 'order_explanation'].includes(row.sceneCode)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return row;
  }
  async claim(value: AiClientTaskInput) {
    const row = this.decode(structuredClone(value), value);
    let attempted = false;
    try {
      return await this.db.$transaction(async tx => withClientSelectedInputTransaction(this.db, tx, row, async () => {
        const existing = await this.findCreation(row, row.creationKey, tx, true);
        if (existing) {
          if (existing.materialRef !== row.materialRef || existing.sceneCode !== row.sceneCode || existing.sceneVersion !== row.sceneVersion) {
            throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          }
          return { row: existing, claimed: false };
        }
        attempted = true;
        await tx.$executeRaw(prismaRuntime.sql`INSERT INTO ai_client_task_inputs
          (id, tenantId, workspaceId, channel, principalKind, principalHash, creationKey, materialRef, materialInputHash,
           materialHash, materialRevision, bindingHash, policyId, policyRevision, policyHash, sceneCode, sceneVersion,
           inputHash, revision, dispatchState, createdAt, expiresAt)
          VALUES (${row.id}, ${row.tenantId}, ${row.workspaceId}, ${row.channel}, ${row.principalKind}, ${row.principalHash},
            ${row.creationKey}, ${row.materialRef}, ${row.materialInputHash}, ${row.materialHash}, ${row.materialRevision},
            ${row.bindingHash}, ${row.policyId}, ${row.policyRevision}, ${row.policyHash}, ${row.sceneCode}, ${row.sceneVersion},
            ${row.inputHash}, ${row.revision}, ${row.dispatchState}, ${row.createdAt}, ${row.expiresAt})`);
        return { row, claimed: true };
      }), { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (attempted) throw new AiClientTaskUnknownError();
      throw unavailable();
    }
  }
}
