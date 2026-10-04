import { z } from 'zod';
import type { AiGatewayIntentDraft, AiGatewayFeatureDraft } from '@rental-os/shared';
import { ModelGatewayError, modelRequestSchema } from './model-gateway.ports';
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
export const gatewayTextIntentPolicySchema = z.object({ sceneCode: id, maxOutputTokens: z.number().int().min(1).max(32768) }).strict();
export const gatewayTextIntentBindingSchema = gatewayTextIntentPolicySchema.extend({ routeScene: z.enum(['chat', 'builder', 'vision', 'knowledge', 'reasoning']) }).strict();
export type GatewayTextIntentBinding = z.infer<typeof gatewayTextIntentBindingSchema>;
export interface GatewayTextIntentPolicy { sceneCode: string; maxOutputTokens: number; }
export interface PreparedGatewayTextIntent {
  sceneCode: string;
  intentHash: string;
  request: Omit<z.infer<typeof modelRequestSchema>, 'model'>;
  requiredCapabilities: Array<'text' | 'streaming'>;
  omittedOptionalFeatures: AiGatewayFeatureDraft[];
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
  const supported: AiGatewayFeatureDraft[] = mode === 'stream' ? ['text', 'streaming'] : ['text'];
  if (input.requiredFeatures.some(item => !supported.includes(item))) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  const messages = input.messages.map(message => {
    // Attachments need their own fresh authorization and revision resolution. Never drop them as optional.
    if (message.content.some(part => part.kind !== 'text')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return { role: message.role, content: message.content.map(part => part.kind === 'text' ? part.text : '').join('') };
  });
  const request = modelRequestSchema.omit({ model: true }).safeParse({ callId: input.requestId, messages,
    maxOutputTokens: input.maxOutputTokens, ...(mode === 'stream' ? { features: ['streaming'] } : {}) });
  if (!request.success) throw new ModelGatewayError('INVALID_REQUEST');
  return { sceneCode: input.sceneCode, intentHash: requestFingerprint({ intent: input, mode }), request: request.data, requiredCapabilities: mode === 'stream' ? ['text', 'streaming'] : ['text'],
    omittedOptionalFeatures: input.optionalFeatures.filter(item => !supported.includes(item)) };
}
