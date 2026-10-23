/** Provider count-tokens codec for the frozen original model input.
 * Only protocols whose provider exposes a real counting endpoint are
 * supported; OpenAI-compatible endpoints have none and no certified
 * tokenizer dependency exists in this lockfile, so those configurations
 * fail closed with a precise reason instead of a text-length guess.
 * The request encoding mirrors AnthropicMessagesAdapter's input-determining
 * fields (model, system, messages, tools, tool_choice); max_tokens/stream and
 * output-format constraints change no input token and are deliberately absent
 * from the count request. Replacing the adapter later only touches this codec. */
import { z } from 'zod';
import { ChatProtocolPolicy, type ModelJsonTransport } from '../chat-completions.adapter';
import { normalizeTenantModelBaseUrl } from '../tenant-model-config.service';
import { ModelGatewayError, modelProtocolRequestSchema, type ModelProtocolRequest } from '../model-gateway.ports';
import { MODEL_REQUEST_BYTES } from '../model-response-limits';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

export type CountTokensProtocol = 'anthropic_messages';
export interface CountTokensSupport {
  supported: boolean;
  protocol: string;
  method?: 'provider_count_tokens_receipt';
  /** Precise missing dependency for unsupported configurations; never a
   * character count, byte estimate or model self-report substituted as a bound. */
  missing?: 'provider_count_endpoint_absent' | 'certified_tokenizer_dependency_absent';
}
/** Support is per protocol, not per supplier claim: an OpenAI-compatible base
 * URL does not become countable by naming, and no tokenizer dependency in this
 * lockfile is certified for any configured model. */
export function countTokensSupport(protocol: string): CountTokensSupport {
  return protocol === 'anthropic_messages'
    ? { supported: true, protocol, method: 'provider_count_tokens_receipt' }
    : { supported: false, protocol,
      missing: protocol === 'openai_chat_completions' || protocol === 'openai_responses'
        ? 'provider_count_endpoint_absent' : 'certified_tokenizer_dependency_absent' };
}
const countResponse = z.object({ input_tokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });

export interface CountTokensRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
  requestHash: string;
}

/** Build the count request from the same frozen protocol input the original
 * dispatch will send. `features` must be the invocation's declared features;
 * media parts are rejected before any egress because the bound evidence only
 * attests plain text. */
export function anthropicCountTokensRequest(input: Readonly<ModelProtocolRequest>, policy: ChatProtocolPolicy,
  baseUrl: string): CountTokensRequest {
  const parsed = modelProtocolRequestSchema.safeParse(structuredClone(input));
  if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
  const request = parsed.data;
  const features = request.features ?? [];
  if (features.some(feature => feature !== 'tools' && feature !== 'structuredOutput'))
    throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  if (request.structuredSchemaHash !== undefined && !features.includes('structuredOutput'))
    throw new ModelGatewayError('CONFIG_INVALID');
  // ChatProtocolPolicy.body() throws when a feature lacks a registered server
  // policy; an unregistered structured-output schema stays uncountable.
  const supplied = policy.body(features);
  const tool = (supplied.tools as Array<{ function: { name: string; parameters: unknown } }> | undefined)?.[0]?.function;
  if (features.includes('structuredOutput') && features.includes('tools'))
    throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  // System instructions belong before the conversation, exactly like the
  // messages adapter; reordering would count a different input.
  let conversation = false;
  const system: string[] = [], messages: unknown[] = [];
  for (const message of request.messages) {
    if (message.role === 'system') {
      if (conversation || typeof message.content !== 'string') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      system.push(message.content);
      continue;
    }
    conversation = true;
    messages.push({ role: message.role, content: typeof message.content === 'string' ? message.content
      : message.content.map(part => part.kind === 'text'
        ? { type: 'text', text: part.text } : { type: 'unsupported_media' }) });
  }
  if (!messages.length || JSON.stringify(messages).includes('unsupported_media')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  const body = JSON.stringify({ model: request.model, messages,
    ...(system.length ? { system: system.map(value => ({ type: 'text', text: value })) } : {}),
    ...(tool ? { tools: [{ name: tool.name, input_schema: tool.parameters, strict: true }],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true } } : {}) });
  if (Buffer.byteLength(body) > MODEL_REQUEST_BYTES) throw new ModelGatewayError('INVALID_REQUEST');
  const base = normalizeTenantModelBaseUrl(baseUrl);
  const url = `${base}${new URL(base).pathname.endsWith('/v1') ? '' : '/v1'}/messages/count_tokens`;
  return { url, headers: { 'x-api-key': '', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body, requestHash: requestFingerprint({ url: new URL(url).pathname, body }) };
}

/** Strict response validation. An unparseable or credential-leaking body is
 * INVALID_RESPONSE, never a zero count; transport-level failures stay with the
 * transport's own error codes so unknown outcomes are not converted here. */
export function parseCountTokensResponse(body: string, credential: string): number {
  if (typeof body !== 'string' || body.includes(credential)) throw new ModelGatewayError('INVALID_RESPONSE');
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { throw new ModelGatewayError('INVALID_RESPONSE'); }
  const parsed = countResponse.safeParse(raw && typeof raw === 'object' && 'input_tokens' in raw ? raw : null);
  if (!parsed.success) throw new ModelGatewayError('INVALID_RESPONSE');
  return parsed.data.input_tokens;
}

/** One bounded POST, no retry. The transport owns DNS pinning, redirect
 * refusal, timeouts and cancellation; this codec never fetches on its own. */
export async function postCountTokens(transport: ModelJsonTransport, request: CountTokensRequest,
  credential: string, signal: AbortSignal, maxResponseBytes: number): Promise<{ status: number; body: string }> {
  if (!transport || typeof transport.post !== 'function' || signal.aborted) throw new ModelGatewayError(signal?.aborted ? 'CANCELLED' : 'CONFIG_INVALID');
  return transport.post({ url: request.url, headers: { ...request.headers, 'x-api-key': credential },
    body: request.body, signal, maxResponseBytes, redirects: 'error' });
}
