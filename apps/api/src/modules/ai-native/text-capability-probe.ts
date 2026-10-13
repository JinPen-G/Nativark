import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AiGatewayIntentDraft, AiGatewayConfigReferenceDraft } from '@rental-os/shared';
import type { AiProviderProfileRecord } from './provider-profile.ports';
import { capabilityProfileFingerprint } from './capability-verification';
import { prepareGatewayTextIntent } from './gateway-intent';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { visionCapabilityChallenge, VISION_PROBE_METHOD } from './vision-capability-challenge';

export const TEXT_PROBE_METHOD = 'text-echo-1';
export const STREAM_PROBE_METHOD = 'text-stream-1';
export const STRUCTURED_PROBE_METHOD = 'structured-json-1';
export type TextProbeCapability = 'text' | 'streaming' | 'vision' | 'structured_output';
export const TEXT_PROBE_SCENE = 'ai.capability.text';
/** Mirrored by the shared source contract; local literal keeps the isolated
 * runtime usable before a shared client regeneration. */
export const TEXT_CAPABILITY_PROBE_TOOL = 'ai.capability.text.probe' as const;
export const TEXT_PROBE_TTL_MS = 3_600_000;
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const probeDigest = z.string().regex(/^[0-9a-f]{64}$/u);
export const textProbeCommandSchema = z.object({ operationId: id, profileKey: id.max(64), profileFingerprint: probeDigest,
  capability: z.enum(['text', 'streaming', 'vision', 'structured_output']).optional() }).strict();
export type TextProbeCommand = z.infer<typeof textProbeCommandSchema>;
export const textProbeCapability = (command: TextProbeCommand): TextProbeCapability => command.capability ?? 'text';
export const textProbeMode = (command: TextProbeCommand) => textProbeCapability(command) === 'streaming' ? 'stream' as const : 'invoke' as const;
export const textProbeMethod = (command: TextProbeCommand) => textProbeCapability(command) === 'structured_output' ? STRUCTURED_PROBE_METHOD : textProbeCapability(command) === 'vision' ? VISION_PROBE_METHOD
  : textProbeCapability(command) === 'streaming' ? STREAM_PROBE_METHOD : TEXT_PROBE_METHOD;
export const textProbeRequirements = (command: TextProbeCommand): Array<'text' | 'streaming' | 'vision' | 'structured_output'> => textProbeCapability(command) === 'structured_output'
  ? ['text', 'structured_output'] : textProbeCapability(command) === 'vision'
  ? ['text', 'vision'] : textProbeMode(command) === 'stream' ? ['text', 'streaming'] : ['text'];
export const probeContextSchema = z.object({ tenantId: id, workspaceId: id, actorId: id }).strict();
export const probeUsageSchema = z.object({ inputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  outputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
export const textProbeDescriptorSchema = z.object({
  command: textProbeCommandSchema, context: probeContextSchema, scopeId: id.max(36), profileId: id.max(36),
  methodVersion: z.enum([TEXT_PROBE_METHOD, STREAM_PROBE_METHOD, VISION_PROBE_METHOD, STRUCTURED_PROBE_METHOD]), callId: id, intentHash: probeDigest, challengeHash: probeDigest,
  profileFingerprint: probeDigest, configuration: z.record(z.unknown()), configurationHash: probeDigest,
  stepId: id.max(36), runId: id.max(36)
}).strict();
export type TextProbeDescriptor = z.infer<typeof textProbeDescriptorSchema>;
export const textProbeObservationSchema = z.object({
  admissionId: id.max(36), dispatchId: id, requestHash: probeDigest, reservationId: id.max(36),
  transport: z.enum(['node_https', 'mock']), responseHash: probeDigest, matched: z.boolean(),
  usage: probeUsageSchema.nullable(), checkedAt: z.string().datetime(), expiresAt: z.string().datetime(),
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
  z.enum(['text', 'streaming', 'vision', 'structured_output']).parse(capability);
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
export function textProbeConfiguration(profile: AiProviderProfileRecord, tenantId: string): AiGatewayConfigReferenceDraft {
  const base = { configId: profile.id, configRevision: profile.configRevision, credentialRef: profile.credentialRef,
    protocol: profile.protocol, provider: profile.provider, model: profile.model, tenantId };
  return profile.serviceMode === 'platform_managed'
    ? { ...base, serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } }
    : { ...base, serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId } };
}
export function matchesProbeProfile(descriptor: TextProbeDescriptor, profile: AiProviderProfileRecord) {
  const expectedScopeKind = profile.serviceMode === 'platform_managed' ? 'PLATFORM' : 'TENANT';
  return profile.scopeKind === expectedScopeKind
    && profile.enabled && !profile.disabledAt && textProbeRequirements(descriptor.command).every(value => profile.allowedCapabilities.includes(value))
    && descriptor.methodVersion === textProbeMethod(descriptor.command)
    && descriptor.profileId === profile.id && descriptor.profileFingerprint === capabilityProfileFingerprint(profile)
    && descriptor.command.profileFingerprint === descriptor.profileFingerprint
    && descriptor.configurationHash === requestFingerprint(textProbeConfiguration(profile, descriptor.context.tenantId));
}
export function textProbeEvidenceHash(receipt: TextProbeReceipt) {
  return requestFingerprint({ receiptId: receipt.id, descriptorHash: receipt.descriptorHash, observationHash: receipt.observationHash });
}
