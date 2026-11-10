/** Exact original calendar draft CAS and append-only original-operation receipt.
 * Reuses Core range/limited-hours rules and the original workspace/category
 * mutex. No schema, public route, calendar creation, publication or price change.
 * Server callers must run the original edit/read Guard and provide its current
 * revalidation callback; ALS/command fields alone never grant a calendar write. */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, type PrismaClient, type RentalCalendarOverrideAuditEntry } from '@prisma/client';
import { z } from 'zod';
import type { RentalCalendarDay, RentalCalendarYear } from '@rental-os/shared';
import { getRequestIdentity } from '../../common/request-identity';
import type { BusinessContext, RentalBusinessService } from './rental-business.service';
import { requestFingerprint } from './rental-idempotency.repository';
import { lockActiveCategoryBinding } from './category-active-write';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const fields = z.object({ name: z.string().min(1).max(120).optional(), businessStatus: z.enum(['open', 'limited', 'closed', 'self_service']).optional() }).strict()
  .refine(value => Object.keys(value).length > 0);
export const boundCalendarDraftCommandSchema = z.object({ targetId: id, year: z.number().int().min(1900).max(2200), version: id,
  expectedRevision: z.number().int().min(0).max(4294967294), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), fields,
  before: z.object({ name: z.string().min(1).max(120).optional(), businessStatus: z.enum(['open', 'limited', 'closed', 'self_service']).optional(), closed: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0),
  overrideReason: z.string().trim().min(1).max(1000), overrideConfirmed: z.boolean(), operationKey: id.max(128), bindingHash: hash,
  categoryCode: z.enum(['camera', 'camping', 'vehicle', 'construction']), categoryVersion: id,
  reviewHash: hash.optional() }).strict();
export type BoundCalendarDraftCommand = z.infer<typeof boundCalendarDraftCommandSchema>;
const marker = '__rentalBoundDraftOperation';
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export class BoundCalendarDraftUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN'; readonly retryable = false;
  readonly nextAction = 'read_original_calendar_draft_operation';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}
export class BoundCalendarDraftService {
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'rentalCalendarOverrideAuditEntry'>,
    private readonly business: Pick<RentalBusinessService, 'prepareBoundCalendarDraftDay' | 'refreshBoundCalendarDraftYear'>,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.$transaction !== 'function' || typeof db.rentalCalendarOverrideAuditEntry?.findUnique !== 'function'
      || typeof business?.prepareBoundCalendarDraftDay !== 'function' || typeof business.refreshBoundCalendarDraftYear !== 'function')
      throw new ConflictException('原日历绑定草稿端口未装配');
  }
  private scope(tenantId: string) {
    const identity = getRequestIdentity();
    if (!identity?.userId || !identity.workspaceId || identity.tenantId !== tenantId || identity.isSaasAdmin || identity.staffApi)
      throw new ForbiddenException('日历草稿缺少当前营运主体');
    return { tenantId, workspaceId: identity.workspaceId, actorId: identity.userId };
  }
  private target(tenantId: string, value: unknown) {
    const parsed = boundCalendarDraftCommandSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new ConflictException('日历绑定草稿命令不完整');
    const command = parsed.data, scope = this.scope(tenantId);
    const digest = requestFingerprint({ kind: 'calendar-bound-draft-1', scope, operationKey: command.operationKey });
    const receiptId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    const metadata = { kind: 'calendar-bound-draft-1', ...scope, receiptId, commandHash: requestFingerprint({ scope, command }),
      targetId: command.targetId, year: command.year, version: command.version, date: command.date,
      baseRevision: command.expectedRevision, resultRevision: command.expectedRevision + 1,
      operationKey: command.operationKey, bindingHash: command.bindingHash,
      ...(command.reviewHash !== undefined ? { reviewHash: command.reviewHash, overrideConfirmed: command.overrideConfirmed } : {}) };
    return { command, scope, metadata };
  }
  private async candidate(context: BusinessContext, target: ReturnType<BoundCalendarDraftService['target']>, tx: Prisma.TransactionClient) {
    const { command, scope } = target;
    const category = await lockActiveCategoryBinding(tx, scope.tenantId, scope.workspaceId, undefined, command.categoryCode);
    const canonical = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
    if (category.definition.version !== command.categoryVersion
      || requestFingerprint(canonical(context.category)) !== requestFingerprint(canonical(category.definition)))
      throw new ConflictException('原品类采用或 Core 上下文已变化');
    await tx.$queryRaw(Prisma.sql`SELECT id FROM rental_business_calendars WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND year = ${command.year} FOR UPDATE`);
    const versions = await tx.rentalBusinessCalendar.findMany({ where: { tenantId: scope.tenantId, workspaceId: scope.workspaceId, year: command.year },
      select: { id: true, tenantId: true, workspaceId: true, year: true, version: true, status: true, revision: true, days: true },
      orderBy: { id: 'asc' }, take: 1001 });
    if (versions.length > 1000) throw new ConflictException('原日历版本集合超出有界复核范围');
    const base = versions.find(row => row.id === command.targetId && row.version === command.version);
    if (!base || base.status !== 'draft' || base.revision !== command.expectedRevision || !Array.isArray(base.days)
      || base.days.length > 366) throw new ConflictException('原日历对象或版本已变化');
    const days = base.days as unknown as RentalCalendarDay[], current = days.find(day => day.date === command.date);
    if (!current || Object.keys(command.before).some(key => requestFingerprint(current[key as keyof RentalCalendarDay])
      !== requestFingerprint(command.before[key as keyof typeof command.before]))) throw new ConflictException('原日期字段依据已变化');
    if (current.source === 'tenant_override' && !command.overrideConfirmed) throw new ConflictException('已有覆盖需本次明确确认');
    const at = this.clock(); if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new ConflictException('日历复核时点不可用');
    const change = this.business.prepareBoundCalendarDraftDay(context,
      { ...base, status: base.status as RentalCalendarYear['status'], days },
      versions.map(row => ({ id: row.id, version: row.version, status: row.status as RentalCalendarYear['status'] })),
      command.date, command.fields, command.overrideReason, scope.actorId, at.toISOString(), target.metadata.receiptId);
    // Audit time is generated again at the write boundary. It is not part of
    // the user-reviewed business effect or a reason to demand another hash.
    const { reviewHash: _reviewHash, ...intent } = command;
    const reviewHash = requestFingerprint(canonical({ scope, intent, categoryBinding: category.binding,
      category: category.definition, context, versions, before: change.before, after: change.after }));
    return { base, days, current, change, at, reviewHash };
  }
  async review(tenantId: string, context: BusinessContext, value: unknown, revalidate: () => Promise<void>) {
    if (typeof revalidate !== 'function') throw new ForbiddenException();
    const target = this.target(tenantId, value);
    return this.db.$transaction(async tx => {
      const found = await this.candidate(context, target, tx); await revalidate();
      if (requestFingerprint(this.scope(tenantId)) !== requestFingerprint(target.scope)) throw new ForbiddenException();
      return { targetId: target.command.targetId, year: target.command.year, version: target.command.version,
        date: target.command.date, baseRevision: target.command.expectedRevision, reviewHash: found.reviewHash,
        before: structuredClone(found.change.before), after: structuredClone(found.change.after),
        overrideRequired: found.current.source === 'tenant_override', existingOverrideReason: found.current.source === 'tenant_override' ? found.current.overrideReason ?? null : null, persistence: 'not_attempted' as const,
        publication: 'not_attempted' as const, validation: 'original_core_bound_calendar_validation' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
  }
  private receipt(row: RentalCalendarOverrideAuditEntry, target: ReturnType<BoundCalendarDraftService['target']>) {
    const { command, scope, metadata } = target;
    if (row.id !== metadata.receiptId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
      || row.year !== command.year || row.version !== command.version || row.date !== command.date
      || row.action !== 'override' || row.operator !== scope.actorId || row.reason !== command.overrideReason
      || row.batchId !== metadata.receiptId || !(row.at instanceof Date) || !Number.isFinite(row.at.getTime()) || !object(row.after)
      || !object(row.after[marker])) throw new ConflictException('原日历提交收据关联损坏');
    const { proofHash, ...saved } = row.after[marker] as Record<string, unknown>;
    // Older reviewed receipts predate the explicit recovery field. Their original
    // command hash still binds the confirmation, and their proof uses that
    // original metadata shape; do not rewrite historical receipt bytes.
    const receiptMetadata = { ...metadata };
    if (!Object.hasOwn(saved, 'overrideConfirmed')) delete (receiptMetadata as { overrideConfirmed?: boolean }).overrideConfirmed;
    if (requestFingerprint(saved) !== requestFingerprint(receiptMetadata)) throw new ConflictException('同一原操作键不能改版本、输入或主体');
    const after = { ...row.after }; delete after[marker];
    const proof = requestFingerprint({ metadata: receiptMetadata, before: row.before, after, reason: row.reason, operator: row.operator, at: row.at.toISOString() });
    if (proofHash !== proof || !object(row.before)
      || Object.keys(command.before).some(key => requestFingerprint((row.before as Record<string, unknown>)[key]) !== requestFingerprint(command.before[key as keyof typeof command.before])))
      throw new ConflictException('原日历提交收据内容损坏');
    return { state: 'committed' as const, receiptId: row.id, operationKey: command.operationKey, commandHash: metadata.commandHash,
      targetId: metadata.targetId, year: row.year, version: row.version, date: row.date,
      baseRevision: metadata.baseRevision, resultRevision: metadata.resultRevision,
      before: structuredClone(row.before), after, committedAt: row.at.toISOString(),
      ...(command.reviewHash !== undefined ? { reviewHash: command.reviewHash } : {}),
      businessDraft: 'saved_not_published' as const, publication: 'not_attempted' as const };
  }
  async read(tenantId: string, value: unknown, revalidate: () => Promise<void>) {
    if (typeof revalidate !== 'function') throw new ForbiddenException();
    const target = this.target(tenantId, value), row = await this.db.rentalCalendarOverrideAuditEntry.findUnique({ where: { id: target.metadata.receiptId } });
    await revalidate();
    if (requestFingerprint(this.scope(tenantId)) !== requestFingerprint(target.scope)) throw new ForbiddenException();
    return row ? this.receipt(row, target) : { state: 'not_observed' as const, operationKey: target.command.operationKey, retryable: false as const };
  }
  async save(tenantId: string, context: BusinessContext, value: unknown, revalidate: () => Promise<void>) {
    if (typeof revalidate !== 'function') throw new ForbiddenException();
    const target = this.target(tenantId, value), { command, scope, metadata } = target;
    let attempted = false, definiteNoWrite = false;
    let result;
    try {
      result = await this.db.$transaction(async tx => {
        const prior = await tx.rentalCalendarOverrideAuditEntry.findUnique({ where: { id: metadata.receiptId } });
        if (prior) { const receipt = this.receipt(prior, target); await revalidate(); return { receipt, replayed: true }; }
        // The same locked candidate powers review and write. Old callers retain
        // their explicit save contract; a human review hash, when supplied,
        // binds the complete original source/context until this commit boundary.
        const { base, days, change, at, reviewHash } = await this.candidate(context, target, tx);
        if (command.reviewHash !== undefined && command.reviewHash !== reviewHash) throw new ConflictException('原日历复核已失效');
        const nextDays = days.map(day => day.date === command.date ? change.day : day);
        await revalidate();
        if (requestFingerprint(this.scope(tenantId)) !== requestFingerprint(scope)) throw new ForbiddenException();
        attempted = true;
        const changed = await tx.rentalBusinessCalendar.updateMany({ where: { id: base.id, tenantId, workspaceId: scope.workspaceId,
          year: command.year, version: command.version, status: 'draft', revision: command.expectedRevision },
          data: { days: nextDays as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } });
        if (changed.count !== 1) { definiteNoWrite = changed.count === 0; throw new ConflictException('原日历 CAS 未提交'); }
        const before = JSON.parse(JSON.stringify(change.before)), after = JSON.parse(JSON.stringify(change.after));
        const proofHash = requestFingerprint({ metadata, before, after, reason: command.overrideReason, operator: scope.actorId, at: at.toISOString() });
        const row = await tx.rentalCalendarOverrideAuditEntry.create({ data: { id: metadata.receiptId, tenantId, workspaceId: scope.workspaceId,
          year: command.year, version: command.version, date: command.date, action: 'override', reason: command.overrideReason,
          operator: scope.actorId, at, batchId: metadata.receiptId, before, after: { ...after, [marker]: { ...metadata, proofHash } } } });
        await revalidate();
        return { receipt: this.receipt(row, target), replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (attempted && !definiteNoWrite) throw new BoundCalendarDraftUnknownError();
      throw error;
    }
    try {
      await revalidate();
      await this.business.refreshBoundCalendarDraftYear(tenantId, context, command.year);
      if (requestFingerprint(this.scope(tenantId)) !== requestFingerprint(scope)) throw new ForbiddenException();
    } catch { throw new BoundCalendarDraftUnknownError(); }
    return result;
  }
}
