/** Private native continuation encoding shared by the existing three codecs.
 * Only the original Task/Core resolver supplies this material. This layer checks
 * protocol consistency; it grants no authority, dispatch, retry or token count. */
import { ModelGatewayError, type ModelProtocolRequest } from './model-gateway.ports';
import { resolvedNativeToolResultSchema, type ResolvedNativeToolResult } from './model-input/native-tool-result.ports';
import { MODEL_REQUEST_BYTES } from './model-response-limits';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

type NativeProtocol = 'openai_chat_completions' | 'openai_responses' | 'anthropic_messages';

export function encodeNativeToolResultBody(protocol: NativeProtocol, input: Readonly<ModelProtocolRequest>,
  body: string, material: ResolvedNativeToolResult): string {
  const parsed = resolvedNativeToolResultSchema.safeParse(structuredClone(material));
  if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
  const value = parsed.data;
  if (input.features?.length !== 1 || input.features[0] !== 'tools' || input.structuredSchemaHash !== undefined)
    throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  const originalMessages = value.originalIntent.messages.map(message => {
    if (message.content.some(part => part.kind !== 'text')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return { role: message.role, content: message.content.map(part => part.kind === 'text' ? part.text : '').join('') };
  });
  if (requestFingerprint(input.messages) !== requestFingerprint(originalMessages))
    throw new ModelGatewayError('INVALID_REQUEST');
  const wire = JSON.parse(body) as Record<string, unknown>, call = value.call;
  if (wire.stream !== false || !Array.isArray(wire.tools) || wire.tools.length !== 1)
    throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  // Keep the original call ID and exact result bytes. Neither a public user-text
  // snapshot nor a provider-held previous_response_id substitutes for this pair.
  if (protocol === 'openai_chat_completions') {
    if (!Array.isArray(wire.messages)) throw new ModelGatewayError('INVALID_REQUEST');
    wire.messages.push({ role: 'assistant', content: null, tool_calls: [structuredClone(call)] },
      { role: 'tool', tool_call_id: call.id, content: value.resultJson });
  } else if (protocol === 'openai_responses') {
    if (!Array.isArray(wire.input)) throw new ModelGatewayError('INVALID_REQUEST');
    wire.input.push({ type: 'function_call', call_id: call.id, name: call.function.name,
      arguments: call.function.arguments }, { type: 'function_call_output', call_id: call.id, output: value.resultJson });
  } else {
    if (!Array.isArray(wire.messages)) throw new ModelGatewayError('INVALID_REQUEST');
    wire.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: call.id,
      name: call.function.name, input: JSON.parse(call.function.arguments) }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: value.resultJson }] });
  }
  const encoded = JSON.stringify(wire);
  if (Buffer.byteLength(encoded, 'utf8') > MODEL_REQUEST_BYTES) throw new ModelGatewayError('INVALID_REQUEST');
  return encoded;
}

/** Exact input-determining Messages fields shared by native generation and
 * counting. The endpoint counts this original call/result pair, not a user-text
 * approximation. Output limits and transport callbacks are not counted input. */
export function nativeMessagesCountBody(body: string): string {
  const wire = JSON.parse(body) as Record<string, unknown>;
  if (!Array.isArray(wire.messages) || !Array.isArray(wire.tools) || wire.output_config !== undefined)
    throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  const encoded = JSON.stringify({ model: wire.model, messages: wire.messages,
    ...(wire.system !== undefined ? { system: wire.system } : {}), tools: wire.tools, tool_choice: wire.tool_choice });
  if (Buffer.byteLength(encoded, 'utf8') > MODEL_REQUEST_BYTES) throw new ModelGatewayError('INVALID_REQUEST');
  return encoded;
}

/** Wire binding only, never a count/price estimate. Messages has the original
 * provider-count material hash; other protocols still lack a certified count
 * source here and cannot borrow a Messages or plain-text receipt. */
export function nativeToolResultInputHash(protocol: NativeProtocol, body: string): string {
  if (protocol === 'anthropic_messages') return requestFingerprint({ url: '/v1/messages/count_tokens', body: nativeMessagesCountBody(body) });
  const wire = JSON.parse(body) as Record<string, unknown>;
  return requestFingerprint({ methodVersion: 'native-tool-result-input-1', protocol, model: wire.model,
    ...(protocol === 'openai_responses' ? { input: wire.input } : { messages: wire.messages }),
    ...(wire.system !== undefined ? { system: wire.system } : {}), tools: wire.tools,
    ...(wire.tool_choice !== undefined ? { tool_choice: wire.tool_choice } : {}),
    ...(wire.parallel_tool_calls !== undefined ? { parallel_tool_calls: wire.parallel_tool_calls } : {}) });
}
