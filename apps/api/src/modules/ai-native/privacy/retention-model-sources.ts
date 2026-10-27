/** Read minimum source identifiers from the ORIGINAL hash-bound model input.
 * This neither reopens deleted bodies nor authorizes execution or result reads.
 * Unknown formats fail closed rather than treating an unparsed input as empty.
 */
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { AiTaskActionInput, Prisma } from '@prisma/client';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { parseTaskModelInput, taskModelFingerprint, TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL } from '../model-input/task-model-input';
import { readOriginalSceneEnvelope } from '../scenes/original-scene-knowledge';
import { humanKnowledgePreparedInputSchema } from '../knowledge/human-knowledge-input.service';
import { fingerprint } from '../knowledge/knowledge-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export const retentionModelTools: readonly string[] = Object.freeze([TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL]);
export function readRetentionModelSources(row: AiTaskActionInput, task: {
  id: string; scopeId: string; sceneCode: string; inputRef: string | null;
}, owner: { tenantId: string; workspaceId: string }) {
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
  const result = { documents: new Set<string>(), memories: new Set<string>(), attachments: new Set<string>() };
  if (input.media) {
    for (const item of input.media) result.attachments.add(item.attachmentId);
    // Media host material can contain arbitrary ordinary text. It does not
    // implement the original-scene knowledge envelope: never infer no sources.
    return { ...result, knowledgeComplete: false };
  }
  if (!['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(task.sceneCode)) throw unavailable();
  const envelope = readOriginalSceneEnvelope(input), snapshot = envelope.knowledge;
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
  return { ...result, knowledgeComplete: true };
}

/** Shared by scheduled-candidate and explicit original-delete consumers.
 * Only actual unresolved source references hold a body; unknown/truncated
 * bindings stay unavailable, never clear. Callers retain the canonical scope lock.
 */
export async function inspectRetentionSource(tx: Prisma.TransactionClient, scopeId: string,
  kind: 'knowledge' | 'memory' | 'attachment', resourceId: string,
  owner: { tenantId: string; workspaceId: string }): Promise<'clear' | 'held' | 'unavailable'> {
  const terminal = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
  const active = await tx.aiTask.findMany({ where: { scopeId, status: { notIn: [...terminal] } }, select: { id: true }, orderBy: { id: 'asc' }, take: 51 });
  const steps = await tx.aiStep.findMany({ where: { scopeId, status: { in: ['RUNNING', 'UNKNOWN'] } }, select: { taskId: true }, orderBy: { id: 'asc' }, take: 51 });
  const charges = await tx.aiTaskExecutionCharge.findMany({ where: { scopeId, status: { in: ['RESERVED', 'UNKNOWN'] } }, select: { taskId: true }, orderBy: { chargeId: 'asc' }, take: 51 });
  const reservations = await tx.aiBudgetReservation.findMany({ where: { scopeId, scopeKind: 'WORKSPACE', status: { in: ['reserved', 'pending_reconciliation'] } }, select: { runId: true }, orderBy: { id: 'asc' }, take: 51 });
  const admissions = await tx.aiInvocationAdmission.findMany({ where: { ...owner, status: { notIn: ['completed', 'cancelled', 'revoked'] } }, select: { callId: true }, orderBy: { id: 'asc' }, take: 51 });
  const legacy = await tx.aiUsageReservation.findMany({ where: { ...owner, status: { in: ['reserved', 'pending_reconciliation'] } }, select: { callId: true }, orderBy: { id: 'asc' }, take: 51 });
  if ([active, steps, charges, reservations, admissions, legacy].some(rows => rows.length > 50)) return 'unavailable';
  const tasks = new Set([...active.map(row => row.id), ...steps.map(row => row.taskId), ...charges.map(row => row.taskId)]);
  for (const row of reservations) {
    const run = await tx.aiRun.findFirst({ where: { id: row.runId, scopeId }, select: { taskId: true } });
    if (!run) return 'unavailable';
    tasks.add(run.taskId);
  }
  for (const callId of new Set([...admissions, ...legacy].map(row => row.callId))) {
    const invocation = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId, callId } }, select: { taskId: true } });
    if (!invocation) return 'unavailable';
    tasks.add(invocation.taskId);
  }
  if (tasks.size > 50) return 'unavailable';
  let attachmentDocument: string | null = null;
  if (kind === 'attachment') {
    const asset = await tx.fileAsset.findFirst({ where: { id: resourceId, tenantId: owner.tenantId,
      businessModule: 'ai-native', businessType: 'ai_knowledge_document', metadata: { path: '$.workspaceId', equals: owner.workspaceId } }, select: { businessId: true } });
    attachmentDocument = asset?.businessId ?? null;
  }
  for (const taskId of tasks) {
    const task = await tx.aiTask.findFirst({ where: { id: taskId, scopeId }, select: { id: true, scopeId: true, sceneCode: true, inputRef: true } });
    if (!task) return 'unavailable';
    const inputs = await tx.aiTaskActionInput.findMany({ where: { scopeId, taskId, toolCode: { in: [...retentionModelTools] } },
      orderBy: [{ runId: 'asc' }, { registrationRef: 'asc' }], take: 51 });
    if (inputs.length > 50) return 'unavailable';
    for (const input of inputs) {
      try {
        const refs = readRetentionModelSources(input, task, owner);
        if (kind === 'knowledge' && refs.documents.has(resourceId) || kind === 'memory' && refs.memories.has(resourceId)
          || kind === 'attachment' && (refs.attachments.has(resourceId) || attachmentDocument && refs.documents.has(attachmentDocument))) return 'held';
        if (!refs.knowledgeComplete) return 'unavailable';
      } catch { return 'unavailable'; }
    }
  }
  return 'clear';
}
