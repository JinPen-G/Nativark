import { z } from 'zod';
import { createHash } from 'node:crypto';
import { inspectPcmWav } from './pcm-wav';
import { inspectBoundedImage } from './bounded-image';
import type { ResolvedNativeToolResult } from './model-input/native-tool-result.ports';
/** Internal implementation ports, NOT the centrally maintained AIN-C03 wire contract. */
export type ModelFeature = "tools" | "structuredOutput" | "streaming" | "image" | "audio" | "reasoning" | "embedding";
/** Explicit SaaS/platform gateway principal, never an absent tenantId silently
 * interpreted as platform work. Discriminate by field presence: platform
 * contexts carry actorId only, workspace consumers keep the legacy shape. */
export interface WorkspaceGatewayContext { tenantId: string; workspaceId: string; actorId: string; }
export interface PlatformGatewayContext { actorId: string; }
export type GatewayContext = WorkspaceGatewayContext | PlatformGatewayContext;
export function isPlatformGatewayContext(value: Readonly<GatewayContext>): value is PlatformGatewayContext {
  return !('tenantId' in value) && !('workspaceId' in value) && typeof value.actorId === 'string' && value.actorId.length > 0;
}
/** Content bytes, not provider tokens or the serialized HTTP envelope. Keep
 * the existing media ceiling for every ingress, including text-only calls. */
export const GATEWAY_MAX_INPUT_BYTES = 900_000;
export function isBoundedGatewayInput(messages: readonly { content: string | readonly (
  { kind: 'text'; text: string } | { kind: 'image' | 'audio'; data?: string }
)[] }[]): boolean {
  let bytes = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') bytes += Buffer.byteLength(message.content, 'utf8');
    else for (const part of message.content) {
      // Unresolved attachment references are authorized/read later. Their
      // actual base64 content must pass this same bound after resolution.
      bytes += part.kind === 'text' ? Buffer.byteLength(part.text, 'utf8') : part.data?.length ?? 0;
      if (bytes > GATEWAY_MAX_INPUT_BYTES) return false;
    }
    if (bytes > GATEWAY_MAX_INPUT_BYTES) return false;
  }
  return true;
}
export interface ModelRequest {
  callId: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxOutputTokens: number;
  features?: ModelFeature[];
  /** Server-pinned protocol response contract, not an Agent schema. */
  structuredSchemaHash?: string;
}
/** One existing internal request validator shared by Gateway and protocol adapters.
 * Not a new public contract or an authorization decision. */
export const modelRequestSchema = z.object({
  callId: z.string().min(1).max(128).regex(/^[\w.:-]+$/u),
  model: z.string().min(1).max(256).regex(/^[\w./:-]+$/u),
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(32000) }).strict()).min(1).max(64)
    .refine(isBoundedGatewayInput, 'Protocol input exceeds its byte limit'),
  maxOutputTokens: z.number().int().positive().max(32768),
  features: z.array(z.enum(['tools', 'structuredOutput', 'streaming'])).max(3).optional(),
  structuredSchemaHash: z.string().regex(/^[a-f0-9]{64}$/u).optional()
}).strict();
const mediaReference = {
  attachmentId: z.string().min(1).max(128).regex(/^[\w.:-]+$/u),
  attachmentRevision: z.number().int().positive().max(4294967294),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  data: z.string().min(4).max(699052).regex(/^[A-Za-z0-9+/]+={0,2}$/u)
};
export const modelProtocolContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(32000) }).strict(),
  z.object({ kind: z.literal('image'), mediaType: z.enum(['image/png', 'image/jpeg']), ...mediaReference }).strict(),
  z.object({ kind: z.literal('audio'), mediaType: z.literal('audio/wav'), ...mediaReference }).strict()
]);
export type ModelProtocolContent = z.infer<typeof modelProtocolContentSchema>;
// Resolved protocol bytes are not a public attachment authorization or a task input.
export const modelProtocolRequestBaseSchema = modelRequestSchema.extend({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']),
    content: z.union([z.string().max(32000), z.array(modelProtocolContentSchema).min(1).max(16)]) }).strict()).min(1).max(64),
  features: z.array(z.enum(['tools', 'structuredOutput', 'streaming', 'image', 'audio', 'reasoning', 'embedding'])).max(7).optional()
});
export const modelProtocolRequestSchema = modelProtocolRequestBaseSchema.superRefine((input, ctx) => {
  let mediaCount = 0;
  for (const message of input.messages) {
    if (typeof message.content !== 'string') mediaCount += message.content.filter(part => part.kind !== 'text').length;
  }
  if (mediaCount > 8 || !isBoundedGatewayInput(input.messages)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Protocol input exceeds its byte limit' });
    return;
  }
  for (const message of input.messages) {
    if (typeof message.content === 'string') continue;
    for (const part of message.content) {
      if (part.kind === 'text') continue;
      if (message.role !== 'user' || !input.features?.includes(part.kind)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Media requires an explicit user-input capability' });
        continue;
      }
      const bytes = Buffer.from(part.data, 'base64');
      if (bytes.length > 524288 || bytes.toString('base64') !== part.data
        || createHash('sha256').update(bytes).digest('hex') !== part.contentHash) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Media content does not match its bounded digest' });
      }
      if (part.kind === 'audio' && !inspectPcmWav(bytes)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Audio must be a complete bounded PCM WAV' });
      }
      if (part.kind === 'image' && inspectBoundedImage(bytes)?.mediaType !== part.mediaType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Image must be a bounded PNG/JPEG container with matching dimensions and type' });
      }
    }
  }
});
export type ModelProtocolRequest = z.infer<typeof modelProtocolRequestSchema>;
/** Original protocol counters. Cache reads/writes are part of inputTokens,
 * not extra tokens; their rates cannot be inferred from a plain-input price. */
export interface ModelUsage { inputTokens: number; outputTokens: number;
  billingDetails?: { cachedInputTokens: number; cacheCreationInputTokens: number }; }
const usageCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const modelUsageSchema = z.object({ inputTokens: usageCount, outputTokens: usageCount,
  billingDetails: z.object({ cachedInputTokens: usageCount, cacheCreationInputTokens: usageCount }).strict().optional()
}).strict().refine(value => !value.billingDetails || BigInt(value.billingDetails.cachedInputTokens)
  + BigInt(value.billingDetails.cacheCreationInputTokens) <= BigInt(value.inputTokens));
/** Trusted in-process protocol callback, excluded from serialized requests.
 * Counters survive rejected text; this does not authorize text or settlement. */
export type ModelProtocolInvocation = Readonly<ModelProtocolRequest> & {
  signal: AbortSignal; recordUsage?: (usage: ModelUsage) => Promise<void>;
  /** Trusted reservation's counted input binding; never sent to the provider. */
  expectedInputBoundHash?: string;
};
import type { AiOrderExplainRequestDraft } from '@rental-os/shared';
/** Native Responses output-channel evidence, not a thought transcript or an
 * extra accounting unit. reasoningTokens is already included in outputTokens. */
export const modelReasoningEvidenceSchema = z.object({ methodVersion: z.literal('reasoning-channel-1'),
  itemCount: z.number().int().min(1).max(32), reasoningTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  channelHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export type ModelReasoningEvidence = z.infer<typeof modelReasoningEvidenceSchema>;
/** Opaque native vector evidence for a bounded server-owned probe. Vectors stay
 * in the adapter, not in public text/JSON or financial quantity fields. */
export const modelEmbeddingEvidenceSchema = z.object({ methodVersion: z.literal('embedding-vector-1'),
  vectorCount: z.literal(2), dimensions: z.number().int().min(1).max(8192),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u), vectorHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export type ModelEmbeddingEvidence = z.infer<typeof modelEmbeddingEvidenceSchema>;
export interface AdapterResult { text: string; usage?: ModelUsage; toolRequests?: AiOrderExplainRequestDraft[]; structuredOutput?: unknown;
  reasoningEvidence?: ModelReasoningEvidence; embeddingEvidence?: ModelEmbeddingEvidence; }
export interface ProtocolToolCall { id: string; type: 'function'; function: { name: string; arguments: string }; }
/** Server-built protocol policy only. Never loaded from model text or request fields. */
export interface ModelResponsePolicy {
  readonly tools: boolean; readonly structured: boolean;
  parse(text: string, calls: readonly ProtocolToolCall[]): Pick<AdapterResult, 'toolRequests' | 'structuredOutput'>;
}
/** Internal protocol events, not task/approval/business completion events. */
export type AdapterStreamEvent = { kind: "text_delta"; delta: string } | { kind: "result"; result: AdapterResult };
export interface NativeAdapterResult extends AdapterResult {
  /** Original validated call identity remains private until its encrypted
   * binding is captured; public C03 output must not expose this field. */
  nativeToolCalls?: ProtocolToolCall[];
}
export interface ModelAdapter {
  readonly provider: string;
  /** True only with real original-call/result encoding, not a remote grant. */
  readonly supportsNativeToolResults?: boolean;
  /** Same original invocation's private tool-result wire, never a new HTTP loop
   * or a user-text snapshot fallback. Missing implementation is unavailable. */
  generateNativeToolResult?(input: ModelProtocolInvocation, credential: string,
    value: ResolvedNativeToolResult, connection?: Readonly<{ baseUrl: string }>): Promise<NativeAdapterResult>;
  /** Hash of the actual native input-determining wire. A text hash cannot
   * certify this material; absence keeps recorded-token dispatch unavailable. */
  nativeInputBoundHash?(input: Readonly<ModelProtocolRequest>, value: ResolvedNativeToolResult): string;
  readonly structuredSchemaHash?: string;
  readonly features: readonly ModelFeature[];
  /** Exact input-determining wire material; absence cannot consume a provider
   * count receipt. Server adapter only, never a caller-supplied token estimate. */
  inputBoundHash?(input: Readonly<ModelProtocolRequest>, streaming: boolean): string;
  generate(input: ModelProtocolInvocation, credential: string,
    connection?: Readonly<{ baseUrl: string }>): Promise<AdapterResult>;
  stream?(input: ModelProtocolInvocation, credential: string,
    connection?: Readonly<{ baseUrl: string }>): AsyncIterable<AdapterStreamEvent>;
}
/** Local protocol support is separate from a remotely verified profile.
 * Reject an absent implementation before admission/reservation, not after the
 * invocation has already acquired a dispatch token and become uncertain. */
export function modelAdapterSupportsCapabilities(adapter: ModelAdapter | undefined, capabilities: readonly string[]): boolean {
  if (!adapter || typeof adapter.generate !== 'function' || !Array.isArray(adapter.features)) return false;
  const features: Readonly<Record<string, ModelFeature>> = { streaming: 'streaming', tools: 'tools',
    structured_output: 'structuredOutput', vision: 'image', audio: 'audio', reasoning: 'reasoning', embedding: 'embedding' };
  // Embedding is the probe-only non-text operation here. Sharing the generate
  // seam must not advertise a text implementation before admission.
  return capabilities.every(capability => capability === 'text'
    ? !adapter.features.includes('embedding')
    : Object.hasOwn(features, capability) && adapter.features.includes(features[capability])
      && (capability !== 'streaming' || typeof adapter.stream === 'function'));
}
export interface GatewayProfile {
  enabled: boolean;
  provider: string;
  /** Registry key identifies protocol, not a fixed supplier. Resolved by the server. */
  baseUrl?: string;
  allowedModels: string[];
  credentialRef: string;
  timeoutMs: number;
  maxConcurrent: number;
  maxOutputTokens: number;
}
export interface GatewayPorts {
  /** Required AIN-04 adapter: must resolve fresh server identity/scope, never model claims. */
  authorize(context: GatewayContext, signal?: AbortSignal): Promise<void>;
  profile(context: GatewayContext, signal?: AbortSignal): Promise<GatewayProfile>;
  /** Required server vault adapter. Never provided by request payload. */
  credential(reference: string, context: GatewayContext, signal?: AbortSignal): Promise<string>;
  /** Required AIN-11 adapter; no free/unmetered fallback is supplied. */
  budget: {
    reserve(context: GatewayContext, request: { callId: string; model: string; maxOutputTokens: number }, signal?: AbortSignal): Promise<string>;
    settle(reservationId: string, usage: ModelUsage): Promise<void>;
    release(reservationId: string): Promise<void>;
    reconcile(reservationId: string, reason: string): Promise<void>;
  };
}
export type GatewayErrorCode = "INVALID_REQUEST" | "FORBIDDEN" | "DISABLED" | "MODEL_NOT_ALLOWED" |
  "CAPABILITY_UNSUPPORTED" | "PROVIDER_UNAVAILABLE" | "CONFIG_INVALID" | "RATE_LIMITED" |
  "CREDENTIAL_UNAVAILABLE" | "BUDGET_UNAVAILABLE" | "AUTHENTICATION_FAILED" |
  "TIMEOUT" | "CANCELLED" | "PROVIDER_FAILED" | "INVALID_RESPONSE" | "ACCOUNTING_PENDING";
export class ModelGatewayError extends Error {
  constructor(readonly code: GatewayErrorCode) { super(code); this.name = "ModelGatewayError"; }
}
/** Adapters map vendor errors to this type; never pass vendor payload/messages to callers. */
export class ModelAdapterError extends Error {
  constructor(readonly code: "AUTHENTICATION_FAILED" | "RATE_LIMITED" | "PROVIDER_FAILED") {
    super(code); this.name = "ModelAdapterError";
  }
}
