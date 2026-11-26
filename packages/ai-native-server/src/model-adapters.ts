/** Host-side registration of the original native codecs and controlled HTTPS.
 * A protocol name is not capability evidence, permission or a provider route. */
import { ModelGatewayError, type ModelAdapter } from '@rental-os/platform-server/ai-gateway';
import { NATIVE_MODEL_PROTOCOLS, isNativeModelProtocol, type NativeModelProtocol } from './runtime/native-model-protocols';
import { createNativeModelEgressTransport, type ModelJsonTransport } from './runtime/model-egress.transport';
import { ModelProtocolPolicy, type StructuredProtocolOptions } from './runtime/model-protocol-policy';
import { ChatCompletionsProtocolAdapter, type ModelProtocolMedia } from './runtime/chat-completions.protocol';
import { AnthropicMessagesProtocolAdapter, ResponsesProtocolAdapter } from './runtime/native-messages.protocol';
import { EmbeddingProbeAdapter } from './runtime/embedding-probe.adapter';

export { NATIVE_MODEL_PROTOCOLS, type NativeModelProtocol };
export type PublicModelAdapter = ModelAdapter<never> & { readonly evidenceMode: 'live' | 'mock' };
export type PublicModelAdapterOptions = StructuredProtocolOptions & ModelProtocolMedia & { embeddingProbe?: boolean };

export function createPublicModelAdapters(protocols: NativeModelProtocol | readonly NativeModelProtocol[] = NATIVE_MODEL_PROTOCOLS,
  options: PublicModelAdapterOptions = {}, transport: ModelJsonTransport = createNativeModelEgressTransport()): readonly PublicModelAdapter[] {
  const selected = typeof protocols === 'string' ? [protocols] : [...protocols];
  if (!selected.length || selected.length > NATIVE_MODEL_PROTOCOLS.length || new Set(selected).size !== selected.length
    || selected.some(protocol => !isNativeModelProtocol(protocol)) || !options || typeof options !== 'object' || Array.isArray(options))
    throw new ModelGatewayError('CONFIG_INVALID');
  const { mediaInput, embeddingProbe, ...structured } = options;
  if (embeddingProbe !== undefined && typeof embeddingProbe !== 'boolean') throw new ModelGatewayError('CONFIG_INVALID');
  if (embeddingProbe) {
    if (selected.length !== 1 || selected[0] !== 'openai_chat_completions' || mediaInput !== undefined || Object.keys(structured).length)
      throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return Object.freeze([new EmbeddingProbeAdapter(transport)]);
  }
  return Object.freeze(selected.map(protocol => {
    const policy = new ModelProtocolPolicy(structured), media = { mediaInput };
    switch (protocol) {
      case 'openai_chat_completions': return new ChatCompletionsProtocolAdapter(transport, policy, media);
      case 'openai_responses': return new ResponsesProtocolAdapter(transport, policy, media);
      case 'anthropic_messages': return new AnthropicMessagesProtocolAdapter(transport, policy, media);
    }
  }));
}
