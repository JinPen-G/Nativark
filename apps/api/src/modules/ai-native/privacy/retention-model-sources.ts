/** Read minimum source identifiers from the ORIGINAL hash-bound model input.
 * This neither reopens deleted bodies nor authorizes execution or result reads.
 * Unknown formats fail closed rather than treating an unparsed input as empty.
 */
import { AI_TOOL_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, validateAiSceneRequestReceiptDraft,
  type AiExecutionScope, type AiSceneCode } from '@rental-os/shared';
import { Prisma, type AiTaskActionInput } from '@prisma/client';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { parseTaskModelInput, taskModelFingerprint, TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL } from '../model-input/task-model-input';
import { readOriginalSceneEnvelope } from '../scenes/original-scene-knowledge';
import { humanKnowledgePreparedInputSchema } from '../knowledge/human-knowledge-input.service';
import { fingerprint } from '../knowledge/knowledge-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { AI_RETENTION_POLICY } from './retention-policy';

const retentionId = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export const retentionModelTools: readonly string[] = Object.freeze([TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL]);
type RetainedModelTask = { id: string; scopeId: string; sceneCode: string; sceneVersion: string;
  inputRef: string | null; inputRevision: number | null; inputHash: string | null };
export function readRetentionModelSources(row: AiTaskActionInput, task: RetainedModelTask,
  owner: { tenantId: string; workspaceId: string }) {
  if (row.taskId !== task.id || row.scopeId !== task.scopeId || row.toolVersion !== AI_TOOL_DRAFT_VERSION
    || !retentionModelTools.includes(row.toolCode) || !row.payload || typeof row.payload !== 'object'
    || Array.isArray(row.payload)) throw unavailable();
  const raw = row.payload, intent = raw.intent;
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) throw unavailable();
  const features = intent.requiredFeatures;
  if (!Array.isArray(features)) throw unavailable();
  const policy = { sceneCode: task.sceneCode, maxOutputTokens: 32768,
    ...(row.toolCode === TASK_IMAGE_MODEL_TOOL ? { kind: 'image' as const }
      : row.toolCode === TASK_AUDIO_MODEL_TOOL ? { kind: 'audio' as const }
      : features.includes('tools') ? { orderExplainTool: true }
      : features.includes('structured_output') ? { structuredOutput: true,
        structuredSchemaHash: typeof raw.structuredSchemaHash === 'string' ? raw.structuredSchemaHash : undefined } : {}) };
  const input = parseTaskModelInput(raw, policy);
  if (taskModelFingerprint(input, policy) !== row.fingerprint) throw unavailable();
  if (!('tenantId' in input.configuration) || input.configuration.tenantId !== owner.tenantId) throw unavailable();
  const result = { documents: new Set<string>(), memories: new Set<string>(), attachments: new Set<string>() };
  if (input.media) {
    for (const item of input.media) result.attachments.add(item.attachmentId);
    // Media host material can contain arbitrary ordinary text. It does not
    // implement the original-scene knowledge envelope: never infer no sources.
    return { ...result, knowledgeComplete: false };
  }
  if (!['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(task.sceneCode)) throw unavailable();
  const envelope = readOriginalSceneEnvelope(input), snapshot = envelope.knowledge;
  // A valid outer intent cannot certify an incomplete or replaced source
  // packet. The original input reference and facts digest remain immutable.
  const original = envelope.original;
  if (!original || typeof original !== 'object' || Array.isArray(original) || !('requestKey' in original)
    || typeof original.requestKey !== 'string' || !task.inputRef
    || !validateAiSceneRequestReceiptDraft(original, { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: task.inputRef },
      { capabilityCode: task.sceneCode as AiSceneCode, capabilityVersion: task.sceneVersion, originalRequestKey: original.requestKey })
    || original.revision !== task.inputRevision || original.contentHash !== task.inputHash
    || requestFingerprint(envelope.facts) !== envelope.materialHash) throw unavailable();
  if (envelope.conversationHistory) {
    const { contentHash, ...history } = envelope.conversationHistory;
    if (requestFingerprint(history) !== contentHash || history.original.inputRef !== task.inputRef
      || history.scope.tenantId !== owner.tenantId || history.scope.workspaceId !== owner.workspaceId) throw unavailable();
  }
  if (!snapshot) return { ...result, knowledgeComplete: true };
  if (snapshot.originalInputRef !== task.inputRef || requestFingerprint(snapshot.material) !== snapshot.contentHash
    || Buffer.byteLength(JSON.stringify(snapshot.material), 'utf8') > 16384) throw unavailable();
  const material = humanKnowledgePreparedInputSchema.parse(snapshot.material);
  for (const entry of material.sources) {
    const scope = entry.source.scope;
    if (scope.kind !== 'workspace' || scope.tenantId !== owner.tenantId || scope.workspaceId !== owner.workspaceId
      || fingerprint(entry.source) !== entry.sourceId || fingerprint(entry.snippet) !== entry.snippetFingerprint) throw unavailable();
    result.documents.add(entry.source.documentId);
  }
  if (material.preferences.status === 'ready') for (const item of material.preferences.items) result.memories.add(item.memoryId);
  return { ...result, knowledgeComplete: material.status === 'ready' && !material.sources.some(entry => entry.truncated)
    && (material.preferences.status !== 'ready' || !material.preferences.truncated) };
}

/** Same canonical scope lock used by scheduled cleanup. The source check and
 * original mutation must remain in this transaction; a prior read is no grant. */
export async function lockRetentionSourceScope(tx: Prisma.TransactionClient,
  scope: AiExecutionScope): Promise<{ scopeId: string; owner: { tenantId: string; workspaceId: string } }> {
  if (scope.kind !== 'workspace') throw unavailable();
  const owner = { tenantId: scope.tenantId, workspaceId: scope.workspaceId };
  const row = await tx.aiScope.findFirst({ where: aiPersistenceScopeColumns(scope) });
  if (!row || !retentionId(row.id) || row.kind !== 'WORKSPACE'
    || row.tenantId !== owner.tenantId || row.workspaceId !== owner.workspaceId) throw unavailable();
  const locks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ai_scopes
    WHERE id = ${row.id} AND kind = 'workspace' AND tenantId = ${owner.tenantId}
    AND workspaceId = ${owner.workspaceId} FOR UPDATE`);
  if (!Array.isArray(locks) || locks.length !== 1 || locks[0].id !== row.id) throw unavailable();
  return { scopeId: row.id, owner };
}

export type RetentionSourceCopy = Readonly<{ scopeId: string; taskId: string; runId: string;
  inputId: string; inputHash: string }>;

/** Bounded original-copy discovery, not erasure or permission to archive a
 * Task. Explicit source deletion must keep its receipt pending until its
 * original copy consumer has completed; a terminal task is not zero copies. */
export async function retentionSourceCopies(tx: Prisma.TransactionClient, scopeId: string,
  kind: 'knowledge' | 'memory', resourceId: string,
  owner: { tenantId: string; workspaceId: string }): Promise<readonly RetentionSourceCopy[]> {
  if (![scopeId, resourceId, owner.tenantId, owner.workspaceId].every(retentionId)) throw unavailable();
  const rows = await tx.aiTaskActionInput.findMany({ where: { scopeId, toolCode: { in: [...retentionModelTools] } },
    orderBy: [{ taskId: 'asc' }, { runId: 'asc' }, { registrationRef: 'asc' }], take: 51 });
  if (!Array.isArray(rows) || rows.length > 50) throw unavailable();
  const copies: RetentionSourceCopy[] = [];
  for (const input of rows) {
    if (!retentionId(input.taskId) || !retentionId(input.id) || !retentionId(input.runId) || input.scopeId !== scopeId) throw unavailable();
    const task = await tx.aiTask.findFirst({ where: { id: input.taskId, scopeId },
      select: { id: true, scopeId: true, sceneCode: true, sceneVersion: true, inputRef: true,
        inputRevision: true, inputHash: true, createdAt: true } });
    if (!task || task.id !== input.taskId || task.scopeId !== scopeId) throw unavailable();
    const mark = input.payload;
    if (mark && typeof mark === 'object' && !Array.isArray(mark) && mark.retention === 'erased') {
      // Only the existing same-task tombstone proves an intentionally erased
      // input. A caller marker or another source's receipt cannot hide a copy.
      const key = fingerprint([AI_RETENTION_POLICY.version, owner.tenantId, owner.workspaceId, 'task', input.taskId]);
      const receipt = await tx.aiDataErasure.findFirst({ where: { id: key, ...owner, kind: 'task', resourceId: input.taskId,
        policyVersion: AI_RETENTION_POLICY.version, state: 'erased' } });
      if (Object.keys(mark).length !== 3 || !receipt || receipt.id !== key || receipt.tenantId !== owner.tenantId || receipt.workspaceId !== owner.workspaceId
        || receipt.kind !== 'task' || receipt.resourceId !== task.id || receipt.state !== 'erased'
        || receipt.policyVersion !== AI_RETENTION_POLICY.version || !(task.createdAt instanceof Date)
        || !Number.isFinite(task.createdAt.getTime()) || receipt.targetHash !== fingerprint([
          'task', task.id, task.inputRef, task.inputHash, task.createdAt.toISOString()])
        || mark.receiptId !== key || mark.policyVersion !== AI_RETENTION_POLICY.version) throw unavailable();
      continue;
    }
    const refs = readRetentionModelSources(input, task, owner);
    if (!refs.knowledgeComplete) throw unavailable();
    if (kind === 'knowledge' ? refs.documents.has(resourceId) : refs.memories.has(resourceId)) {
      copies.push(Object.freeze({ scopeId, taskId: input.taskId, runId: input.runId, inputId: input.id, inputHash: input.fingerprint }));
    }
  }
  return Object.freeze(copies);
}

/** Shared by scheduled-candidate and explicit original-delete consumers.
 * Only actual unresolved source references hold a body; unknown/truncated
 * bindings stay unavailable, never clear. Callers retain the canonical scope lock.
 */
export async function inspectRetentionSource(tx: Prisma.TransactionClient, scopeId: string,
  kind: 'knowledge' | 'memory' | 'attachment', resourceId: string,
  owner: { tenantId: string; workspaceId: string }): Promise<'clear' | 'held' | 'unavailable'> {
  try {
    if (!['knowledge', 'memory', 'attachment'].includes(kind)
      || ![scopeId, resourceId, owner.tenantId, owner.workspaceId].every(retentionId)) return 'unavailable';
    const terminal = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
    const active = await tx.aiTask.findMany({ where: { scopeId, status: { notIn: [...terminal] } }, select: { id: true }, orderBy: { id: 'asc' }, take: 51 });
    const steps = await tx.aiStep.findMany({ where: { scopeId, OR: [
      { status: { in: ['RUNNING', 'UNKNOWN'] } }, { effect: 'POSSIBLE' }
    ] }, select: { taskId: true }, orderBy: { id: 'asc' }, take: 51 });
    const approvals = await tx.aiApprovalConsumption.findMany({ where: { scopeId, status: { in: ['RESERVED', 'UNKNOWN'] } },
      select: { taskId: true }, orderBy: { actionId: 'asc' }, take: 51 });
    const charges = await tx.aiTaskExecutionCharge.findMany({ where: { scopeId, status: { in: ['RESERVED', 'UNKNOWN'] } }, select: { taskId: true }, orderBy: { chargeId: 'asc' }, take: 51 });
    const reservations = await tx.aiBudgetReservation.findMany({ where: { scopeId, scopeKind: 'WORKSPACE', status: { in: ['reserved', 'pending_reconciliation'] } }, select: { runId: true }, orderBy: { id: 'asc' }, take: 51 });
    const admissions = await tx.aiInvocationAdmission.findMany({ where: { ...owner, status: { notIn: ['completed', 'cancelled', 'revoked'] } }, select: { callId: true }, orderBy: { id: 'asc' }, take: 51 });
    // Legacy workspace usage persists `unknown`; do not lose its material hold
    // by using only the budget ledger's different reconciliation vocabulary.
    const legacy = await tx.aiUsageReservation.findMany({ where: { ...owner, status: { in: ['reserved', 'unknown', 'pending_reconciliation'] } }, select: { callId: true }, orderBy: { id: 'asc' }, take: 51 });
    if ([active, steps, approvals, charges, reservations, admissions, legacy].some(rows => !Array.isArray(rows) || rows.length > 50)) return 'unavailable';
    const tasks = new Set([...active.map(row => row.id), ...steps.map(row => row.taskId),
      ...approvals.map(row => row.taskId), ...charges.map(row => row.taskId)]);
    for (const row of reservations) {
      if (!retentionId(row.runId)) return 'unavailable';
      const run = await tx.aiRun.findFirst({ where: { id: row.runId, scopeId }, select: { id: true, scopeId: true, taskId: true } });
      if (!run || run.id !== row.runId || run.scopeId !== scopeId) return 'unavailable';
      tasks.add(run.taskId);
    }
    for (const callId of new Set([...admissions, ...legacy].map(row => row.callId))) {
      if (!retentionId(callId)) return 'unavailable';
      const invocation = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId, callId } },
        select: { scopeId: true, callId: true, taskId: true } });
      if (!invocation || invocation.scopeId !== scopeId || invocation.callId !== callId) return 'unavailable';
      tasks.add(invocation.taskId);
    }
    if (tasks.size > 50 || [...tasks].some(id => !retentionId(id))) return 'unavailable';
    let attachmentDocument: string | null = null;
    if (kind === 'attachment') {
      const asset = await tx.fileAsset.findFirst({ where: { id: resourceId, tenantId: owner.tenantId,
        businessModule: 'ai-native', businessType: 'ai_knowledge_document', metadata: { path: '$.workspaceId', equals: owner.workspaceId } }, select: { businessId: true } });
      attachmentDocument = asset?.businessId ?? null;
    }
    let held = false;
    for (const taskId of tasks) {
      const task = await tx.aiTask.findFirst({ where: { id: taskId, scopeId }, select: { id: true, scopeId: true,
        sceneCode: true, sceneVersion: true, inputRef: true, inputRevision: true, inputHash: true } });
      if (!task || task.id !== taskId || task.scopeId !== scopeId) return 'unavailable';
      const inputs = await tx.aiTaskActionInput.findMany({ where: { scopeId, taskId, toolCode: { in: [...retentionModelTools] } },
        orderBy: [{ runId: 'asc' }, { registrationRef: 'asc' }], take: 51 });
      if (!Array.isArray(inputs) || !inputs.length || inputs.length > 50) return 'unavailable';
      for (const input of inputs) {
        const refs = readRetentionModelSources(input, task, owner);
        if (!refs.knowledgeComplete) return 'unavailable';
        if (kind === 'knowledge' && refs.documents.has(resourceId) || kind === 'memory' && refs.memories.has(resourceId)
          || kind === 'attachment' && (refs.attachments.has(resourceId) || attachmentDocument && refs.documents.has(attachmentDocument))) held = true;
      }
    }
    return held ? 'held' : 'clear';
  } catch { return 'unavailable'; }
}
