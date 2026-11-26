/** Original Rental name and tool contract. The codec is shared with the public host. */
import type { AiOrderExplainRequestDraft } from '@rental-os/shared';
import { ModelGatewayError } from '@rental-os/platform-server/ai-gateway';
import { ChatCompletionsProtocolAdapter, type ModelJsonTransport, type ModelProtocolMedia } from './chat-completions.protocol';
import { ChatProtocolPolicy, type ChatProtocolOptions } from './rental-model-protocol-policy';
export { ChatProtocolPolicy, type ChatProtocolOptions } from './rental-model-protocol-policy';
export type { ModelJsonTransport } from './model-egress.transport';

export class ChatCompletionsAdapter extends ChatCompletionsProtocolAdapter<AiOrderExplainRequestDraft> {
  constructor(transport: ModelJsonTransport, options: ChatProtocolOptions & ModelProtocolMedia = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new ModelGatewayError('CONFIG_INVALID');
    const { mediaInput, ...policy } = options;
    super(transport, new ChatProtocolPolicy(policy), { mediaInput });
  }
}
