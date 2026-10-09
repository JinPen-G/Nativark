import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_BOOKING_DRAFT_STATES } from '../../../../../../packages/shared/src/ai-booking-draft';
import type { AiClientMaterialDb, AiClientMaterialScope, AiClientSceneMaterial } from './prisma-client-scene-material.repository';
import { AiClientEntryError, entryHash, entryId } from './client-entry-action';

const scopeFields = { tenantId: entryId, workspaceId: entryId, channel: z.enum(['web', 'wechat_miniprogram']),
  principalKind: z.enum(['personal', 'corporate']), principalHash: entryHash };
const draftSchema = z.object({ id: z.string().uuid(), ...scopeFields, materialRef: z.string().uuid(), inputHash: entryHash,
  bindingHash: entryHash, policyHash: entryHash, state: z.enum(AI_BOOKING_DRAFT_STATES), revision: z.number().int().positive(),
  selectionRevision: z.number().int().min(0).max(1), selectedAt: z.date().nullable(), createdAt: z.date(), updatedAt: z.date(),
  expiresAt: z.date(), invalidReason: entryId.nullable() }).strict();
const operationSchema = z.object({ id: z.string().uuid(), ...scopeFields, operationKey: entryId, inputHash: entryHash,
  draftId: z.string().uuid(), kind: z.enum(['create', 'select', 'handoff', 'abandon']), resultRevision: z.number().int().positive(),
  handoffRef: z.string().uuid().nullable(), createdAt: z.date() }).strict();
const handoffSchema = z.object({ id: z.string().uuid(), ...scopeFields, draftId: z.string().uuid(), inputHash: entryHash,
  selectionRevision: z.literal(1), createdAt: z.date(), expiresAt: z.date() }).strict();
export type ClientBookingRow = z.infer<typeof draftSchema>;
export type ClientBookingOperation = z.infer<typeof operationSchema>;
export type ClientBookingHandoffRow = z.infer<typeof handoffSchema>;
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
const sameScope = (row: AiClientMaterialScope, scope: AiClientMaterialScope) =>
  (['tenantId', 'workspaceId', 'channel', 'principalKind', 'principalHash'] as const).every(key => row[key] === scope[key]);
const conflict = () => new AiClientEntryError('AI_REVISION_CONFLICT', 'booking_operation_conflict', 'read_booking_operation');
const unavailable = () => new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'booking_storage_unavailable');
const active = ['draft_created', 'user_selected', 'handed_to_booking_page'];

export class PrismaClientBookingRepository {
  constructor(private readonly db: AiClientMaterialDb, private readonly clock: () => Date) {}
  private async one<T extends AiClientMaterialScope>(reader: Reader, sql: Prisma.Sql, schema: z.ZodType<T>, scope: AiClientMaterialScope): Promise<T | null> {
    try {
      const rows = await reader.$queryRaw<unknown[]>(sql);
      if (!Array.isArray(rows) || rows.length > 1) throw unavailable();
      if (!rows.length) return null;
      const parsed = schema.parse(rows[0]);
      if (!sameScope(parsed, scope)) throw unavailable();
      return parsed;
    } catch { throw unavailable(); }
  }
  async find(scope: AiClientMaterialScope, id: string, reader: Reader = this.db, locked = false) {
    const row = await this.one(reader, Prisma.sql`SELECT * FROM ai_client_booking_drafts WHERE tenantId = ${scope.tenantId}
      AND workspaceId = ${scope.workspaceId} AND channel = ${scope.channel} AND principalHash = ${scope.principalHash}
      AND id = ${id} LIMIT 1 ${locked ? Prisma.sql`FOR UPDATE` : Prisma.empty}`, draftSchema, scope);
    if (row && row.id !== id) throw unavailable();
    return row;
  }
  async operation(scope: AiClientMaterialScope, operationKey: string, reader: Reader = this.db) {
    const row = await this.one(reader, Prisma.sql`SELECT * FROM ai_client_booking_draft_operations WHERE tenantId = ${scope.tenantId}
      AND workspaceId = ${scope.workspaceId} AND channel = ${scope.channel} AND principalHash = ${scope.principalHash}
      AND operationKey = ${operationKey} LIMIT 1`, operationSchema, scope);
    if (row && row.operationKey !== operationKey) throw unavailable();
    return row;
  }
  async handoff(scope: AiClientMaterialScope, id: string) {
    const row = await this.one(this.db, Prisma.sql`SELECT * FROM ai_client_booking_handoffs WHERE tenantId = ${scope.tenantId}
      AND workspaceId = ${scope.workspaceId} AND channel = ${scope.channel} AND principalHash = ${scope.principalHash}
      AND id = ${id} LIMIT 1`, handoffSchema, scope);
    if (row && row.id !== id) throw unavailable();
    return row;
  }
  private async record(tx: Prisma.TransactionClient, row: ClientBookingRow, operationKey: string, inputHash: string,
    kind: ClientBookingOperation['kind'], handoffRef: string | null) {
    const operation: ClientBookingOperation = { id: randomUUID(), tenantId: row.tenantId, workspaceId: row.workspaceId,
      channel: row.channel, principalKind: row.principalKind, principalHash: row.principalHash, operationKey, inputHash,
      draftId: row.id, kind, resultRevision: row.revision, handoffRef, createdAt: this.clock() };
    await tx.$executeRaw(Prisma.sql`INSERT INTO ai_client_booking_draft_operations
      (id, tenantId, workspaceId, channel, principalKind, principalHash, operationKey, inputHash, draftId, kind, resultRevision, handoffRef, createdAt)
      VALUES (${operation.id}, ${operation.tenantId}, ${operation.workspaceId}, ${operation.channel}, ${operation.principalKind},
        ${operation.principalHash}, ${operation.operationKey}, ${operation.inputHash}, ${operation.draftId}, ${operation.kind},
        ${operation.resultRevision}, ${operation.handoffRef}, ${operation.createdAt})`);
    return operation;
  }
  async create(material: AiClientSceneMaterial, policyHash: string, expiresAt: Date, operationKey: string, inputHash: string) {
    let attempted = false;
    try {
      return await this.db.$transaction(async tx => {
        const prior = await this.operation(material, operationKey, tx);
        if (prior) {
          if (prior.inputHash !== inputHash || prior.kind !== 'create') throw conflict();
          const row = await this.find(material, prior.draftId, tx);
          if (!row || row.materialRef !== material.id) throw conflict();
          return { row, operation: prior, replayed: true };
        }
        const existing = await this.one(tx, Prisma.sql`SELECT * FROM ai_client_booking_drafts WHERE tenantId = ${material.tenantId}
          AND workspaceId = ${material.workspaceId} AND channel = ${material.channel} AND principalHash = ${material.principalHash}
          AND materialRef = ${material.id} LIMIT 1 FOR UPDATE`, draftSchema, material);
        if (existing) throw conflict();
        const now = this.clock();
        if (expiresAt <= now) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'booking_expired', 'reprepare');
        const row = draftSchema.parse({ id: randomUUID(), tenantId: material.tenantId, workspaceId: material.workspaceId,
          channel: material.channel, principalKind: material.principalKind, principalHash: material.principalHash,
          materialRef: material.id, inputHash: material.inputHash, bindingHash: material.bindingHash, policyHash,
          state: 'draft_created', revision: 1, selectionRevision: 0, selectedAt: null, createdAt: now, updatedAt: now,
          expiresAt, invalidReason: null });
        attempted = true;
        await tx.$executeRaw(Prisma.sql`INSERT INTO ai_client_booking_drafts
          (id, tenantId, workspaceId, channel, principalKind, principalHash, materialRef, inputHash, bindingHash, policyHash,
           state, revision, selectionRevision, selectedAt, createdAt, updatedAt, expiresAt, invalidReason)
          VALUES (${row.id}, ${row.tenantId}, ${row.workspaceId}, ${row.channel}, ${row.principalKind}, ${row.principalHash},
            ${row.materialRef}, ${row.inputHash}, ${row.bindingHash}, ${row.policyHash}, ${row.state}, ${row.revision},
            ${row.selectionRevision}, ${row.selectedAt}, ${row.createdAt}, ${row.updatedAt}, ${row.expiresAt}, ${row.invalidReason})`);
        return { row, operation: await this.record(tx, row, operationKey, inputHash, 'create', null), replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (attempted) throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'booking_commit_unacknowledged', 'read_booking_operation');
      if (error instanceof AiClientEntryError) throw error;
      throw unavailable();
    }
  }
  async transition(expected: ClientBookingRow, kind: 'select' | 'handoff' | 'abandon', operationKey: string, inputHash: string) {
    let attempted = false;
    try {
      return await this.db.$transaction(async tx => {
        const row = await this.find(expected, expected.id, tx, true);
        if (!row) throw conflict();
        const prior = await this.operation(row, operationKey, tx);
        if (prior) {
          if (prior.inputHash !== inputHash || prior.draftId !== row.id || prior.kind !== kind) throw conflict();
          return { row, operation: prior, replayed: true };
        }
        const now = this.clock();
        if (row.revision !== expected.revision || row.inputHash !== expected.inputHash || row.bindingHash !== expected.bindingHash
          || row.policyHash !== expected.policyHash || row.expiresAt <= now || !active.includes(row.state)
          || (kind === 'select' && row.state !== 'draft_created') || (kind === 'handoff' && row.state !== 'user_selected')) throw conflict();
        const state = kind === 'select' ? 'user_selected' : kind === 'handoff' ? 'handed_to_booking_page' : 'abandoned';
        const selectedAt = kind === 'select' ? now : row.selectedAt, selectionRevision = kind === 'select' ? 1 : row.selectionRevision;
        attempted = true;
        const count = await tx.$executeRaw(Prisma.sql`UPDATE ai_client_booking_drafts SET state = ${state}, revision = ${row.revision + 1},
          selectionRevision = ${selectionRevision}, selectedAt = ${selectedAt}, updatedAt = ${now}
          WHERE tenantId = ${row.tenantId} AND workspaceId = ${row.workspaceId} AND channel = ${row.channel}
          AND principalHash = ${row.principalHash} AND id = ${row.id} AND revision = ${row.revision} AND state = ${row.state}
          AND expiresAt > ${now}`);
        if (count !== 1) throw conflict();
        const updated = draftSchema.parse({ ...row, state, revision: row.revision + 1, selectionRevision, selectedAt, updatedAt: now });
        let handoffRef: string | null = null;
        if (kind === 'handoff') {
          handoffRef = randomUUID();
          const expiresAt = new Date(Math.min(row.expiresAt.getTime(), now.getTime() + 60000));
          await tx.$executeRaw(Prisma.sql`INSERT INTO ai_client_booking_handoffs
            (id, tenantId, workspaceId, channel, principalKind, principalHash, draftId, inputHash, selectionRevision, createdAt, expiresAt)
            VALUES (${handoffRef}, ${row.tenantId}, ${row.workspaceId}, ${row.channel}, ${row.principalKind}, ${row.principalHash},
              ${row.id}, ${row.inputHash}, ${selectionRevision}, ${now}, ${expiresAt})`);
        }
        return { row: updated, operation: await this.record(tx, updated, operationKey, inputHash, kind, handoffRef), replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (attempted) throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'booking_commit_unacknowledged', 'read_booking_operation');
      if (error instanceof AiClientEntryError) throw error;
      throw unavailable();
    }
  }
  async invalidate(row: ClientBookingRow, state: 'stale' | 'expired', reason: string) {
    if (!active.includes(row.state)) return;
    await this.db.$executeRaw(Prisma.sql`UPDATE ai_client_booking_drafts SET state = ${state}, revision = ${row.revision + 1},
      invalidReason = ${reason}, updatedAt = ${this.clock()} WHERE tenantId = ${row.tenantId} AND workspaceId = ${row.workspaceId}
      AND channel = ${row.channel} AND principalHash = ${row.principalHash} AND id = ${row.id} AND revision = ${row.revision}
      AND state = ${row.state}`);
  }
}
