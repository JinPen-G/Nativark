/** Read minimum source identifiers from the ORIGINAL hash-bound model input.
 * This neither reopens deleted bodies nor authorizes execution or result reads.
 * Unknown formats fail closed rather than treating an unparsed input as empty.
 */
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { AiTaskActionInput } from '@prisma/client';
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
