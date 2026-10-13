import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AiGatewayIntentDraft, AiGatewayFeatureDraft } from '@rental-os/shared';
import { ModelGatewayError, modelProtocolRequestBaseSchema, modelProtocolRequestSchema, modelRequestSchema, type GatewayContext, type ModelProtocolContent } from './model-gateway.ports';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const feature = z.enum(['text', 'tools', 'structured_output', 'image', 'audio', 'streaming', 'embedding', 'reasoning']);
const features = z.array(feature).max(8).refine(values => new Set(values).size === values.length);
const id = z.string().min(1).max(128).regex(/^[\w.:-]+$/u);
const content = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(32000) }).strict(),
  z.object({ kind: z.literal('image'), attachmentId: id, attachmentRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ kind: z.literal('audio'), attachmentId: id, attachmentRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()
]);
const intentSchema = z.object({
  draftVersion: z.literal('ain-c03-draft-2'), requestId: id, sceneCode: id,
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.array(content).min(1).max(64) }).strict()).min(1).max(64),
  requiredFeatures: features, optionalFeatures: features,
  maxOutputTokens: z.number().int().min(1).max(32768)
}).strict().refine(value => !value.requiredFeatures.some(item => value.optionalFeatures.includes(item)));
export const gatewayTextIntentPolicySchema = z.object({ sceneCode: id, maxOutputTokens: z.number().int().min(1).max(32768),
  structuredOutput: z.boolean().optional(), orderExplainTool: z.boolean().optional() }).strict();
export const gatewayTextIntentBindingSchema = gatewayTextIntentPolicySchema.extend({ routeScene: z.enum(['chat', 'builder', 'vision', 'knowledge', 'reasoning']) }).strict();
export type GatewayTextIntentBinding = z.infer<typeof gatewayTextIntentBindingSchema>;
export interface GatewayTextIntentPolicy { sceneCode: string; maxOutputTokens: number; structuredOutput?: boolean; orderExplainTool?: boolean; }
export interface PreparedGatewayTextIntent {
  sceneCode: string;
  intentHash: string;
  request: Omit<z.infer<typeof modelRequestSchema>, 'model'>;
  requiredCapabilities: Array<'text' | 'streaming' | 'structured_output' | 'tools'>;
  omittedOptionalFeatures: AiGatewayFeatureDraft[];
}

/** Server-side attachment resolution boundary. The resolver owns current identity,
 * tenant/workspace binding, active-file state and storage authorization. Gateway
 * never accepts bytes, URLs or hashes from the Agent intent. */
export interface GatewayMediaAttachmentResolver {
  /** Fresh ACL/revision/hash validation after admission waits and before send.
   * Optional for compatibility, but media dispatch rejects adapters without it. */
  assertCurrent?(context: GatewayContext, references: readonly {
    kind: 'image' | 'audio'; attachmentId: string; attachmentRevision: number; contentHash: string; mediaType: string;
  }[], signal: AbortSignal): Promise<void>;
  resolve(context: GatewayContext, reference: { kind: 'image' | 'audio'; attachmentId: string; attachmentRevision: number }, signal: AbortSignal): Promise<{
    attachmentId: string; attachmentRevision: number;
    mediaType: 'image/png' | 'image/jpeg' | 'audio/wav';
    bytes: Uint8Array; contentHash: string;
  } | null>;
}
export interface PreparedGatewayIntent {
  sceneCode: string;
  intentHash: string;
  request: Omit<z.infer<typeof modelProtocolRequestSchema>, 'model'>;
  requiredCapabilities: Array<'text' | 'streaming' | 'image' | 'audio' | 'structured_output' | 'tools'>;
  omittedOptionalFeatures: AiGatewayFeatureDraft[];
}

const mediaKinds = new Set<AiGatewayFeatureDraft>(['image', 'audio']);
const supportedMediaType = (kind: 'image' | 'audio', mediaType: string) =>
  kind === 'image' ? mediaType === 'image/png' || mediaType === 'image/jpeg' : mediaType === 'audio/wav';

/** Resolves public content references into a bounded protocol request immediately
 * before routing. Missing resolver, stale attachment, bad hash or unsupported
 * audio capability fails closed; no media is silently dropped. */
export async function prepareGatewayIntent(
  value: AiGatewayIntentDraft,
  serverPolicy: GatewayTextIntentPolicy,
  mode: 'invoke' | 'stream',
  context: GatewayContext,
  media?: GatewayMediaAttachmentResolver,
  signal: AbortSignal = new AbortController().signal
): Promise<PreparedGatewayIntent> {
  context = structuredClone(context);
  const parsed = intentSchema.safeParse(value), policy = gatewayTextIntentPolicySchema.safeParse(serverPolicy);
  if (!policy.success || (mode !== 'invoke' && mode !== 'stream')) throw new ModelGatewayError('CONFIG_INVALID');
  if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
  if (signal.aborted) throw new ModelGatewayError('CANCELLED');
  const input = parsed.data;
  if (input.sceneCode !== policy.data.sceneCode) throw new ModelGatewayError('FORBIDDEN');
  if (input.maxOutputTokens > policy.data.maxOutputTokens) throw new ModelGatewayError('INVALID_REQUEST');
  if (input.requiredFeatures.includes('structured_output') || input.requiredFeatures.includes('tools')) return prepareGatewayTextIntent(value, serverPolicy, mode);
  const supported: AiGatewayFeatureDraft[] = mode === 'stream' ? ['text', 'streaming', 'image'] : ['text', 'image', 'audio'];
  if (input.requiredFeatures.some(item => !supported.includes(item))) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  if (input.messages.reduce((count, message) => count + message.content.filter(part => part.kind !== 'text').length, 0) > 8) {
    throw new ModelGatewayError('INVALID_REQUEST');
  }
  let hasMedia = false;
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: ModelProtocolContent[] }> = [];
  for (const message of input.messages) {
    const content: ModelProtocolContent[] = [];
    for (const part of message.content) {
      if (part.kind === 'text') { content.push({ kind: 'text', text: part.text }); continue; }
      hasMedia = true;
      if (message.role !== 'user' || !supported.includes(part.kind) || !input.requiredFeatures.includes(part.kind)) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      if (!media) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      let resolved: Awaited<ReturnType<GatewayMediaAttachmentResolver['resolve']>>;
      try { resolved = await media.resolve(structuredClone(context), structuredClone(part), signal); }
      catch (error) { if (error instanceof ModelGatewayError) throw error; throw new ModelGatewayError('CAPABILITY_UNSUPPORTED'); }
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      if (!resolved || resolved.attachmentId !== part.attachmentId || resolved.attachmentRevision !== part.attachmentRevision
        || !supportedMediaType(part.kind, resolved.mediaType) || !(resolved.bytes instanceof Uint8Array)
        || resolved.bytes.byteLength < 1 || resolved.bytes.byteLength > 524288 || !/^[a-f0-9]{64}$/u.test(resolved.contentHash)) {
        throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      }
      const bytes = new Uint8Array(resolved.bytes), hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== resolved.contentHash) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      if (part.kind === 'image') {
        if (resolved.mediaType !== 'image/png' && resolved.mediaType !== 'image/jpeg') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
        content.push({ kind: 'image', mediaType: resolved.mediaType, attachmentId: resolved.attachmentId,
          attachmentRevision: resolved.attachmentRevision, contentHash: hash, data: Buffer.from(bytes).toString('base64') });
      } else {
        if (resolved.mediaType !== 'audio/wav') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
        content.push({ kind: 'audio', mediaType: resolved.mediaType, attachmentId: resolved.attachmentId,
          attachmentRevision: resolved.attachmentRevision, contentHash: hash, data: Buffer.from(bytes).toString('base64') });
      }
    }
    messages.push({ role: message.role, content });
  }
  if (hasMedia && !input.requiredFeatures.some(item => mediaKinds.has(item))) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  const mediaFeature = messages.some(message => typeof message.content !== 'string' && message.content.some(part => part.kind === 'audio')) ? 'audio' as const : hasMedia ? 'image' as const : undefined;
  if (input.requiredFeatures.includes('audio') && mediaFeature !== 'audio') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  if (input.requiredFeatures.includes('image') && mediaFeature !== 'image') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  const features = [...(mediaFeature ? [mediaFeature] : []), ...(mode === 'stream' ? ['streaming' as const] : [])];
  const request = modelProtocolRequestBaseSchema.omit({ model: true }).safeParse({ callId: input.requestId, messages,
    maxOutputTokens: input.maxOutputTokens, ...(features.length ? { features } : {}) });
  if (!request.success) throw new ModelGatewayError('INVALID_REQUEST');
  if (!modelProtocolRequestSchema.safeParse({ ...request.data, model: 'validation-only' }).success) throw new ModelGatewayError('INVALID_REQUEST');
  // Bind the bytes actually authorized and resolved, not just an attachment id.
  // Text-only identities remain unchanged for existing persisted invocations.
  const mediaBinding = hasMedia ? messages.map(message => ({ role: message.role,
    media: message.content.filter(part => part.kind !== 'text').map(part => ({ kind: part.kind,
      attachmentId: part.attachmentId, attachmentRevision: part.attachmentRevision,
      mediaType: part.mediaType, contentHash: part.contentHash })) })) : undefined;
  return { sceneCode: input.sceneCode, intentHash: requestFingerprint({ intent: input, mode,
    ...(mediaBinding ? { media: mediaBinding } : {}) }), request: request.data,
    requiredCapabilities: [...(hasMedia ? ['text' as const, ...(mediaFeature === 'audio' ? ['audio' as const] : ['image' as const])] : ['text' as const]), ...(mode === 'stream' ? ['streaming' as const] : [])],
    omittedOptionalFeatures: input.optionalFeatures.filter(item => !supported.includes(item)) };
}

/** Text-only C03 ingress preparation, not authorization, evidence, routing, or a complete AiGatewayPortDraft.
 * No placeholder model is inserted: only the downstream server-selected route may add it.
 */
export function prepareGatewayTextIntent(value: AiGatewayIntentDraft, serverPolicy: GatewayTextIntentPolicy, mode: 'invoke' | 'stream'): PreparedGatewayTextIntent {
  const parsed = intentSchema.safeParse(value), policy = gatewayTextIntentPolicySchema.safeParse(serverPolicy);
  if (!policy.success || (mode !== 'invoke' && mode !== 'stream')) throw new ModelGatewayError('CONFIG_INVALID');
  if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
  const input = parsed.data;
  if (input.sceneCode !== policy.data.sceneCode) throw new ModelGatewayError('FORBIDDEN');
  if (input.maxOutputTokens > policy.data.maxOutputTokens) throw new ModelGatewayError('INVALID_REQUEST');
  const structured = mode === 'invoke' && policy.data.structuredOutput === true && input.requiredFeatures.includes('structured_output');
  const tools = mode === 'invoke' && policy.data.orderExplainTool === true && input.requiredFeatures.includes('tools');
  const supported: AiGatewayFeatureDraft[] = mode === 'stream' ? ['text', 'streaming'] : structured ? ['text', 'structured_output'] : tools ? ['text', 'tools'] : ['text'];
  if (input.requiredFeatures.some(item => !supported.includes(item))) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  const messages = input.messages.map(message => {
    // Attachments need their own fresh authorization and revision resolution. Never drop them as optional.
    if (message.content.some(part => part.kind !== 'text')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return { role: message.role, content: message.content.map(part => part.kind === 'text' ? part.text : '').join('') };
  });
  const request = modelRequestSchema.omit({ model: true }).safeParse({ callId: input.requestId, messages,
    maxOutputTokens: input.maxOutputTokens, ...(mode === 'stream' ? { features: ['streaming'] } : structured ? { features: ['structuredOutput'] } : tools ? { features: ['tools'] } : {}) });
  if (!request.success) throw new ModelGatewayError('INVALID_REQUEST');
  return { sceneCode: input.sceneCode, intentHash: requestFingerprint({ intent: input, mode }), request: request.data, requiredCapabilities: mode === 'stream' ? ['text', 'streaming'] : structured ? ['text', 'structured_output'] : tools ? ['text', 'tools'] : ['text'],
    omittedOptionalFeatures: input.optionalFeatures.filter(item => !supported.includes(item)) };
}
