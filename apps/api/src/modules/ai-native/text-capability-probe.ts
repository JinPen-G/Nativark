import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AiGatewayIntentDraft, AiGatewayConfigReferenceDraft } from '@rental-os/shared';
import { AI_CONTRACT_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, AI_CAPABILITY_PROBE_KINDS_DRAFT,
  type AiCapabilityProbeKindDraft } from '@rental-os/shared';
import type { AiProviderProfileRecord } from './provider-profile.ports';
import { capabilityProfileFingerprint } from './capability-verification';
import { prepareGatewayTextIntent, prepareGatewayEmbeddingProbeIntent } from './gateway-intent';
import { ModelGatewayError, modelUsageSchema, modelReasoningEvidenceSchema, modelEmbeddingEvidenceSchema } from './model-gateway.ports';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { visionCapabilityChallenge, VISION_PROBE_METHOD } from './vision-capability-challenge';
import { audioCapabilityChallenge, AUDIO_PROBE_METHOD } from './audio-capability-challenge';

export const TEXT_PROBE_METHOD = 'text-echo-1';
export const STREAM_PROBE_METHOD = 'text-stream-1';
export const STRUCTURED_PROBE_METHOD = 'structured-json-1';
export const TOOLS_PROBE_METHOD = 'order-tool-call-1';
export const REASONING_PROBE_METHOD = 'reasoning-channel-1';
export const EMBEDDING_PROBE_METHOD = 'embedding-vector-1';
export type TextProbeCapability = AiCapabilityProbeKindDraft;
const probeCapabilitySchema = z.enum(AI_CAPABILITY_PROBE_KINDS_DRAFT);
/** Selection vocabulary is not protocol implementation. Keep this gate separate
 * from remote evidence and provider names; absent methods cannot dispatch. */
export const hasObjectiveProbeMethod = (capability: TextProbeCapability, protocol?: unknown): boolean =>
  capability === 'embedding' ? protocol === 'openai_chat_completions'
    : capability === 'reasoning' ? protocol === 'openai_responses'
    : ['text', 'streaming', 'vision', 'audio', 'structured_output', 'tools'].includes(capability);
export const TEXT_PROBE_SCENE = 'ai.capability.text';
/** Mirrored by the shared source contract; local literal keeps the isolated
 * runtime usable before a shared client regeneration. */
export const TEXT_CAPABILITY_PROBE_TOOL = 'ai.capability.text.probe' as const;
export const TEXT_PROBE_TTL_MS = 3_600_000;
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const probeDigest = z.string().regex(/^[0-9a-f]{64}$/u);
export const textProbeCommandSchema = z.object({ operationId: id, profileKey: id.max(64), profileFingerprint: probeDigest,
  capability: probeCapabilitySchema.optional() }).strict();
export type TextProbeCommand = z.infer<typeof textProbeCommandSchema>;
export const textProbeCapability = (command: Pick<TextProbeCommand, 'capability'>): TextProbeCapability => command.capability ?? 'text';
export const textProbeMode = (command: TextProbeCommand) => textProbeCapability(command) === 'streaming' ? 'stream' as const : 'invoke' as const;
export const textProbeMethod = (command: Pick<TextProbeCommand, 'capability'>, protocol?: unknown) => textProbeCapability(command) === 'embedding' ? protocol === 'openai_chat_completions' ? EMBEDDING_PROBE_METHOD : 'embedding-unavailable-1'
  : textProbeCapability(command) === 'reasoning' ? protocol === 'openai_responses' ? REASONING_PROBE_METHOD : 'reasoning-unavailable-1'
  : textProbeCapability(command) === 'audio' ? AUDIO_PROBE_METHOD : textProbeCapability(command) === 'tools' ? TOOLS_PROBE_METHOD : textProbeCapability(command) === 'structured_output' ? STRUCTURED_PROBE_METHOD : textProbeCapability(command) === 'vision' ? VISION_PROBE_METHOD
  : textProbeCapability(command) === 'streaming' ? STREAM_PROBE_METHOD : TEXT_PROBE_METHOD;
export const textProbeRouteScene = (command: TextProbeCommand) => textProbeCapability(command) === 'embedding' ? 'embedding' as const
  : textProbeCapability(command) === 'reasoning' ? 'reasoning' as const : 'chat' as const;
export const textProbeRequirements = (command: TextProbeCommand): TextProbeCapability[] => textProbeCapability(command) === 'reasoning'
  ? ['text', 'reasoning'] : !hasObjectiveProbeMethod(textProbeCapability(command))
  ? [textProbeCapability(command)] : textProbeCapability(command) === 'audio' ? ['text', 'audio'] : textProbeCapability(command) === 'tools'
  ? ['text', 'tools'] : textProbeCapability(command) === 'structured_output'
  ? ['text', 'structured_output'] : textProbeCapability(command) === 'vision'
  ? ['text', 'vision'] : textProbeMode(command) === 'stream' ? ['text', 'streaming'] : ['text'];
/** Inspecting an unavailable kind is metadata-only. The effective protocol is
 * returned only when current policy AND a local method allow execution. */
export const textProbeExecutionProtocol = (command: TextProbeCommand, profile: AiProviderProfileRecord) =>
  textProbeRequirements(command).every(value => profile.allowedCapabilities.includes(value)) ? profile.protocol : undefined;
export const canExecuteTextProbe = (command: TextProbeCommand, profile: AiProviderProfileRecord) =>
  hasObjectiveProbeMethod(textProbeCapability(command), profile.protocol)
    && textProbeRequirements(command).every(value => profile.allowedCapabilities.includes(value));
/** Workspace probe consumers carry their real tenant/workspace attribution.
 * The platform shape is the explicit SaaS principal only: no tenant or
 * workspace field exists to fabricate, and old rows keep parsing unchanged. */
export const probeContextSchema = z.union([
  z.object({ tenantId: id, workspaceId: id, actorId: id }).strict(),
  z.object({ actorId: id, scopeKind: z.literal('platform') }).strict()
]);
export type TextProbeContext = z.infer<typeof probeContextSchema>;
export const isPlatformProbeContext = (value: TextProbeContext): value is { actorId: string; scopeKind: 'platform' } =>
  'scopeKind' in value && value.scopeKind === 'platform';
// Retain original cache categories for the same accounting usage hash. They
// are included in inputTokens already, not extra usage or a new pricing source.
export const probeUsageSchema = modelUsageSchema.refine(value => value.inputTokens > 0 && value.outputTokens > 0);
export const embeddingProbeUsageSchema = modelUsageSchema.refine(value => value.inputTokens > 0 && value.outputTokens === 0);
export const textProbeProfileIdSchema = id.max(36);
export const textProbeDescriptorSchema = z.object({
  // Selection is not an executable method. Match the actual protocol and method
  // rather than accepting a reasoning command with a foreign text descriptor.
  command: textProbeCommandSchema, context: probeContextSchema, scopeId: id.max(36), profileId: textProbeProfileIdSchema,
  methodVersion: z.enum([TEXT_PROBE_METHOD, STREAM_PROBE_METHOD, VISION_PROBE_METHOD, AUDIO_PROBE_METHOD, STRUCTURED_PROBE_METHOD, TOOLS_PROBE_METHOD, REASONING_PROBE_METHOD, EMBEDDING_PROBE_METHOD]), callId: id, intentHash: probeDigest, challengeHash: probeDigest,
  profileFingerprint: probeDigest, configuration: z.record(z.unknown()), configurationHash: probeDigest,
  stepId: id.max(36), runId: id.max(36)
}).strict().refine(value => hasObjectiveProbeMethod(textProbeCapability(value.command), value.configuration.protocol)
  && value.methodVersion === textProbeMethod(value.command, value.configuration.protocol));
export type TextProbeDescriptor = z.infer<typeof textProbeDescriptorSchema>;
export const textProbeObservationSchema = z.object({
  admissionId: id.max(36), dispatchId: id, requestHash: probeDigest, reservationId: id.max(36),
  transport: z.enum(['node_https', 'mock']), responseHash: probeDigest, matched: z.boolean(),
  usage: modelUsageSchema.nullable(), checkedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  reasoningEvidence: modelReasoningEvidenceSchema.optional(), embeddingEvidence: modelEmbeddingEvidenceSchema.optional(),
  delivery: z.object({ mode: z.literal('stream'), eventCount: z.number().int().min(2).max(4094),
    deltaCount: z.number().int().min(1).max(4093), deltaBytes: z.number().int().min(1).max(256), deltaHash: probeDigest }).strict().optional()
}).strict();
export type TextProbeObservation = z.infer<typeof textProbeObservationSchema>;
export interface TextProbeReceipt {
  id: string; descriptor: TextProbeDescriptor; descriptorHash: string;
  observation: TextProbeObservation | null; observationHash: string | null;
}
export function textDigest(text: string) { return createHash('sha256').update(text).digest('hex'); }
export function textProbeIntent(operationId: string, scopeId: string, capability: TextProbeCapability = 'text'): { intent: AiGatewayIntentDraft; expected: string; intentHash: string; challengeHash: string } {
  id.parse(operationId); id.max(36).parse(scopeId);
  probeCapabilitySchema.parse(capability);
  if (!hasObjectiveProbeMethod(capability, capability === 'embedding' ? 'openai_chat_completions' : capability === 'reasoning' ? 'openai_responses' : undefined)) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  if (capability === 'embedding') {
    const key = requestFingerprint({ method: EMBEDDING_PROBE_METHOD, scopeId, operationId });
    const input = [`A violet canoe crosses the quiet river. ${key.slice(0, 16)}`, `A copper library holds ancient maps. ${key.slice(16, 32)}`];
    const intent: AiGatewayIntentDraft = { draftVersion: 'ain-c03-draft-2', requestId: `capability:${key}`, sceneCode: TEXT_PROBE_SCENE,
      messages: input.map(text => ({ role: 'user', content: [{ kind: 'text', text }] })),
      requiredFeatures: ['embedding'], optionalFeatures: [], maxOutputTokens: 32 };
    const prepared = prepareGatewayEmbeddingProbeIntent(intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32, embeddingProbe: true });
    return { intent, expected: '', intentHash: prepared.intentHash, challengeHash: requestFingerprint(intent.messages) };
  }
  if (capability === 'reasoning') {
    const key = requestFingerprint({ method: REASONING_PROBE_METHOD, scopeId, operationId });
    const a = 11 + parseInt(key.slice(0, 2), 16), b = 17 + parseInt(key.slice(2, 4), 16), c = 2 + parseInt(key.slice(4, 6), 16) % 7;
    const expected = String((a + b) * c);
    const intent: AiGatewayIntentDraft = { draftVersion: 'ain-c03-draft-2', requestId: `capability:${key}`, sceneCode: TEXT_PROBE_SCENE,
      messages: [{ role: 'user', content: [{ kind: 'text', text: `Compute (${a} + ${b}) * ${c}. Return only the integer answer, with no explanation.` }] }],
      requiredFeatures: ['text', 'reasoning'], optionalFeatures: [], maxOutputTokens: 32 };
    const prepared = prepareGatewayTextIntent(intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32, reasoningChannel: true }, 'invoke');
    return { intent, expected, intentHash: prepared.intentHash, challengeHash: requestFingerprint(intent.messages) };
  }
  if (capability === 'audio') {
    const audio = audioCapabilityChallenge(operationId, scopeId);
    const key = requestFingerprint({ method: AUDIO_PROBE_METHOD, scopeId, operationId });
    const intent: AiGatewayIntentDraft = { draftVersion: 'ain-c03-draft-2', requestId: `capability:${key}`, sceneCode: TEXT_PROBE_SCENE,
      messages: [{ role: 'user', content: [{ kind: 'text', text: 'Listen to the sixteen groups of beeps. Short silence separates beeps within a group; longer silence separates groups. Return exactly sixteen counts (1 to 4), in order, separated by single spaces. Return no prose.' },
        { kind: 'audio', attachmentId: audio.attachmentId, attachmentRevision: audio.attachmentRevision }] }],
      requiredFeatures: ['text', 'audio'], optionalFeatures: [], maxOutputTokens: 32 };
    const media = [{ role: 'user', media: [{ kind: 'audio', attachmentId: audio.attachmentId,
      attachmentRevision: audio.attachmentRevision, mediaType: audio.mediaType, contentHash: audio.contentHash }] }];
    return { intent, expected: audio.expected, intentHash: requestFingerprint({ intent, mode: 'invoke', media }),
      challengeHash: requestFingerprint(intent.messages) };
  }
  if (capability === 'tools') {
    const key = requestFingerprint({ method: TOOLS_PROBE_METHOD, scopeId, operationId }), orderId = `PROBE_${key.slice(0, 16)}`;
    const expected = JSON.stringify([{ contractVersion: AI_CONTRACT_DRAFT_VERSION, toolCode: 'rental.order.explain',
      toolVersion: AI_TOOL_DRAFT_VERSION, input: { orderId } }]);
    const intent: AiGatewayIntentDraft = { draftVersion: 'ain-c03-draft-2', requestId: `capability:${key}`, sceneCode: TEXT_PROBE_SCENE,
      messages: [{ role: 'user', content: [{ kind: 'text', text: `Call rental_order_explain exactly once with orderId ${orderId}. This is a format-only challenge; no business tool is executed. Return no prose.` }] }],
      requiredFeatures: ['text', 'tools'], optionalFeatures: [], maxOutputTokens: 32 };
    const prepared = prepareGatewayTextIntent(intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32, orderExplainTool: true }, 'invoke');
    return { intent, expected, intentHash: prepared.intentHash, challengeHash: requestFingerprint(intent.messages) };
  }
  if (capability === 'structured_output') {
    const key = requestFingerprint({ method: STRUCTURED_PROBE_METHOD, scopeId, operationId });
    const expected = JSON.stringify({ token: `PROBE_${key.slice(0, 16)}` });
    const intent: AiGatewayIntentDraft = { draftVersion: 'ain-c03-draft-2', requestId: `capability:${key}`, sceneCode: TEXT_PROBE_SCENE,
      messages: [{ role: 'user', content: [{ kind: 'text', text: `Return the JSON object ${expected}, with no additional fields.` }] }],
      requiredFeatures: ['text', 'structured_output'], optionalFeatures: [], maxOutputTokens: 32 };
    const prepared = prepareGatewayTextIntent(intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32, structuredOutput: true }, 'invoke');
    return { intent, expected, intentHash: prepared.intentHash, challengeHash: requestFingerprint(intent.messages) };
  }
  if (capability === 'vision') {
    const image = visionCapabilityChallenge(operationId, scopeId);
    const key = requestFingerprint({ method: VISION_PROBE_METHOD, scopeId, operationId });
    const intent: AiGatewayIntentDraft = { draftVersion: 'ain-c03-draft-2', requestId: `capability:${key}`, sceneCode: TEXT_PROBE_SCENE,
      messages: [{ role: 'user', content: [{ kind: 'text', text: 'Read this 4 by 4 color grid row by row, left to right, top to bottom. Return exactly sixteen uppercase color names separated by single spaces and nothing else. Use RED, GREEN, BLUE, YELLOW.' },
        { kind: 'image', attachmentId: image.attachmentId, attachmentRevision: image.attachmentRevision }] }],
      requiredFeatures: ['text', 'image'], optionalFeatures: [], maxOutputTokens: 32 };
    const media = [{ role: 'user', media: [{ kind: 'image', attachmentId: image.attachmentId, attachmentRevision: image.attachmentRevision,
      mediaType: image.mediaType, contentHash: image.contentHash }] }];
    return { intent, expected: image.expected, intentHash: requestFingerprint({ intent, mode: 'invoke', media }),
      challengeHash: requestFingerprint(intent.messages) };
  }
  const method = capability === 'streaming' ? STREAM_PROBE_METHOD : TEXT_PROBE_METHOD;
  const key = requestFingerprint({ method, scopeId, operationId });
  const expected = `PROBE_${key.slice(0, 16)}`;
  const intent: AiGatewayIntentDraft = { draftVersion: 'ain-c03-draft-2', requestId: `capability:${key}`, sceneCode: TEXT_PROBE_SCENE,
    messages: [{ role: 'user', content: [{ kind: 'text', text: `Return exactly this token and nothing else: ${expected}` }] }],
    requiredFeatures: capability === 'streaming' ? ['text', 'streaming'] : ['text'], optionalFeatures: [], maxOutputTokens: 32 };
  const prepared = prepareGatewayTextIntent(intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32 }, capability === 'streaming' ? 'stream' : 'invoke');
  return { intent, expected, intentHash: prepared.intentHash, challengeHash: requestFingerprint(intent.messages) };
}
/** Immutable preparation for the original request, not a model call. The old
 * six methods retain their exact hashes; missing methods have neither prompt,
 * expected output nor executable Gateway intent. */
export function textProbePreparation(operationId: string, scopeId: string, capability: TextProbeCapability = 'text', protocol?: unknown) {
  id.parse(operationId); id.max(36).parse(scopeId); probeCapabilitySchema.parse(capability);
  if (hasObjectiveProbeMethod(capability, protocol)) return textProbeIntent(operationId, scopeId, capability);
  const metadata = { operationId, scopeId, capability,
    methodVersion: textProbeMethod({ capability }, protocol),
    objectiveMethod: 'unavailable' };
  return { intent: null, expected: null, intentHash: requestFingerprint(metadata),
    challengeHash: requestFingerprint({ ...metadata, challenge: 'not_available' }) };
}
export function textProbeConfiguration(profile: AiProviderProfileRecord, consumer: { kind: 'workspace'; tenantId: string } | { kind: 'platform' }): AiGatewayConfigReferenceDraft {
  if (consumer.kind === 'platform') {
    // Explicit SaaS/platform consumer reference (shared third branch). The
    // profile must itself be platform-owned; no tenant attribution is invented.
    if (profile.serviceMode !== 'platform_managed' || profile.scopeKind !== 'PLATFORM') throw new ModelGatewayError('CONFIG_INVALID');
    return { configId: profile.id, configRevision: profile.configRevision, credentialRef: profile.credentialRef,
      protocol: profile.protocol, provider: profile.provider, model: profile.model,
      consumerScope: { kind: 'platform' }, serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } };
  }
  const base = { configId: profile.id, configRevision: profile.configRevision, credentialRef: profile.credentialRef,
    protocol: profile.protocol, provider: profile.provider, model: profile.model, tenantId: consumer.tenantId };
  return profile.serviceMode === 'platform_managed'
    ? { ...base, serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } }
    : { ...base, serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: consumer.tenantId } };
}
export function matchesProbeProfile(descriptor: TextProbeDescriptor, profile: AiProviderProfileRecord) {
  const expectedScopeKind = profile.serviceMode === 'platform_managed' ? 'PLATFORM' : 'TENANT';
  const consumer = isPlatformProbeContext(descriptor.context) ? { kind: 'platform' as const } : { kind: 'workspace' as const, tenantId: descriptor.context.tenantId };
  return profile.scopeKind === expectedScopeKind
    && profile.enabled && !profile.disabledAt && textProbeRequirements(descriptor.command).every(value => profile.allowedCapabilities.includes(value))
    && hasObjectiveProbeMethod(textProbeCapability(descriptor.command), profile.protocol)
    && descriptor.methodVersion === textProbeMethod(descriptor.command, profile.protocol)
    && descriptor.profileId === profile.id && descriptor.profileFingerprint === capabilityProfileFingerprint(profile)
    && descriptor.command.profileFingerprint === descriptor.profileFingerprint
    && descriptor.configurationHash === requestFingerprint(textProbeConfiguration(profile, consumer));
}
export function textProbeEvidenceHash(receipt: TextProbeReceipt) {
  return requestFingerprint({ receiptId: receipt.id, descriptorHash: receipt.descriptorHash, observationHash: receipt.observationHash });
}
