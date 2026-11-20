import { randomUUID } from 'node:crypto';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient, AiInspectionDraft } from '@prisma/client';
import { z } from 'zod';
import type { AiInspectionActorScope, AiInspectionOperationResult, AiInspectionReceiptLookup, AiInspectionTarget, AiStaffInspectionHistoryItem, AiStaffInspectionHistoryRequest } from '@rental-os/shared';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { requestFingerprint } from '../rental-adapters/rental-idempotency.repository';
import { recognitionSaveAssociationSchema, type RecognitionSaveAssociation, type RecognitionSaveReference } from './inspection-recognition-save.association';

const receiptResult = z.object({ draftId: z.string(), revision: z.number().int().positive(),
  status: z.enum(['draft_saved', 'prepared', 'submission_unknown', 'submitted']), inspectionId: z.string().nullable() }).strict();
const storedReceiptResult = receiptResult.extend({ recognitionSave: recognitionSaveAssociationSchema.optional(),
  recognitionSaveHash: z.string().regex(/^[a-f0-9]{64}$/u).optional() }).strict();
export type InspectionDraftDatabase = Pick<PrismaClient, '$transaction' | 'aiInspectionDraft' | 'aiInspectionOperation'>;
type Operation = { operationId: string; fingerprint: string; expectedRevision: number; recognitionSave?: RecognitionSaveAssociation };
type Create = Omit<Prisma.AiInspectionDraftUncheckedCreateInput, 'id' | 'revision' | 'operations'>;
type Change = Pick<Prisma.AiInspectionDraftUncheckedUpdateManyInput,
  'state' | 'status' | 'evidenceFingerprint' | 'inputFingerprint' | 'submissionActionId' | 'inspectionId'>;

/** The original action owner fences THIS transaction before any draft write.
 * Result linkage remains separately classified: it cannot submit or replay Core. */
export interface InspectionDraftTransactionAuthority {
  begin(tx: Prisma.TransactionClient, scope: AiInspectionActorScope): Promise<{
    lockTarget(target: AiInspectionTarget, bindingFingerprint: string, mode: 'mutation' | 'original_result'): Promise<void>;
    revalidate(): Promise<void>;
  }>;
}
const targetOf = (row: { orderId: string; allocationId: string; stage: string; templateId: string }) =>
  parseInspectionInput(inspectionTargetSchema.extend({ templateId: inspectionId }).strict(), {
    orderId: row.orderId, allocationId: row.allocationId, stage: row.stage, templateId: row.templateId
  });

export class PrismaInspectionDraftRepository {
  constructor(private readonly db: InspectionDraftDatabase, private readonly transactions?: InspectionDraftTransactionAuthority) {}

  async create(scope: AiInspectionActorScope, operation: Operation, data: Create): Promise<AiInspectionOperationResult> {
    const input = structuredClone({ scope, operation, data });
    this.checkOperation(input.operation);
    if (input.operation.expectedRevision !== 0 || Object.entries(input.scope).some(([key, value]) => input.data[key as keyof Create] !== value)) {
      throw new InspectionAssistError('INVALID_INPUT');
    }
    this.checkState(input.data.state);
    return this.write(input.scope, input.operation, async (tx, lease) => {
      await lease?.lockTarget(targetOf(input.data), input.data.bindingFingerprint, 'mutation');
      const row = await tx.aiInspectionDraft.create({ data: { ...input.data, ...input.scope, id: randomUUID(), revision: 1 } });
      return this.record(tx, input.scope, input.operation, row);
    });
  }

  async change(scope: AiInspectionActorScope, draftId: string, operation: Operation,
    bindingFingerprint: string, data: Change, committed?: () => void): Promise<AiInspectionOperationResult> {
    const input = structuredClone({ scope, draftId, operation, bindingFingerprint, data });
    this.checkOperation(input.operation);
    if (input.operation.expectedRevision < 1) throw new InspectionAssistError('INVALID_INPUT');
    if (input.data.state !== undefined) this.checkState(input.data.state);
    return this.write(input.scope, input.operation, async (tx, lease) => {
      let lockedTarget: AiInspectionTarget | undefined;
      if (lease) {
        // Resolve the immutable order pointer under the parent fence, then lock
        // Order before the draft CAS. Never acquire Tenant after a draft lock.
        const original = await tx.aiInspectionDraft.findFirst({ where: { id: input.draftId, ...input.scope } });
        if (!original) throw new InspectionAssistError('ACCESS_DENIED');
        const linkage = input.data.status === 'submitted' && typeof input.data.inspectionId === 'string'
          && Object.keys(input.data).every(key => key === 'status' || key === 'inspectionId');
        lockedTarget = targetOf(original);
        await lease.lockTarget(lockedTarget, input.bindingFingerprint, linkage ? 'original_result' : 'mutation');
      }
      const claimed = await tx.aiInspectionDraft.updateMany({ where: { id: input.draftId, ...input.scope, ...lockedTarget,
        revision: input.operation.expectedRevision, bindingFingerprint: input.bindingFingerprint },
      data: { ...input.data, revision: { increment: 1 } } });
      if (claimed.count !== 1) throw new InspectionAssistError('REVISION_CONFLICT');
      const row = await tx.aiInspectionDraft.findFirstOrThrow({ where: { id: input.draftId, ...input.scope } });
      return this.record(tx, input.scope, input.operation, row);
    }, committed);
  }

  async claimSubmission(scope: AiInspectionActorScope, draftId: string, operation: Operation, bindingFingerprint: string) {
    let claimed = false;
    const result = await this.change(scope, draftId, operation, bindingFingerprint, { status: 'submission_unknown' }, () => { claimed = true; });
    return { result, claimed };
  }

  async read(scope: AiInspectionActorScope, draftId: string) {
    return this.db.aiInspectionDraft.findFirst({ where: { id: draftId, ...scope } });
  }

  async list(scope: AiInspectionActorScope, orderId: string, after: string | undefined, limit: number,
    target?: Pick<AiInspectionTarget, 'allocationId' | 'stage' | 'templateId'>) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new InspectionAssistError('INVALID_INPUT');
    return this.db.aiInspectionDraft.findMany({ where: { ...scope, orderId,
      ...(target ? { allocationId: target.allocationId, stage: target.stage, templateId: target.templateId } : {}),
      ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' }, take: limit,
      select: { id: true, revision: true, status: true, orderId: true, allocationId: true, assetId: true,
        stage: true, templateId: true, templateVersion: true, bindingFingerprint: true, updatedAt: true } });
  }

  async history(scope: AiInspectionActorScope, query: AiStaffInspectionHistoryRequest) {
    const rows = await this.db.aiInspectionDraft.findMany({ where: { ...scope, orderId: query.orderId, stage: query.stage,
      ...(query.after ? { id: { gt: query.after } } : {}) }, orderBy: { id: 'asc' }, take: query.limit + 1,
      select: { id: true, tenantId: true, workspaceId: true, ownerId: true, audience: true,
        orderId: true, allocationId: true, templateId: true, stage: true, revision: true, status: true } });
    const items: AiStaffInspectionHistoryItem[] = [];
    for (const row of rows.slice(0, query.limit)) {
      if (Object.entries(scope).some(([key, value]) => row[key as keyof typeof row] !== value)
        || row.orderId !== query.orderId || row.stage !== query.stage) throw new InspectionAssistError('ACCESS_DENIED');
      const operations = await this.db.aiInspectionOperation.findMany({ where: { ...scope, draftId: row.id }, orderBy: { id: 'asc' }, take: 21,
        select: { tenantId: true, workspaceId: true, ownerId: true, audience: true, draftId: true, operationId: true,
          fingerprint: true, expectedRevision: true, resultRevision: true, result: true } });
      const recognitionSaves: AiStaffInspectionHistoryItem['recognitionSaves'] = [];
      for (const operation of operations.slice(0, 20)) {
        if (operation.draftId !== row.id || Object.entries(scope).some(([key, value]) => operation[key as keyof typeof operation] !== value)) {
          throw new InspectionAssistError('ACCESS_DENIED');
        }
        const reference = this.decodeReceipt(operation, scope)?.recognitionSave?.reference;
        if (reference && reference.orderId === row.orderId && reference.allocationId === row.allocationId
          && reference.templateId === row.templateId && reference.stage === row.stage) recognitionSaves.push(structuredClone(reference));
      }
      items.push({ draftId: row.id, target: { orderId: row.orderId, allocationId: row.allocationId, templateId: row.templateId, stage: query.stage },
        revision: row.revision, status: receiptResult.shape.status.parse(row.status), recognitionSaves,
        recognitionSavesTruncated: operations.length > 20, recognitionReceipt: recognitionSaves.length ? 'references_available' : 'manual_reconcile' });
    }
    return { items, nextAfter: rows.length > query.limit ? items[items.length - 1].draftId : null };
  }

  async receipt(scope: AiInspectionActorScope, operationId: string, fingerprint: string,
    association?: RecognitionSaveAssociation): Promise<AiInspectionReceiptLookup> {
    try {
      const row = await this.db.aiInspectionOperation.findUnique({ where: { tenantId_workspaceId_operationId: {
        tenantId: scope.tenantId, workspaceId: scope.workspaceId, operationId } } });
      if (!row) return { status: 'absent' };
      if (row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || row.ownerId !== scope.ownerId || row.audience !== scope.audience) throw new InspectionAssistError('ACCESS_DENIED');
      if (row.fingerprint !== fingerprint) throw new InspectionAssistError('REVISION_CONFLICT');
      const result = this.decodeReceipt(row, scope);
      if (!result || association && (!result.recognitionSave
        || requestFingerprint(result.recognitionSave) !== requestFingerprint(association))) return { status: 'unavailable' };
      return { status: 'found', result: this.project(result) };
    } catch (error) {
      if (error instanceof InspectionAssistError) throw error;
      return { status: 'unavailable' };
    }
  }

  /** Original-key observation; no current attachment, candidate body or model
   * configuration is needed. Legacy/unverifiable records remain unavailable. */
  async recognitionReceipt(scope: AiInspectionActorScope, reference: RecognitionSaveReference): Promise<AiInspectionReceiptLookup> {
    try {
      const row = await this.db.aiInspectionOperation.findUnique({ where: { tenantId_workspaceId_operationId: {
        tenantId: scope.tenantId, workspaceId: scope.workspaceId, operationId: reference.operationId } } });
      if (!row) return { status: 'absent' };
      if (row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || row.ownerId !== scope.ownerId || row.audience !== scope.audience) throw new InspectionAssistError('ACCESS_DENIED');
      const decoded = this.decodeReceipt(row, scope);
      if (!decoded?.recognitionSave) return { status: 'unavailable' };
      if (requestFingerprint(decoded.recognitionSave.reference) !== requestFingerprint(reference)) throw new InspectionAssistError('BINDING_CHANGED');
      return { status: 'found', result: this.project(decoded) };
    } catch (error) {
      if (error instanceof InspectionAssistError) throw error;
      return { status: 'unavailable' };
    }
  }

  private project(result: z.infer<typeof storedReceiptResult>): AiInspectionOperationResult {
    return receiptResult.parse({ draftId: result.draftId, revision: result.revision,
      status: result.status, inspectionId: result.inspectionId });
  }

  private decodeReceipt(row: { result: unknown; draftId: string; resultRevision: number; expectedRevision: number;
    operationId: string; fingerprint: string }, scope: AiInspectionActorScope) {
    const parsed = storedReceiptResult.safeParse(row.result);
    if (!parsed.success || parsed.data.draftId !== row.draftId || parsed.data.revision !== row.resultRevision
      || row.resultRevision !== row.expectedRevision + 1) return null;
    const association = parsed.data.recognitionSave;
    if (Boolean(association) !== Boolean(parsed.data.recognitionSaveHash)) return null;
    if (association && (parsed.data.recognitionSaveHash !== requestFingerprint(association)
      || requestFingerprint(association.scope) !== requestFingerprint(scope)
      || association.reference.draftId !== row.draftId || association.reference.operationId !== row.operationId
      || association.reference.expectedRevision !== row.expectedRevision || association.commandHash !== row.fingerprint
      || parsed.data.status !== 'draft_saved' || parsed.data.inspectionId !== null)) return null;
    return parsed.data;
  }

  private async write(scope: AiInspectionActorScope, operation: Operation,
    apply: (tx: Prisma.TransactionClient, lease?: Awaited<ReturnType<InspectionDraftTransactionAuthority['begin']>>) => Promise<AiInspectionOperationResult>,
    committed?: () => void): Promise<AiInspectionOperationResult> {
    const existing = await this.receipt(scope, operation.operationId, operation.fingerprint, operation.recognitionSave);
    if (existing.status === 'found') return existing.result;
    if (existing.status === 'unavailable') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    try {
      if (hasRentalBusinessTenantFence() && !this.transactions) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      const result = await this.db.$transaction(async tx => {
        const lease = await this.transactions?.begin(tx, scope);
        const result = await apply(tx, lease);
        await lease?.revalidate();
        return result;
      });
      committed?.();
      return result;
    } catch (error) {
      const recovered = await this.receipt(scope, operation.operationId, operation.fingerprint, operation.recognitionSave);
      if (recovered.status === 'found') return recovered.result;
      if (recovered.status === 'unavailable') throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      if (error instanceof InspectionAssistError) throw error;
      if (error instanceof prismaRuntime.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        throw new InspectionAssistError('REVISION_CONFLICT');
      }
      throw new InspectionAssistError('RECONCILIATION_REQUIRED');
    }
  }

  private async record(tx: Prisma.TransactionClient, scope: AiInspectionActorScope, operation: Operation, row: AiInspectionDraft) {
    const result = receiptResult.parse({ draftId: row.id, revision: row.revision, status: row.status, inspectionId: row.inspectionId });
    const { recognitionSave, ...originalOperation } = operation;
    const stored = recognitionSave ? { ...result, recognitionSave, recognitionSaveHash: requestFingerprint(recognitionSave) } : result;
    if (!this.decodeReceipt({ ...originalOperation, result: stored, draftId: row.id, resultRevision: row.revision }, scope)) {
      throw new InspectionAssistError('BINDING_CHANGED');
    }
    await tx.aiInspectionOperation.create({ data: { ...scope, ...originalOperation, id: randomUUID(), draftId: row.id,
      resultRevision: row.revision, result: stored } });
    return result;
  }

  private checkOperation(operation: Operation) {
    if (operation.recognitionSave) operation.recognitionSave = recognitionSaveAssociationSchema.parse(operation.recognitionSave);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(operation.operationId) || !/^[a-f0-9]{64}$/u.test(operation.fingerprint)
      || !Number.isInteger(operation.expectedRevision) || operation.expectedRevision < 0 || operation.expectedRevision >= 1000) {
      throw new InspectionAssistError('INVALID_INPUT');
    }
  }

  private checkState(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 240000) throw new InspectionAssistError('INVALID_INPUT');
  }
}
