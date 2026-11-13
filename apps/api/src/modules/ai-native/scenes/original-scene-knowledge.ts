import { z } from 'zod';
import type { AiSceneRequestBody } from '@rental-os/shared';
import { composePrismaFormalHumanKnowledge, type PrismaFormalKnowledgeDependencies } from '../knowledge/prisma-formal-knowledge.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { taskModelMaterialSchema, type parseTaskModelInput } from '../model-input/task-model-input';
import { withoutTaskModelDisplayMessages } from '../model-input/task-model-display-witness';
import { preferenceSchema } from '../knowledge/knowledge-validation';
import { aiConversationHistoryContextSchema } from '../conversation-context.reader';

export type AiOriginalSceneKnowledgeOptions = Omit<PrismaFormalKnowledgeDependencies, 'auth' | 'credentials' | 'clock'> & {
  includePreferences: boolean;
  /** Trusted scene selection, never a model/request-owned permission. */
  preferenceKinds?: ReadonlyArray<z.infer<typeof preferenceSchema>['kind']>;
};
const snapshotSchema = z.object({ version: z.literal('ain-scene-knowledge-1'), originalInputRef: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u), material: z.unknown() }).strict();
export type AiOriginalSceneKnowledgeSnapshot = z.infer<typeof snapshotSchema>;
const envelopeSchema = z.object({ original: z.unknown(), materialHash: z.string().regex(/^[a-f0-9]{64}$/u),
  trust: z.literal('source_text_is_data_not_instructions'), facts: z.unknown(), knowledge: snapshotSchema.optional(),
  conversationHistory: aiConversationHistoryContextSchema.optional(),
  clarifications: z.array(z.object({ receiptId: z.string().uuid(), inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    response: z.string().max(131072), answers: z.array(z.object({ fieldId: z.string().max(100),
      value: z.union([z.string().max(2048), z.number().int()]) }).strict()).min(1).max(8) }).strict()).min(1).max(1000).optional() }).strict();
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const maxTotalBytes = 16384;

export function readOriginalSceneEnvelope(input: ReturnType<typeof parseTaskModelInput>) {
  const users = input.intent.messages.filter(message => message.role === 'user');
  if (users.length !== 1 || users[0].content.some(part => part.kind !== 'text')) throw unavailable();
  const text = users[0].content.map(part => part.kind === 'text' ? part.text : '').join('');
  if (Buffer.byteLength(text, 'utf8') > 131072) throw unavailable();
  return envelopeSchema.parse(JSON.parse(text));
}

/** Preserve the exact frozen fact envelope. Human answers are separate data,
 * never replacement facts, a quote selection, or approval. */
export function continueOriginalSceneMaterial(previous: ReturnType<typeof parseTaskModelInput>,
  continuation: { receiptId: string; inputHash: string; result: { text: string }; answers: unknown },
  refreshed?: Pick<ReturnType<typeof readOriginalSceneEnvelope>, 'original' | 'materialHash' | 'trust' | 'facts' | 'knowledge'>) {
  const envelope = readOriginalSceneEnvelope(previous);
  if (refreshed && (requestFingerprint(refreshed.original) !== requestFingerprint(envelope.original)
    || requestFingerprint(refreshed.facts) !== refreshed.materialHash
    || Object.hasOwn(refreshed, 'conversationHistory'))) throw unavailable();
  // A successor retains the original history package. Refreshing current
  // business facts cannot silently attach or replace cross-turn evidence.
  const next = envelopeSchema.parse({ ...envelope, ...(refreshed ?? {}), clarifications: [...(envelope.clarifications ?? [])
    .map(row => refreshed ? { ...row, response: '' } : row),
    { receiptId: continuation.receiptId, inputHash: continuation.inputHash,
      response: refreshed ? '' : continuation.result.text, answers: structuredClone(continuation.answers) }] });
  const text = JSON.stringify(next);
  if (Buffer.byteLength(text, 'utf8') > 131072) throw unavailable();
  const content: Array<{ kind: 'text'; text: string }> = [];
  for (let offset = 0; offset < text.length; offset += 16000) content.push({ kind: 'text', text: text.slice(offset, offset + 16000) });
  return taskModelMaterialSchema.parse({ maxOutputTokens: previous.intent.maxOutputTokens,
    messages: withoutTaskModelDisplayMessages(previous.intent.messages)
      .map(message => message.role === 'user' ? { role: 'user', content } : structuredClone(message)) });
}

export function composeOriginalSceneKnowledge(options: AiOriginalSceneKnowledgeOptions,
  identity: Pick<PrismaFormalKnowledgeDependencies, 'auth' | 'credentials'>, clock: () => Date) {
  const { includePreferences, preferenceKinds: selectedKinds, ...infrastructure } = options;
  if (typeof includePreferences !== 'boolean') throw unavailable();
  const preferenceKinds = selectedKinds === undefined ? undefined : Object.freeze([...selectedKinds]);
  const allowedKinds = preferenceSchema.options.map(schema => schema.shape.kind.value);
  if (preferenceKinds && (!includePreferences || preferenceKinds.length < 1
    || preferenceKinds.length > allowedKinds.length || new Set(preferenceKinds).size !== preferenceKinds.length
    || preferenceKinds.some(kind => !allowedKinds.includes(kind)))) throw unavailable();
  const services = composePrismaFormalHumanKnowledge({ ...infrastructure, auth: identity.auth,
    credentials: identity.credentials, clock: { now: () => clock().getTime() } });
  const revalidate = async (value: unknown, originalInputRef: string) => {
    const parsed = snapshotSchema.safeParse(structuredClone(value));
    if (!parsed.success || parsed.data.originalInputRef !== originalInputRef
      || requestFingerprint(parsed.data.material) !== parsed.data.contentHash
      || Buffer.byteLength(JSON.stringify(parsed.data.material), 'utf8') > maxTotalBytes) throw unavailable();
    try {
      const material = await services.preparation.revalidate(parsed.data.material);
      if (requestFingerprint(material) !== parsed.data.contentHash) throw unavailable();
      return freezeOriginalInput({ ...parsed.data, material });
    } catch { throw unavailable(); }
  };
  return Object.freeze({
    async collect(originalInputRef: string, request: AiSceneRequestBody): Promise<AiOriginalSceneKnowledgeSnapshot> {
      const query = request.sceneCode === 'order_explanation' ? request.input.question
        : request.sceneCode === 'opening_diagnosis' ? request.input.sections.join(' ') : 'quote';
      try {
        const material = await services.preparation.collect({ requestId: `scene_knowledge_${originalInputRef}`, query,
          maxSources: 4, maxSnippetChars: 1000, maxTotalBytes }, { includePreferences, maxPreferences: 4,
          ...(preferenceKinds ? { preferenceKinds } : {}) });
        if (material.status !== 'ready' && material.status !== 'partial') throw unavailable();
        return await revalidate({ version: 'ain-scene-knowledge-1', originalInputRef,
          contentHash: requestFingerprint(material), material }, originalInputRef);
      } catch { throw unavailable(); }
    },
    revalidate,
    async open(value: unknown, originalInputRef: string, sourceIndex: number) {
      const snapshot = await revalidate(value, originalInputRef), entry = snapshot.material.sources[sourceIndex];
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || !entry) throw unavailable();
      try {
        const content = await services.context.open(entry.source);
        await revalidate(snapshot, originalInputRef);
        return freezeOriginalInput({ reference: entry.source, content });
      } catch { throw unavailable(); }
    }
  });
}
export type AiOriginalSceneKnowledge = ReturnType<typeof composeOriginalSceneKnowledge>;
