import { z } from 'zod';
import { createHash } from 'node:crypto';
/** Internal implementation ports, NOT the centrally maintained AIN-C03 wire contract. */
export type ModelFeature = "tools" | "structuredOutput" | "streaming" | "image" | "audio";
export interface GatewayContext { tenantId: string; workspaceId: string; actorId: string; }
export interface ModelRequest {
  callId: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxOutputTokens: number;
  features?: ModelFeature[];
}
/** One existing internal request validator shared by Gateway and protocol adapters.
 * Not a new public contract or an authorization decision. */
export const modelRequestSchema = z.object({
  callId: z.string().min(1).max(128).regex(/^[\w.:-]+$/u),
  model: z.string().min(1).max(256).regex(/^[\w./:-]+$/u),
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(32000) }).strict()).min(1).max(64),
  maxOutputTokens: z.number().int().positive().max(32768),
  features: z.array(z.enum(['tools', 'structuredOutput', 'streaming'])).max(3).optional()
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
  features: z.array(z.enum(['tools', 'structuredOutput', 'streaming', 'image', 'audio'])).max(5).optional()
});
export const modelProtocolRequestSchema = modelProtocolRequestBaseSchema.superRefine((input, ctx) => {
  let size = 0, mediaCount = 0;
  for (const message of input.messages) {
    if (typeof message.content === 'string') size += Buffer.byteLength(message.content);
    else for (const part of message.content) {
      size += part.kind === 'text' ? Buffer.byteLength(part.text) : part.data.length;
      if (part.kind !== 'text') mediaCount++;
    }
  }
  if (mediaCount > 8 || mediaCount > 0 && size > 900000) {
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
    }
  }
});
export type ModelProtocolRequest = z.infer<typeof modelProtocolRequestSchema>;
export interface ModelUsage { inputTokens: number; outputTokens: number; }
import type { AiOrderExplainRequestDraft } from '@rental-os/shared';
export interface AdapterResult { text: string; usage?: ModelUsage; toolRequests?: AiOrderExplainRequestDraft[]; structuredOutput?: unknown; }
export interface ProtocolToolCall { id: string; type: 'function'; function: { name: string; arguments: string }; }
/** Server-built protocol policy only. Never loaded from model text or request fields. */
export interface ModelResponsePolicy {
  readonly tools: boolean; readonly structured: boolean;
  parse(text: string, calls: readonly ProtocolToolCall[]): Pick<AdapterResult, 'toolRequests' | 'structuredOutput'>;
}
/** Internal protocol events, not task/approval/business completion events. */
export type AdapterStreamEvent = { kind: "text_delta"; delta: string } | { kind: "result"; result: AdapterResult };
export interface ModelAdapter {
  readonly provider: string;
  readonly features: readonly ModelFeature[];
  generate(input: Readonly<ModelProtocolRequest> & { signal: AbortSignal }, credential: string,
    connection?: Readonly<{ baseUrl: string }>): Promise<AdapterResult>;
  stream?(input: Readonly<ModelProtocolRequest> & { signal: AbortSignal }, credential: string,
    connection?: Readonly<{ baseUrl: string }>): AsyncIterable<AdapterStreamEvent>;
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
