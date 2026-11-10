/** Explicit native codec registration, not route selection or capability proof.
 * All codecs share the existing safe transport; replacing these codecs later
 * leaves ModelAdapter, Gateway ownership, usage and business services intact. */
import { ChatCompletionsAdapter, type ModelJsonTransport } from './chat-completions.adapter';
import { ResponsesAdapter, AnthropicMessagesAdapter, type NativeMessagesOptions } from './native-messages.adapter';
import { NATIVE_MODEL_PROTOCOLS, isNativeModelProtocol, type NativeModelProtocol } from './native-model-protocols';
import { createNativeModelEgressTransport } from './model-egress.transport';
import { ModelGatewayError, type ModelAdapter } from './model-gateway.ports';
import { EmbeddingProbeAdapter } from './embedding-probe.adapter';
export type NativeModelOptions = NativeMessagesOptions & { embeddingProbe?: boolean; nativeToolResults?: boolean };

export function createNativeModelAdapter(protocol: string, options: NativeModelOptions = {},
  transport: ModelJsonTransport = createNativeModelEgressTransport()): ModelAdapter & { readonly evidenceMode: 'live' | 'mock' } {
  if (!isNativeModelProtocol(protocol) || !options || typeof options !== 'object' || Array.isArray(options)) throw new ModelGatewayError('CONFIG_INVALID');
  const { embeddingProbe, nativeToolResults, ...generationOptions } = options;
  if (embeddingProbe !== undefined && typeof embeddingProbe !== 'boolean'
    || nativeToolResults !== undefined && typeof nativeToolResults !== 'boolean') throw new ModelGatewayError('CONFIG_INVALID');
  if (embeddingProbe === true) {
    if (protocol !== 'openai_chat_completions' || Object.keys(generationOptions).length || nativeToolResults === true) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return new EmbeddingProbeAdapter(transport);
  }
  const adapter = protocol === 'openai_chat_completions' ? new ChatCompletionsAdapter(transport, generationOptions)
    : protocol === 'openai_responses' ? new ResponsesAdapter(transport, generationOptions) : new AnthropicMessagesAdapter(transport, generationOptions);
  // The task assembly flag is not a ChatProtocolPolicy field or remote grant.
  // Consume it here and demand the actual codec methods before returning.
  if (nativeToolResults === true && (adapter.supportsNativeToolResults !== true
    || typeof adapter.generateNativeToolResult !== 'function' || typeof adapter.nativeInputBoundHash !== 'function'))
    throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  return adapter;
}
export function createNativeModelAdapters(protocols: NativeModelProtocol | readonly NativeModelProtocol[] = NATIVE_MODEL_PROTOCOLS,
  options: NativeModelOptions = {}, transport: ModelJsonTransport = createNativeModelEgressTransport()) {
  const selected = typeof protocols === 'string' ? [protocols] : [...protocols];
  if (!selected.length || selected.length > NATIVE_MODEL_PROTOCOLS.length || new Set(selected).size !== selected.length)
    throw new ModelGatewayError('CONFIG_INVALID');
  return selected.map(protocol => createNativeModelAdapter(protocol, options, transport));
}
