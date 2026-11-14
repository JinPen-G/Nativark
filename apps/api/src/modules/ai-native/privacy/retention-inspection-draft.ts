/** 原 workspace 维护事务内清理到期员工草稿的普通 AI 正文。
 * 仅原输入/候选保存收据的有界关联参与 hold；人工字段、业务附件、提交材料、
 * 检查和操作收据不删除。读取兼容必须核同一原 tombstone，不由空候选推定删除。 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Prisma, type PrismaClient, type AiInspectionDraft } from '@prisma/client';
import { z } from 'zod';
import { AI_INSPECTION_MANUAL_HTTP_SCHEMAS, AI_INSPECTION_DRAFT_SCHEMAS,
  type AiInspectionDraftState } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { fingerprint } from '../knowledge/knowledge-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { recognitionSaveAssociationSchema } from '../inspection-assist/inspection-recognition-save.association';
import { aiTaskHasUnresolvedEffects } from '../task-unresolved-effects';
import { AI_RETENTION_POLICY } from './retention-policy';
import { lockRetentionSourceScope } from './retention-model-sources';
import { eraseWorkspaceSourceTaskBodies } from './retention-task-bodies';

export const INSPECTION_DRAFT_RETENTION_KIND = 'inspection_draft' as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
export const inspectionDraftBodyErasureSchema = z.object({
  version: z.literal('inspection-draft-body-erasure-1'), retention: z.literal('erased'),
  receiptId: hash, policyVersion: z.literal(AI_RETENTION_POLICY.version),
  erasedRevision: z.number().int().min(2).max(1000),
  candidateRefs: z.array(z.object({ candidateId: id, fieldCode: id }).strict()).max(100),
  inputRefs: z.array(z.object({ inputId: id, inputFingerprint: hash }).strict()).max(8),
}).strict();
export type InspectionDraftBodyErasure = z.infer<typeof inspectionDraftBodyErasureSchema>;
export interface InspectionDraftBodyRetentionReader {
  readErasure(row: AiInspectionDraft): Promise<InspectionDraftBodyErasure | null>;
}

// Validate the existing formal stored projection; do not introduce a second
// permissive draft DTO. The private deletion mark is validated separately.
const ajv = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(ajv);
for (const [name, schema] of Object.entries({ ...AI_INSPECTION_MANUAL_HTTP_SCHEMAS,
  ...Object.fromEntries(['AiInspectionCandidateDraft', 'AiInspectionSourceDraft', 'AiInspectionValueDraft']
    .map(name => [name, AI_INSPECTION_DRAFT_SCHEMAS[name]])) })) {
  ajv.addSchema(schema, `#/components/schemas/${name}`);
}
const stateValidator = ajv.compile<AiInspectionDraftState>(AI_INSPECTION_MANUAL_HTTP_SCHEMAS.AiInspectionDraftReadResponse.properties!.state);
function stateOf(value: unknown): { state: AiInspectionDraftState; erasure?: InspectionDraftBodyErasure } {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Buffer.byteLength(JSON.stringify(value), 'utf8') > 240000) throw unavailable();
  const { bodyErasure, ...state } = value as Record<string, unknown>;
  if (!stateValidator(state)) throw unavailable();
  if (bodyErasure === undefined) return { state };
  const parsed = inspectionDraftBodyErasureSchema.safeParse(bodyErasure);
  if (!parsed.success || state.candidates.length || state.recognitionInputs !== undefined
    || !state.reviewRequired || new Set(parsed.data.candidateRefs.map(ref => ref.candidateId)).size !== parsed.data.candidateRefs.length
    || new Set(parsed.data.inputRefs.map(ref => ref.inputId)).size !== parsed.data.inputRefs.length
    || Object.entries(state.fields).some(([fieldCode, field]) => field.candidateId
      && !parsed.data.candidateRefs.some(ref => ref.candidateId === field.candidateId && ref.fieldCode === fieldCode))) throw unavailable();
  return { state, erasure: parsed.data };
}

/** Immutable scoped identity survives a restored body and later metadata reads.
 * Neither mutable status/revision nor a caller-supplied marker identifies it. */
export function inspectionDraftRetentionTargetHash(row: AiInspectionDraft) {
  if (![row.id, row.tenantId, row.workspaceId, row.ownerId, row.orderId, row.allocationId,
    row.assetId, row.templateId].every(value => id.safeParse(value).success)
    || !['operator', 'staff'].includes(row.audience) || !['pickup', 'return'].includes(row.stage)
    || !id.safeParse(row.templateVersion).success || !hash.safeParse(row.bindingFingerprint).success
    || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())) throw unavailable();
  return fingerprint([INSPECTION_DRAFT_RETENTION_KIND, row.id, row.tenantId, row.workspaceId,
    row.ownerId, row.audience, row.orderId, row.allocationId, row.assetId, row.stage,
    row.templateId, row.templateVersion, row.bindingFingerprint, row.createdAt.toISOString()]);
}
function receiptKey(row: Pick<AiInspectionDraft, 'id' | 'tenantId' | 'workspaceId'>) {
  return fingerprint([AI_RETENTION_POLICY.version, row.tenantId, row.workspaceId, INSPECTION_DRAFT_RETENTION_KIND, row.id]);
}
function sameReceipt(receipt: NonNullable<Awaited<ReturnType<PrismaClient['aiDataErasure']['findUnique']>>>,
  row: AiInspectionDraft, targetHash: string) {
  return receipt.id === receiptKey(row) && receipt.tenantId === row.tenantId && receipt.workspaceId === row.workspaceId
    && receipt.kind === INSPECTION_DRAFT_RETENTION_KIND && receipt.resourceId === row.id
    && receipt.policyVersion === AI_RETENTION_POLICY.version && receipt.targetHash === targetHash
    && Number.isInteger(receipt.revision) && receipt.revision > 0 && receipt.revision <= 4294967295;
}

export function createInspectionDraftBodyRetentionReader(db: Pick<PrismaClient, 'aiDataErasure'>): InspectionDraftBodyRetentionReader {
  return { async readErasure(row) {
    const { erasure } = stateOf(row.state);
    if (!erasure) return null;
    const targetHash = inspectionDraftRetentionTargetHash(row), receipt = await db.aiDataErasure.findUnique({ where: { id: receiptKey(row) } });
    if (!receipt || !sameReceipt(receipt, row, targetHash) || receipt.state !== 'erased'
      || !(receipt.erasedAt instanceof Date) || !Number.isFinite(receipt.erasedAt.getTime())
      || erasure.receiptId !== receipt.id || !Number.isInteger(row.revision) || row.revision < erasure.erasedRevision) throw unavailable();
    return structuredClone(erasure);
  } };
}

const operationResult = z.object({ draftId: id, revision: z.number().int().positive(),
  status: z.enum(['draft_saved', 'prepared', 'submission_unknown', 'submitted']), inspectionId: id.nullable(),
  recognitionSave: recognitionSaveAssociationSchema.optional(), recognitionSaveHash: hash.optional() }).strict();
type RetentionInput = { scopeId: string; owner: { tenantId: string; workspaceId: string };
  draftId: string; now: Date; check(): Promise<void> };
type Hold = { state: 'held'; reason: 'unresolved_effects' | 'referenced_by_unresolved_task' | 'association_limit' }
  | { state: 'unavailable'; reason: 'source_task_binding_unavailable' };
type Related = Hold | { state: 'clear'; taskIds: string[] };

async function relatedEffects(tx: Prisma.TransactionClient, row: AiInspectionDraft, state: AiInspectionDraftState,
  input: RetentionInput, erasure?: InspectionDraftBodyErasure): Promise<Related> {
  if (row.status === 'submission_unknown') return { state: 'held', reason: 'unresolved_effects' };
  const operations = await tx.aiInspectionOperation.findMany({ where: { tenantId: row.tenantId,
    workspaceId: row.workspaceId, draftId: row.id }, orderBy: { id: 'asc' }, take: 1001 });
  if (operations.length > 1000) return { state: 'held', reason: 'association_limit' };
  const inputIds = new Set<string>(erasure?.inputRefs.map(ref => ref.inputId)), savedTasks = new Map<string, string>();
  for (const original of state.recognitionInputs ?? []) {
    const { inputFingerprint, ...payload } = original;
    if (inputFingerprint !== requestFingerprint(payload) || inputIds.has(original.inputId)) return { state: 'unavailable', reason: 'source_task_binding_unavailable' };
    inputIds.add(original.inputId);
  }
  for (const operation of operations) {
    const decoded = operationResult.safeParse(operation.result);
    if (!decoded.success || operation.tenantId !== row.tenantId || operation.workspaceId !== row.workspaceId
      || operation.draftId !== row.id || operation.ownerId !== row.ownerId || operation.audience !== row.audience
      || decoded.data.draftId !== row.id || decoded.data.revision !== operation.resultRevision
      || operation.resultRevision !== operation.expectedRevision + 1 || operation.resultRevision > row.revision
      || Boolean(decoded.data.recognitionSave) !== Boolean(decoded.data.recognitionSaveHash)) return { state: 'unavailable', reason: 'source_task_binding_unavailable' };
    // replaceEvidence removes the current frozen inputs. Their original
    // preparation operations still derive the SAME server input identifier;
    // manual operations merely have no Task at that identifier.
    inputIds.add(`inspection.input:${requestFingerprint({ scope: { tenantId: row.tenantId,
      workspaceId: row.workspaceId, ownerId: row.ownerId, audience: row.audience }, operationId: operation.operationId })}`);
    const saved = decoded.data.recognitionSave;
    if (!saved) continue;
    if (decoded.data.recognitionSaveHash !== requestFingerprint(saved) || saved.reference.draftId !== row.id
      || saved.reference.operationId !== operation.operationId || saved.reference.expectedRevision !== operation.expectedRevision
      || saved.reference.orderId !== row.orderId || saved.reference.allocationId !== row.allocationId
      || saved.reference.templateId !== row.templateId || saved.reference.stage !== row.stage
      || saved.scope.tenantId !== row.tenantId || saved.scope.workspaceId !== row.workspaceId
      || saved.scope.ownerId !== row.ownerId || saved.scope.audience !== row.audience || saved.commandHash !== operation.fingerprint
      || savedTasks.has(saved.reference.taskId) && savedTasks.get(saved.reference.taskId) !== saved.reference.inputId) {
      return { state: 'unavailable', reason: 'source_task_binding_unavailable' };
    }
    inputIds.add(saved.reference.inputId); savedTasks.set(saved.reference.taskId, saved.reference.inputId);
  }
  if (!inputIds.size && !savedTasks.size) return { state: 'clear', taskIds: [] };
  if (inputIds.size > 1008 || savedTasks.size > 50) return { state: 'held', reason: 'association_limit' };
  const tasks = await tx.aiTask.findMany({ where: { scopeId: input.scopeId, OR: [
    { inputRef: { in: [...inputIds] } }, { id: { in: [...savedTasks.keys()] } }
  ] }, orderBy: { id: 'asc' }, take: 51 });
  if (tasks.length > 50) return { state: 'held', reason: 'association_limit' };
  if ([...savedTasks.keys()].some(taskId => !tasks.some(task => task.id === taskId))) return { state: 'unavailable', reason: 'source_task_binding_unavailable' };
  for (const task of tasks) {
    const creationKey = `inspection:${requestFingerprint({ scope: { kind: 'workspace', ...input.owner },
      actor: { kind: 'user', userId: row.ownerId }, audience: row.audience, draftId: row.id, inputId: task.inputRef })}`;
    if (task.scopeId !== input.scopeId || !task.inputRef || !inputIds.has(task.inputRef)
      || task.scopeKind !== 'WORKSPACE' || task.creationKey !== creationKey
      || task.ownerKind !== 'USER' || task.ownerId !== row.ownerId || task.audience !== row.audience.toUpperCase()
      || savedTasks.has(task.id) && savedTasks.get(task.id) !== task.inputRef) return { state: 'unavailable', reason: 'source_task_binding_unavailable' };
    if (await aiTaskHasUnresolvedEffects(tx, input.scopeId, task.id, input.owner)) return { state: 'held', reason: 'referenced_by_unresolved_task' };
  }
  return { state: 'clear', taskIds: tasks.map(task => task.id) };
}

/** Caller supplies the original full-workspace management check and tx/codec.
 * expectedHash is ONLY supplied by the existing verified restore host. Importing
 * this leaf does not schedule work or authorize maintenance. */
export async function eraseExpiredInspectionDraftBodies(tx: Prisma.TransactionClient, input: RetentionInput, expectedHash?: string) {
  if (![input.scopeId, input.owner.tenantId, input.owner.workspaceId, input.draftId].every(value => id.safeParse(value).success)
    || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime()) || expectedHash !== undefined && !hash.safeParse(expectedHash).success) throw unavailable();
  await input.check();
  const locked = await lockRetentionSourceScope(tx, { kind: 'workspace', ...input.owner });
  if (locked.scopeId !== input.scopeId) throw denied();
  const draftLocks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ai_inspection_drafts
    WHERE id = ${input.draftId} AND tenantId = ${input.owner.tenantId} AND workspaceId = ${input.owner.workspaceId} FOR UPDATE`);
  if (draftLocks.length !== 1 || draftLocks[0].id !== input.draftId) throw unavailable();
  const row = await tx.aiInspectionDraft.findFirst({ where: { id: input.draftId, ...input.owner } });
  if (!row || row.tenantId !== input.owner.tenantId || row.workspaceId !== input.owner.workspaceId
    || !['draft_saved', 'prepared', 'submission_unknown', 'submitted'].includes(row.status)
    || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 1000) throw unavailable();
  const targetHash = inspectionDraftRetentionTargetHash(row), key = receiptKey(row);
  const receipt = await tx.aiDataErasure.findUnique({ where: { id: key } });
  if (expectedHash && expectedHash !== targetHash || receipt && !sameReceipt(receipt, row, targetHash)) throw denied();
  const { state, erasure } = stateOf(row.state);
  if (erasure) {
    if (!expectedHash) await createInspectionDraftBodyRetentionReader(tx).readErasure(row);
    else {
      // A trusted restore can reintroduce Task copies even when this head is
      // already marked, while its local deletion journal may be absent/stale.
      // Only the verified external target hash can reconstruct that receipt;
      // ordinary reads still require the original strict journal above.
      if (erasure.receiptId !== key || row.revision < erasure.erasedRevision) throw denied();
      const related = await relatedEffects(tx, row, state, input, erasure);
      await input.check();
      if (related.state !== 'clear') return { id: key, ...related };
      for (const taskId of related.taskIds) await eraseWorkspaceSourceTaskBodies(tx, {
        scopeId: input.scopeId, owner: input.owner, taskId, now: input.now, check: input.check });
      await input.check();
      if (!receipt) await tx.aiDataErasure.create({ data: { id: key, ...input.owner,
        kind: INSPECTION_DRAFT_RETENTION_KIND, resourceId: row.id, targetHash,
        policyVersion: AI_RETENTION_POLICY.version, state: 'erased', erasedAt: input.now } });
      else if (receipt.state !== 'erased' || !(receipt.erasedAt instanceof Date) || !Number.isFinite(receipt.erasedAt.getTime())) {
        if (receipt.revision >= 4294967295) throw unavailable();
        const changedReceipt = await tx.aiDataErasure.updateMany({ where: { id: key, ...input.owner,
          revision: receipt.revision, state: receipt.state }, data: { state: 'erased', erasedAt: input.now,
          revision: { increment: 1 } } });
        if (changedReceipt.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      }
      const current = await tx.aiInspectionDraft.findFirst({ where: { id: row.id, ...input.owner,
        ownerId: row.ownerId, audience: row.audience, revision: row.revision } });
      if (!current || requestFingerprint(current.state) !== requestFingerprint(row.state)) throw unavailable();
      await createInspectionDraftBodyRetentionReader(tx).readErasure(current);
    }
    await input.check();
    return { id: key, state: 'erased' as const, replayed: true };
  }
  // An erased ledger paired with an undeleted snapshot requires the trusted
  // restore path; it must never be called an already-clean ordinary replay.
  if (receipt?.state === 'erased' && !expectedHash) throw unavailable();
  if (!(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())
    || !expectedHash && (row.expiresAt > input.now
      || row.createdAt.getTime() > input.now.getTime() - AI_RETENTION_POLICY.conversationDays * 86400000)) throw unavailable();
  const related = await relatedEffects(tx, row, state, input);
  await input.check();
  if (related.state !== 'clear') return { id: key, ...related };
  // Revision 1000 already closes all ordinary draft writes. Its expiry still
  // needs deletion: keep that public ceiling and CAS the body under the row
  // lock; reads compare the full stored state and the new verified mark.
  const erasedRevision = Math.min(row.revision + 1, 1000);
  const bodyErasure: InspectionDraftBodyErasure = { version: 'inspection-draft-body-erasure-1', retention: 'erased',
    receiptId: key, policyVersion: AI_RETENTION_POLICY.version, erasedRevision,
    candidateRefs: state.candidates.map(candidate => ({ candidateId: candidate.candidateId, fieldCode: candidate.fieldCode })),
    inputRefs: (state.recognitionInputs ?? []).map(original => ({ inputId: original.inputId, inputFingerprint: original.inputFingerprint })) };
  const { recognitionInputs: _ordinaryInputs, candidates: _ordinaryCandidates, ...retained } = state;
  const nextState = { ...retained, candidates: [], reviewRequired: true, bodyErasure };
  stateOf(nextState);
  const changed = await tx.aiInspectionDraft.updateMany({ where: { id: row.id, ...input.owner,
    ownerId: row.ownerId, audience: row.audience, revision: row.revision, status: row.status,
    bindingFingerprint: row.bindingFingerprint }, data: { state: nextState as Prisma.InputJsonValue,
      revision: { increment: erasedRevision - row.revision } } });
  if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  // The same original tx/codec removes copied model inputs, artifacts and
  // historical text. Any hold/write failure rolls the draft and ALL copies back.
  for (const taskId of related.taskIds) {
    const erased = await eraseWorkspaceSourceTaskBodies(tx, { scopeId: input.scopeId,
      owner: input.owner, taskId, now: input.now, check: input.check });
    if (erased.state !== 'erased' || erased.id !== fingerprint([AI_RETENTION_POLICY.version,
      input.owner.tenantId, input.owner.workspaceId, 'task', taskId])) throw unavailable();
  }
  if (!receipt) await tx.aiDataErasure.create({ data: { id: key, ...input.owner, kind: INSPECTION_DRAFT_RETENTION_KIND,
    resourceId: row.id, targetHash, policyVersion: AI_RETENTION_POLICY.version, state: 'erased', erasedAt: input.now } });
  else {
    if (receipt.revision >= 4294967295) throw unavailable();
    const result = await tx.aiDataErasure.updateMany({ where: { id: key, ...input.owner, revision: receipt.revision },
      data: { state: 'erased', erasedAt: input.now, revision: { increment: 1 } } });
    if (result.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  }
  const current = await tx.aiInspectionDraft.findFirst({ where: { id: row.id, ...input.owner } });
  if (!current || current.revision !== bodyErasure.erasedRevision) throw unavailable();
  await createInspectionDraftBodyRetentionReader(tx).readErasure(current);
  await input.check();
  return { id: key, state: 'erased' as const, replayed: Boolean(receipt) };
}
