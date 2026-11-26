/** Original Rental constructors. The protocol implementations remain shared. */
import type { AiOrderExplainRequestDraft } from '@rental-os/shared';
import { ModelGatewayError } from '@rental-os/platform-server/ai-gateway';
import { AnthropicMessagesProtocolAdapter, ResponsesProtocolAdapter } from './native-messages.protocol';
import type { ModelJsonTransport, ModelProtocolMedia } from './chat-completions.protocol';
import { ChatProtocolPolicy, type ChatProtocolOptions } from './rental-model-protocol-policy';

export type NativeMessagesOptions = ChatProtocolOptions & ModelProtocolMedia;
function optionsFor(options: NativeMessagesOptions) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new ModelGatewayError('CONFIG_INVALID');
  const { mediaInput, ...policy } = options;
  return [new ChatProtocolPolicy(policy), { mediaInput }] as const;
}
export class ResponsesAdapter extends ResponsesProtocolAdapter<AiOrderExplainRequestDraft> {
  constructor(transport: ModelJsonTransport, options: NativeMessagesOptions = {}) { super(transport, ...optionsFor(options)); }
}
export class AnthropicMessagesAdapter extends AnthropicMessagesProtocolAdapter<AiOrderExplainRequestDraft> {
  constructor(transport: ModelJsonTransport, options: NativeMessagesOptions = {}) { super(transport, ...optionsFor(options)); }
}
