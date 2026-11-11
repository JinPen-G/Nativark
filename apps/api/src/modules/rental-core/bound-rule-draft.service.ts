/** Original rule proposal -> exact Core draft save and original operation read.
 * Uses the existing workspace/category mutex, Core validator/version chain and
 * transactional business operation log. Issued rules are restored to a NEW
 * draft; no publication, pricing adoption, task or approval is performed.
 * Callers must run the original rules edit/read Guard and its revalidation. */
import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type PrismaClient, type OperationLog } from '@prisma/client';
import { z } from 'zod';
import { isRentalCategoryCode } from '@rental-os/shared';
import { getRequestIdentity } from '../../common/request-identity';
import type { BusinessContext, RentalBusinessService } from './rental-business.service';
import { requestFingerprint } from './rental-idempotency.repository';
import { lockCategoryContext } from './category-active-write';
import { readRentalCategoryCode } from './category-identity';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const field = z.enum(['fulfillment.pickupInspectionRequired', 'fulfillment.returnInspectionRequired', 'fulfillment.evidenceRequired',
  'fulfillment.allowDifferentReturnLocation', 'damage.manualReviewRequired', 'cancellation.weatherExceptionEnabled']);
const changes = z.array(z.object({ field, before: z.boolean(), after: z.boolean() }).strict()).min(1).max(6)
  .refine(rows => new Set(rows.map(row => row.field)).size === rows.length);
const normalizationValue = z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.array(z.string().max(191)).max(100)]);
const normalizations = z.array(z.object({ field: z.enum(['qualification.documentTypes', 'qualification.minimumValidityDays']),
  before: normalizationValue, after: normalizationValue, source: z.literal('original_core_normalization') }).strict()).max(2);
export const boundRuleDraftCommandSchema = z.object({ targetId: id, version: id, changes,
  categoryCode: z.string().refine(isRentalCategoryCode), categoryVersion: id,
  changeReason: z.string().trim().min(1).max(500), operationKey: id.max(128), bindingHash: hash }).strict();
export const boundRuleDraftOperationSchema = boundRuleDraftCommandSchema.extend({ reviewHash: hash }).strict();
const savedSchema = z.object({ kind: z.literal('rule-bound-draft-1'), receiptId: id, operationKey: id, commandHash: hash,
  tenantId: id, workspaceId: id, actorId: id, bindingHash: hash, reviewHash: hash, sourceId: id, sourceVersion: id,
  resultId: id, resultVersion: id, restoring: z.boolean(), sourceConfigFingerprint: hash, candidateConfigFingerprint: hash,
  changes, normalizations, changeReason: z.string().min(1).max(500), committedAt: z.string().datetime({ offset: true }), receiptHash: hash }).strict();
const action = 'rule.draft.bound.save';
const canonical = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
export class BoundRuleDraftUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN'; readonly retryable = false;
  readonly nextAction = 'read_original_rule_draft_operation';
  constructor() { super('原规则草稿操作结果待核对'); }
}
type Db = Pick<PrismaClient, '$transaction' | 'operationLog' | 'rentalRuleVersion'>;
type Business = Pick<RentalBusinessService, 'prepareBoundRuleDraft' | 'refreshBoundRuleDraftVersion'>;
export class BoundRuleDraftService {
  constructor(private readonly db: Db, private readonly business: Business, private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.$transaction !== 'function' || typeof db.operationLog?.findUnique !== 'function'
      || typeof db.rentalRuleVersion?.findFirst !== 'function' || typeof business?.prepareBoundRuleDraft !== 'function'
      || typeof business.refreshBoundRuleDraftVersion !== 'function') throw new ServiceUnavailableException('原规则绑定草稿端口未装配');
  }
  private scope(tenantId: string) {
    const identity = getRequestIdentity();
    if (!identity?.userId || !identity.workspaceId || identity.tenantId !== tenantId || identity.isSaasAdmin || identity.staffApi
      || identity.audience === 'client') throw new ForbiddenException('规则草稿缺少当前营运主体');
    return { tenantId, workspaceId: identity.workspaceId, actorId: identity.userId };
  }
  private target(tenantId: string, value: unknown, operation: boolean) {
    const parsed = (operation ? boundRuleDraftOperationSchema : boundRuleDraftCommandSchema).safeParse(structuredClone(value));
    if (!parsed.success) throw new ConflictException('规则绑定草稿命令不完整');
    const command = parsed.data, scope = this.scope(tenantId);
    const { reviewHash: _reviewHash, ...intent } = operation ? boundRuleDraftOperationSchema.parse(command)
      : { ...boundRuleDraftCommandSchema.parse(command), reviewHash: null };
    const digest = requestFingerprint({ kind: 'rule-bound-draft-1', scope, operationKey: command.operationKey });
    const receiptId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    return { command, intent, scope, receiptId, newDraftId: `br-${digest.slice(0, 32)}`, commandHash: requestFingerprint({ scope, command }) };
  }
  private async candidate(context: BusinessContext, target: ReturnType<BoundRuleDraftService['target']>, tx: Prisma.TransactionClient,
    category?: Awaited<ReturnType<typeof lockCategoryContext>>) {
    const { command, scope } = target;
    const current = category ?? await lockCategoryContext(tx, scope.tenantId, scope.workspaceId, context);
    if (current.definition.code !== command.categoryCode || current.definition.version !== command.categoryVersion)
      throw new ConflictException('原规则品类采用已变化');
    const source = await tx.rentalRuleVersion.findFirst({ where: { id: command.targetId, tenantId: scope.tenantId,
      workspaceId: scope.workspaceId, version: command.version } });
    if (!source || source.id !== command.targetId || source.tenantId !== scope.tenantId || source.workspaceId !== scope.workspaceId
      || source.version !== command.version || readRentalCategoryCode(source.categoryCode) !== command.categoryCode) throw new ConflictException('原规则对象或版本已变化');
    const versions = await tx.rentalRuleVersion.findMany({ where: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      select: { version: true }, orderBy: { version: 'asc' }, take: 1001 });
    if (versions.length > 1000) throw new ServiceUnavailableException('原规则版本集合超出完整读取上限');
    const prepared = this.business.prepareBoundRuleDraft(scope.tenantId, context, source, command.changes, versions, command.changeReason);
    const reviewHash = requestFingerprint({ scope, command: target.intent, categoryBinding: current.binding,
      source: canonical(source), candidateConfigFingerprint: prepared.preview.candidateConfigFingerprint,
      resultVersion: prepared.resultVersion, restoring: prepared.restoring });
    return { source, prepared, reviewHash };
  }
  private async receipt(row: OperationLog, target: ReturnType<BoundRuleDraftService['target']>, tx: Pick<PrismaClient, 'rentalRuleVersion'>) {
    const parsed = savedSchema.safeParse(row.detail), { command, scope } = target;
    if (!parsed.success || row.id !== target.receiptId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
      || row.userId !== scope.actorId || row.action !== action || row.rentalOrderId !== null
      || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())) throw new ConflictException('原规则操作收据关联损坏');
    const saved = parsed.data, { receiptHash, ...proof } = saved;
    if (receiptHash !== requestFingerprint(proof) || saved.receiptId !== row.id || saved.commandHash !== target.commandHash
      || saved.tenantId !== scope.tenantId || saved.workspaceId !== scope.workspaceId || saved.actorId !== scope.actorId
      || saved.sourceId !== command.targetId || saved.sourceVersion !== command.version || saved.bindingHash !== command.bindingHash
      || saved.reviewHash !== boundRuleDraftOperationSchema.parse(command).reviewHash || saved.operationKey !== command.operationKey
      || saved.changeReason !== command.changeReason || requestFingerprint(saved.changes) !== requestFingerprint(command.changes)
      || saved.committedAt !== row.createdAt.toISOString() || saved.resultId !== (saved.restoring ? target.newDraftId : command.targetId))
      throw new ConflictException('同一原规则操作键不能更换内容、版本或主体');
    // A later legitimate edit/publication is not a replay of this save. Check
    // the persistent target lineage, not today's config against an old receipt.
    const result = await tx.rentalRuleVersion.findFirst({ where: { id: saved.resultId, tenantId: scope.tenantId,
      workspaceId: scope.workspaceId, version: saved.resultVersion } });
    if (!result || result.id !== saved.resultId || result.tenantId !== scope.tenantId || result.workspaceId !== scope.workspaceId
      || result.version !== saved.resultVersion || saved.restoring && result.restoredFromVersion !== saved.sourceVersion)
      throw new BoundRuleDraftUnknownError();
    return { state: 'committed' as const, receiptId: saved.receiptId, operationKey: saved.operationKey,
      source: { id: saved.sourceId, version: saved.sourceVersion, configFingerprint: saved.sourceConfigFingerprint },
      draft: { id: saved.resultId, version: saved.resultVersion, configFingerprint: saved.candidateConfigFingerprint,
        mode: saved.restoring ? 'restored_new_draft' as const : 'updated_original_draft' as const },
      changes: saved.changes, normalizations: saved.normalizations, committedAt: saved.committedAt, reviewHash: saved.reviewHash,
      businessDraft: 'saved_not_published_at_commit' as const, publication: 'not_performed_by_operation' as const };
  }
  async review(tenantId: string, context: BusinessContext, value: unknown, revalidate: () => Promise<void>) {
    if (typeof revalidate !== 'function') throw new ForbiddenException();
    const target = this.target(tenantId, value, false);
    if (context.category.code.toLowerCase() !== target.command.categoryCode || context.category.version !== target.command.categoryVersion)
      throw new ConflictException('原规则品类采用已变化，请重新准备提案');
    return this.db.$transaction(async tx => {
      const found = await this.candidate(context, target, tx); await revalidate();
      if (requestFingerprint(this.scope(tenantId)) !== requestFingerprint(target.scope)) throw new ForbiddenException();
      return { reviewHash: found.reviewHash, preview: found.prepared.preview, normalizations: found.prepared.normalizations, resultVersion: found.prepared.resultVersion,
        mode: found.prepared.restoring ? 'restore_to_new_draft' as const : 'edit_original_draft' as const,
        persistence: 'not_attempted' as const, publication: 'not_attempted' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
  }
  async read(tenantId: string, value: unknown, revalidate: () => Promise<void>) {
    if (typeof revalidate !== 'function') throw new ForbiddenException();
    const target = this.target(tenantId, value, true);
    const row = await this.db.operationLog.findUnique({ where: { id: target.receiptId } });
    const result = row ? await this.receipt(row, target, this.db) : { state: 'not_observed' as const, retryable: false as const };
    await revalidate();
    if (requestFingerprint(this.scope(tenantId)) !== requestFingerprint(target.scope)) throw new ForbiddenException();
    return result;
  }
  async save(tenantId: string, context: BusinessContext, value: unknown, revalidate: () => Promise<void>) {
    if (typeof revalidate !== 'function') throw new ForbiddenException();
    const target = this.target(tenantId, value, true), command = boundRuleDraftOperationSchema.parse(target.command), { scope } = target;
    let attempted = false, definiteNoWrite = false;
    let result;
    try {
      result = await this.db.$transaction(async tx => {
        const category = await lockCategoryContext(tx, tenantId, scope.workspaceId, context);
        if (category.definition.code !== command.categoryCode) throw new ConflictException('原规则品类采用已变化');
        if (category.definition.version !== command.categoryVersion || context.category.version !== command.categoryVersion)
          throw new ConflictException('原规则品类采用已变化');
        const prior = await tx.operationLog.findUnique({ where: { id: target.receiptId } });
        if (prior) { const receipt = await this.receipt(prior, target, tx); await revalidate(); return { receipt, replayed: true }; }
        const found = await this.candidate(context, target, tx, category), { source, prepared } = found;
        if (found.reviewHash !== command.reviewHash) throw new ConflictException('规则完整配置或版本集合已变化，请重新核对');
        if (prepared.restoring && await tx.rentalRuleVersion.findFirst({ where: { id: target.newDraftId } })) throw new BoundRuleDraftUnknownError();
        const at = this.clock(); if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new ConflictException('规则提交时点不可用');
        await revalidate();
        if (requestFingerprint(this.scope(tenantId)) !== requestFingerprint(scope)) throw new ForbiddenException();
        const data = { config: canonical(prepared.config) as Prisma.InputJsonValue, changeReason: prepared.changeReason, createdBy: scope.actorId };
        const resultId = prepared.restoring ? target.newDraftId : source.id;
        attempted = true;
        if (prepared.restoring) {
          await tx.rentalRuleVersion.create({ data: { ...data, id: resultId, tenantId, workspaceId: scope.workspaceId,
            categoryCode: source.categoryCode, version: prepared.resultVersion, status: 'draft', createdAt: at,
            previousVersion: source.version, restoredFromVersion: source.version, restoreReason: prepared.restoreReason } });
          await tx.rentalRuleVersionAudit.create({ data: { id: target.receiptId, tenantId, workspaceId: scope.workspaceId,
            ruleVersionId: resultId, version: prepared.resultVersion, action: 'restore', fromStatus: null, toStatus: 'draft',
            reason: command.changeReason, operator: scope.actorId, at } });
        } else {
          const changed = await tx.rentalRuleVersion.updateMany({ where: { id: source.id, tenantId, workspaceId: scope.workspaceId,
            version: source.version, status: 'draft', config: { equals: source.config as Prisma.InputJsonValue } }, data });
          if (changed.count !== 1) { definiteNoWrite = changed.count === 0; throw new ConflictException('原规则草稿CAS未提交'); }
        }
        const written = await tx.rentalRuleVersion.findFirst({ where: { id: resultId, tenantId, workspaceId: scope.workspaceId,
          version: prepared.resultVersion } });
        if (!written || written.status !== 'draft' || requestFingerprint(canonical(written.config)) !== prepared.preview.candidateConfigFingerprint)
          throw new ConflictException('原规则草稿写入结果不一致');
        const proof = { kind: 'rule-bound-draft-1' as const, receiptId: target.receiptId, operationKey: command.operationKey,
          commandHash: target.commandHash, ...scope, bindingHash: command.bindingHash, reviewHash: command.reviewHash,
          sourceId: source.id, sourceVersion: source.version, resultId, resultVersion: prepared.resultVersion, restoring: prepared.restoring,
          sourceConfigFingerprint: prepared.preview.sourceConfigFingerprint, candidateConfigFingerprint: prepared.preview.candidateConfigFingerprint,
          changes: command.changes, normalizations: prepared.normalizations, changeReason: command.changeReason, committedAt: at.toISOString() };
        const row = await tx.operationLog.create({ data: { id: target.receiptId, tenantId, workspaceId: scope.workspaceId,
          userId: scope.actorId, rentalOrderId: null, action, detail: { ...proof, receiptHash: requestFingerprint(proof) }, createdAt: at } });
        await revalidate();
        return { receipt: await this.receipt(row, target, tx), replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) { if (attempted && !definiteNoWrite) throw new BoundRuleDraftUnknownError(); throw error; }
    try {
      await revalidate(); await this.business.refreshBoundRuleDraftVersion(tenantId, context, result.receipt.draft.id);
      if (requestFingerprint(this.scope(tenantId)) !== requestFingerprint(scope)) throw new ForbiddenException();
    } catch { throw new BoundRuleDraftUnknownError(); }
    return result;
  }
}
