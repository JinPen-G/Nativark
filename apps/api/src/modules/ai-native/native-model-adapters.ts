/** Explicit native codec registration, not route selection or capability proof.
 * All codecs share the existing safe transport; replacing these codecs later
 * leaves ModelAdapter, Gateway ownership, usage and business services intact. */
import { ChatCompletionsAdapter, type ModelJsonTransport } from './chat-completions.adapter';
import { ResponsesAdapter, AnthropicMessagesAdapter, type NativeMessagesOptions } from './native-messages.adapter';
import { NATIVE_MODEL_PROTOCOLS, isNativeModelProtocol, type NativeModelProtocol } from './native-model-protocols';
import { createNativeModelEgressTransport } from './model-egress.transport';
import { ModelGatewayError } from './model-gateway.ports';

export function createNativeModelAdapter(protocol: string, options: NativeMessagesOptions = {},
  transport: ModelJsonTransport = createNativeModelEgressTransport()) {
  if (!isNativeModelProtocol(protocol)) throw new ModelGatewayError('CONFIG_INVALID');
  return protocol === 'openai_chat_completions' ? new ChatCompletionsAdapter(transport, options)
    : protocol === 'openai_responses' ? new ResponsesAdapter(transport, options) : new AnthropicMessagesAdapter(transport, options);
}
export function createNativeModelAdapters(protocols: NativeModelProtocol | readonly NativeModelProtocol[] = NATIVE_MODEL_PROTOCOLS,
  options: NativeMessagesOptions = {}, transport: ModelJsonTransport = createNativeModelEgressTransport()) {
  const selected = typeof protocols === 'string' ? [protocols] : [...protocols];
  if (!selected.length || selected.length > NATIVE_MODEL_PROTOCOLS.length || new Set(selected).size !== selected.length)
    throw new ModelGatewayError('CONFIG_INVALID');
  return selected.map(protocol => createNativeModelAdapter(protocol, options, transport));
}
