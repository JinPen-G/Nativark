import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const taskId = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const statusSchema = z.enum(['queued', 'running', 'waiting_input', 'waiting_confirmation', 'waiting_external', 'cancel_requested', 'cancelled', 'succeeded', 'partially_succeeded', 'failed', 'unknown']);
const cursorPayload = z.object({ id: taskId, updatedAt: z.string().datetime({ offset: true }), status: statusSchema.optional(), sceneCode: taskId.optional() }).strict();
const cursorSchema = z.string().max(512).refine(value => {
  try { return cursorPayload.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))).success; }
  catch { return false; }
}, 'invalid cursor');
const inputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: cursorSchema.optional(),
  status: statusSchema.optional(),
  sceneCode: taskId.optional()
}).strict();

const taskSelect = {
  id: true, status: true, revision: true, sceneCode: true, sceneVersion: true,
  createdAt: true, updatedAt: true, cancelRequestedAt: true
} satisfies Prisma.AiTaskSelect;
type ListDb = Pick<PrismaClient, 'aiTask'>;

export interface AiTaskListAuthority {
  /** Resolve a fresh server identity for the list action; caller scope is not authority. */
  resolveList(input: { status?: string; sceneCode?: string }): Promise<AiExecutionContext>;
  /** A composition may require the existing per-task metadata action policy as well. */
  authorizeMetadata?(taskId: string): Promise<AiExecutionContext>;
}

export interface AiTaskMetadataPage {
  items: Array<{ taskId: string; status: string; revision: number; sceneCode: string; sceneVersion: string; createdAt: string; updatedAt: string; cancelRequestedAt: string | null }>;
  nextCursor: string | null;
}

function encodeCursor(updatedAt: Date, id: string, filters: Pick<z.infer<typeof inputSchema>, 'status' | 'sceneCode'>) {
  return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id, ...filters }), 'utf8').toString('base64url');
}

/** Read-only AIN-12 task-center adapter; it is not an HTTP route or action executor. */
export class AiTaskListRepository {
  constructor(private readonly db: ListDb, private readonly authority: AiTaskListAuthority, private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.aiTask?.findMany !== 'function' || typeof authority?.resolveList !== 'function') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }

  async readPage(value: unknown): Promise<AiTaskMetadataPage> {
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const input = parsed.data;
    let cursor: { updatedAt: Date; id: string } | undefined;
    if (input.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as { updatedAt: string; id: string };
        const parsedCursor = cursorPayload.parse(decoded);
        const updatedAt = new Date(parsedCursor.updatedAt);
        if (!Number.isFinite(updatedAt.getTime()) || parsedCursor.status !== input.status || parsedCursor.sceneCode !== input.sceneCode) throw new Error('cursor_scope_changed');
        cursor = { updatedAt, id: parsedCursor.id };
      } catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
    }
    let context: AiExecutionContext;
    try { context = structuredClone(await this.authority.resolveList({ status: input.status, sceneCode: input.sceneCode })); }
    catch { throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); }
    const access = aiTaskAccessFromContext(context, 'list-placeholder', this.clock());
    const { id: _ignored, ...ownerScopeWhere } = access.where;
    const where: Prisma.AiTaskWhereInput = {
      ...ownerScopeWhere, contractVersion: AI_TASK_DRAFT_VERSION,
      ...(input.status ? { status: input.status.toUpperCase() as Prisma.AiTaskWhereInput['status'] } : {}),
      ...(input.sceneCode ? { sceneCode: input.sceneCode } : {}),
      ...(cursor ? { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] } : {})
    };
    let rows: Array<Prisma.AiTaskGetPayload<{ select: typeof taskSelect }>>;
    try { rows = await this.db.aiTask.findMany({ where, select: taskSelect, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: input.limit + 1 }); }
    catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
    if (!Array.isArray(rows) || rows.length > input.limit + 1) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    if (this.authority.authorizeMetadata) {
      for (const row of rows) {
        const permitted = structuredClone(await this.authority.authorizeMetadata(row.id));
        const check = aiTaskAccessFromContext(permitted, row.id, this.clock());
        if (check.bindingKey !== access.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
    }
    // Sequential current-permission checks do not constitute atomic authorization.
    let current: AiExecutionContext;
    try { current = structuredClone(await this.authority.resolveList({ status: input.status, sceneCode: input.sceneCode })); }
    catch { throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); }
    const after = aiTaskAccessFromContext(current, 'list-placeholder', this.clock());
    const identity = (c: AiExecutionContext) => { const { authorizedAt: _at, requestId: _request, ...rest } = c; return requestFingerprint(rest); };
    if (access.bindingKey !== after.bindingKey || identity(context) !== identity(current)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (!Array.isArray(rows) || rows.length > input.limit + 1 || new Set(rows.map(row => row.id)).size !== rows.length
      || rows.some(row => !taskId.safeParse(row.id).success || !Number.isInteger(row.revision) || row.revision < 1
        || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())
        || !(row.updatedAt instanceof Date) || !Number.isFinite(row.updatedAt.getTime()))) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    const page = rows.slice(0, input.limit);
    const items = page.map(row => ({ taskId: row.id, status: row.status.toLowerCase(), revision: row.revision,
      sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(), cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null }));
    return { items, nextCursor: rows.length > input.limit && page.length ? encodeCursor(page[page.length - 1].updatedAt, page[page.length - 1].id,
      { status: input.status, sceneCode: input.sceneCode }) : null };
  }
}
