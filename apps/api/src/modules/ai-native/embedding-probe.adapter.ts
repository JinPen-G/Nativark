/** Bounded native Embeddings codec behind ModelAdapter and the existing safe
 * transport. Probe-only: two server-frozen texts, no generated answer, SDK,
 * arbitrary endpoint, retry or vector export. Protocol reference:
 * https://platform.openai.com/docs/api-reference/embeddings/create */
import { z } from 'zod';
import type { ModelJsonTransport } from './chat-completions.adapter';
import { modelEgressEvidence } from './model-egress.transport';
import { normalizeTenantModelBaseUrl } from './tenant-model-config.service';
import { MODEL_REQUEST_BYTES, MODEL_RESPONSE_BYTES } from './model-response-limits';
import { ModelAdapterError, ModelGatewayError, modelProtocolRequestSchema, modelEmbeddingEvidenceSchema,
  type AdapterResult, type ModelAdapter, type ModelProtocolInvocation, type ModelUsage } from './model-gateway.ports';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const count = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const inputUsage = z.object({ prompt_tokens: count, total_tokens: count }).strict()
  .refine(value => value.prompt_tokens === value.total_tokens);
const invalid = (): never => { throw new ModelGatewayError('INVALID_RESPONSE'); };

export class EmbeddingProbeAdapter implements ModelAdapter {
  readonly provider = 'openai_chat_completions';
  readonly features = Object.freeze(['embedding'] as const);
  get evidenceMode(): 'live' | 'mock' { return modelEgressEvidence(this.transport); }
  constructor(private readonly transport: ModelJsonTransport) {
    if (typeof transport?.post !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async generate(value: ModelProtocolInvocation, credential: string, connection?: Readonly<{ baseUrl: string }>): Promise<AdapterResult> {
    if (!value?.signal || typeof value.signal.aborted !== 'boolean'
      || typeof value.signal.addEventListener !== 'function' || typeof value.signal.removeEventListener !== 'function'
      || value.recordUsage !== undefined && typeof value.recordUsage !== 'function'
      || !connection || typeof credential !== 'string' || !/^[\x21-\x7e]{1,8192}$/u.test(credential)) throw new ModelGatewayError('CONFIG_INVALID');
    const parsed = modelProtocolRequestSchema.safeParse({ callId: value.callId, model: value.model,
      messages: value.messages, maxOutputTokens: value.maxOutputTokens, features: value.features });
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const request = parsed.data;
    if (request.features?.length !== 1 || request.features[0] !== 'embedding'
      || request.messages.length !== 2 || request.messages.some(message => message.role !== 'user' || typeof message.content !== 'string'
        || !message.content || message.content.length > 32000)
      || value.structuredSchemaHash !== undefined || value.expectedInputBoundHash !== undefined) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const input = request.messages.map(message => message.content as string);
    if (input[0] === input[1]) throw new ModelGatewayError('INVALID_REQUEST');
    const body = JSON.stringify({ model: request.model, input, encoding_format: 'float' });
    if (Buffer.byteLength(body) > MODEL_REQUEST_BYTES) throw new ModelGatewayError('INVALID_REQUEST');
    if (value.signal.aborted) throw new ModelGatewayError('CANCELLED');
    const response = await this.transport.post({ url: `${normalizeTenantModelBaseUrl(connection.baseUrl)}/embeddings`,
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body,
      signal: value.signal, maxResponseBytes: MODEL_RESPONSE_BYTES, redirects: 'error' });
    if (response.status === 401 || response.status === 403) throw new ModelAdapterError('AUTHENTICATION_FAILED');
    if (response.status === 429) throw new ModelAdapterError('RATE_LIMITED');
    if (response.status !== 200) throw new ModelAdapterError('PROVIDER_FAILED');
    if (typeof response.body !== 'string' || Buffer.byteLength(response.body) > MODEL_RESPONSE_BYTES) invalid();
    let raw: unknown; try { raw = JSON.parse(response.body); } catch { return invalid(); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
    const result = raw as Record<string, unknown>, reported = inputUsage.safeParse(result.usage);
    if (!reported.success) return invalid();
    // Both native counters attest input-only consumption. Zero generated tokens
    // follows this operation's protocol, not a missing completion counter padded
    // with zero; these same facts are retained even when vector delivery fails.
    const usage: ModelUsage = { inputTokens: reported.data.prompt_tokens, outputTokens: 0 };
    await value.recordUsage?.(usage);
    if (value.signal.aborted) throw new ModelGatewayError('CANCELLED');
    if (result.object !== 'list' || result.model !== request.model || !Array.isArray(result.data) || result.data.length !== 2) return invalid();
    const vectors: number[][] = [];
    for (let index = 0; index < result.data.length; index++) {
      const row = result.data[index];
      if (!row || typeof row !== 'object' || Array.isArray(row) || row.object !== 'embedding' || row.index !== index
        || !Array.isArray(row.embedding) || !row.embedding.length || row.embedding.length > 8192
        || row.embedding.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value))) invalid();
      const vector: number[] = row.embedding, norm = vector.reduce((sum, value) => sum + value * value, 0);
      if (!Number.isFinite(norm) || norm <= 0 || index > 0 && vector.length !== vectors[0].length) invalid();
      vectors.push(vector);
    }
    if (requestFingerprint(vectors[0]) === requestFingerprint(vectors[1])) invalid();
    return { text: '', usage, embeddingEvidence: modelEmbeddingEvidenceSchema.parse({ methodVersion: 'embedding-vector-1',
      vectorCount: 2, dimensions: vectors[0].length, inputHash: requestFingerprint(input), vectorHash: requestFingerprint(vectors) }) };
  }
}
