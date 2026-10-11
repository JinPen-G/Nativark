import { z } from 'zod';
import { AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE, type AiExecutionContext, type AiGatewayConfigReferenceDraft, type AiGatewayIntentDraft, type AiTaskInputAnswerDraft } from '@rental-os/shared';
import { isGatewayConfig, isGatewayIntent, isGatewayResult } from '../gateway-contract-validation';
import { prepareGatewayTextIntent, type GatewayTextIntentPolicy } from '../gateway-intent';
import type { GatewayRoutingResolution } from '../gateway-routing.service';
import { ModelGatewayError } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

export const TASK_TEXT_MODEL_TOOL = AI_TEXT_MODEL_STEP_CODE;
export const TASK_IMAGE_MODEL_TOOL = AI_IMAGE_MODEL_STEP_CODE;
export const TASK_AUDIO_MODEL_TOOL = AI_AUDIO_MODEL_STEP_CODE;
export const isTaskModelTool = (value: string) => value === TASK_TEXT_MODEL_TOOL || value === TASK_IMAGE_MODEL_TOOL || value === TASK_AUDIO_MODEL_TOOL;
export type TaskModelKind = 'image' | 'audio';
export type TaskModelPolicy = GatewayTextIntentPolicy & { kind?: TaskModelKind };
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const taskModelMaterialSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']),
    content: z.array(z.object({ kind: z.literal('text'), text: z.string().max(32000) }).strict()).min(1).max(64)
  }).strict()).min(1).max(64),
  maxOutputTokens: z.number().int().min(1).max(32768)
}).strict();
const mediaReference = z.object({ kind: z.literal('image'), attachmentId: z.string().min(1).max(128).regex(/^[\w.:-]+$/u),
  attachmentRevision: z.number().int().min(1).max(4294967294) }).strict();
const audioReference = z.object({ kind: z.literal('audio'), attachmentId: z.string().min(1).max(128).regex(/^[\w.:-]+$/u),
  attachmentRevision: z.number().int().min(1).max(4294967294) }).strict();
export const taskImageMaterialSchema = taskModelMaterialSchema.extend({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']),
    content: z.array(z.union([z.object({ kind: z.literal('text'), text: z.string().max(32000) }).strict(), mediaReference])).min(1).max(16)
  }).strict()).min(1).max(64)
}).strict();
export const taskAudioMaterialSchema = taskModelMaterialSchema.extend({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']),
    content: z.array(z.union([z.object({ kind: z.literal('text'), text: z.string().max(32000) }).strict(), audioReference])).min(1).max(16)
  }).strict()).min(1).max(64)
}).strict();
const imageMediaReference = mediaReference.extend({ mediaType: z.enum(['image/png', 'image/jpeg']), contentHash: hash,
  sizeBytes: z.number().int().min(1).max(524288) }).strict();
const audioMediaReference = audioReference.extend({ mediaType: z.literal('audio/wav'), contentHash: hash,
  sizeBytes: z.number().int().min(1).max(524288) }).strict();
export const taskImageMediaSchema = z.array(imageMediaReference).min(1).max(8);
export const taskAudioMediaSchema = z.array(audioMediaReference).min(1).max(8);
export const taskModelMediaSchema = z.array(z.union([imageMediaReference, audioMediaReference])).min(1).max(8);
const storedSchema = z.object({ mode: z.literal('invoke'), intent: z.unknown(), configuration: z.unknown(),
  priceVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u), routingHash: hash, identityHash: hash,
  media: taskModelMediaSchema.optional() }).strict();

export function taskModelIdentity({ requestId: _, authorizedAt: __, ...context }: AiExecutionContext) {
  return requestFingerprint(context);
}

export function parseTaskModelInput(value: unknown, policy: TaskModelPolicy) {
  const parsed = storedSchema.parse(structuredClone(value));
  if (!isGatewayIntent(parsed.intent) || !isGatewayConfig(parsed.configuration)) throw new ModelGatewayError('INVALID_REQUEST');
  const input = { ...parsed, intent: parsed.intent, configuration: parsed.configuration };
  if (policy.kind === 'image' || policy.kind === 'audio') {
    (policy.kind === 'image' ? taskImageMaterialSchema : taskAudioMaterialSchema).parse({ messages: input.intent.messages, maxOutputTokens: input.intent.maxOutputTokens });
    if (input.intent.sceneCode !== policy.sceneCode || input.intent.maxOutputTokens > policy.maxOutputTokens
      || requestFingerprint(input.intent.requiredFeatures) !== requestFingerprint(['text', policy.kind]) || input.intent.optionalFeatures.length
      || !input.media) throw new ModelGatewayError('INVALID_REQUEST');
    const refs = input.intent.messages.flatMap(message => message.content.filter(part => part.kind !== 'text'));
    if (refs.length !== input.media.length || refs.some((ref, index) => ref.kind !== policy.kind
      || input.media![index].kind !== policy.kind
      || ref.attachmentId !== input.media![index].attachmentId || ref.attachmentRevision !== input.media![index].attachmentRevision)
      || input.intent.messages.some(message => message.role !== 'user' && message.content.some(part => part.kind !== 'text'))) {
      throw new ModelGatewayError('INVALID_REQUEST');
    }
  } else {
    if (input.media) throw new ModelGatewayError('INVALID_REQUEST');
    prepareGatewayTextIntent(input.intent, policy, input.mode);
  }
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 262144) throw new ModelGatewayError('INVALID_REQUEST');
  return input;
}
export type TaskModelInput = ReturnType<typeof parseTaskModelInput>;

/** Reconstruct only a completed, measured parent plus persisted human answers.
 * Both publication and result consumers use this exact material derivation. */
export function continueTaskModelMaterial(previous: TaskModelInput, value: unknown,
  answers: readonly AiTaskInputAnswerDraft[], policy: TaskModelPolicy) {
  const result = structuredClone(value);
  if (!isGatewayResult(result) || result.status !== 'completed' || result.usage.kind !== 'reported'
    || result.requestId !== previous.intent.requestId || result.toolRequests.length
    || requestFingerprint(result.actual) !== requestFingerprint(previous.configuration)) {
    throw new ModelGatewayError('INVALID_REQUEST');
  }
  return (policy.kind === 'image' ? taskImageMaterialSchema : policy.kind === 'audio' ? taskAudioMaterialSchema : taskModelMaterialSchema).parse({
    messages: [...previous.intent.messages,
      { role: 'assistant', content: [{ kind: 'text', text: result.text }] },
      { role: 'user', content: [{ kind: 'text', text: JSON.stringify({ request: 'clarification_answers', answers }) }] }],
    maxOutputTokens: previous.intent.maxOutputTokens
  });
}

export function taskModelFingerprint(input: TaskModelInput, policy: TaskModelPolicy) {
  if (policy.kind === 'image' || policy.kind === 'audio') {
    input = parseTaskModelInput(input, policy);
    let index = 0;
    const media = input.intent.messages.map(message => ({ role: message.role,
      media: message.content.filter(part => part.kind !== 'text').map(() => {
        const { sizeBytes: _, ...reference } = input.media![index++]; return reference;
      }) }));
    return requestFingerprint({ intent: input.intent, mode: input.mode, media });
  }
  return prepareGatewayTextIntent(input.intent, { sceneCode: policy.sceneCode, maxOutputTokens: policy.maxOutputTokens }, input.mode).intentHash;
}

export function taskModelIntent(taskId: string, runId: string, registrationRef: string, sceneCode: string,
  material: z.infer<typeof taskImageMaterialSchema> | z.infer<typeof taskAudioMaterialSchema>, kind?: TaskModelKind): AiGatewayIntentDraft {
  return { draftVersion: 'ain-c03-draft-2',
    requestId: `model-${requestFingerprint({ taskId, runId, registrationRef })}`, sceneCode,
    messages: material.messages, maxOutputTokens: material.maxOutputTokens,
    requiredFeatures: kind === 'image' ? ['text', 'image'] : kind === 'audio' ? ['text', 'audio'] : ['text'], optionalFeatures: [] };
}

export function taskModelConfiguration(route: GatewayRoutingResolution): AiGatewayConfigReferenceDraft {
  const context = route.context, profile = route.route.profile, owner = route.route.scope;
  if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
    || !['operator', 'staff'].includes(context.audience) || route.consumerScope.kind !== 'WORKSPACE'
    || route.consumerScope.tenantId !== context.scope.tenantId || route.consumerScope.workspaceId !== context.scope.workspaceId
    || profile.scopeId !== owner.id || profile.scopeKind !== owner.kind || profile.serviceMode !== route.selection.mode) {
    throw new ModelGatewayError('FORBIDDEN');
  }
  const base = { configId: profile.id, configRevision: profile.configRevision, credentialRef: profile.credentialRef,
    protocol: profile.protocol, provider: profile.provider, model: profile.model, tenantId: context.scope.tenantId };
  let result: AiGatewayConfigReferenceDraft;
  if (route.selection.mode === 'platform_managed' && owner.kind === 'PLATFORM') {
    result = { ...base, serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } };
  } else if (route.selection.mode === 'tenant_managed' && owner.kind === 'TENANT' && owner.tenantId === context.scope.tenantId) {
    result = { ...base, serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: context.scope.tenantId } };
  } else throw new ModelGatewayError('CONFIG_INVALID');
  if (!isGatewayConfig(result)) throw new ModelGatewayError('CONFIG_INVALID');
  return result;
}
