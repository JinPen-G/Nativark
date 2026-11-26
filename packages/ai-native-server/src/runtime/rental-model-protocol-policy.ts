/** The original order explanation protocol contribution. The generic codecs
 * describe and decode requests; current Rental authority still owns execution. */
import Ajv from 'ajv';
import { AI_CONTRACT_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiOrderExplainRequestDraft } from '@rental-os/shared';
import { ModelGatewayError } from '@rental-os/platform-server/ai-gateway';
import { AI_NATIVE_COMPONENT_SCHEMAS } from './contracts/ai-native-schemas';
import { ModelProtocolPolicy, type StructuredProtocolOptions } from './model-protocol-policy';

export interface ChatProtocolOptions extends StructuredProtocolOptions {
  orderExplainTool?: { name: string; version: typeof AI_TOOL_DRAFT_VERSION };
}

export class ChatProtocolPolicy extends ModelProtocolPolicy<AiOrderExplainRequestDraft> {
  constructor(options: ChatProtocolOptions = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['orderExplainTool', 'structuredOutput'].includes(key)))
      throw new ModelGatewayError('CONFIG_INVALID');
    const { orderExplainTool, ...structured } = options;
    let tool: ChatProtocolOptions['orderExplainTool'];
    try { tool = orderExplainTool && structuredClone(orderExplainTool); }
    catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    if (tool && (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(tool.name) || tool.version !== AI_TOOL_DRAFT_VERSION
      || Object.keys(tool).some(key => !['name', 'version'].includes(key)))) throw new ModelGatewayError('CONFIG_INVALID');
    const parameters = { ...AI_NATIVE_COMPONENT_SCHEMAS.AiOrderExplainInput };
    const validate = tool && new Ajv({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false }).compile(parameters);
    super(structured, tool && { name: tool.name, parameters, nativeResult: tool.name === 'rental_order_explain',
      parse(input) {
        if (!validate?.(input)) throw new ModelGatewayError('INVALID_RESPONSE');
        return { contractVersion: AI_CONTRACT_DRAFT_VERSION, toolCode: 'rental.order.explain', toolVersion: AI_TOOL_DRAFT_VERSION,
          input: input as { orderId: string } };
      }
    });
  }
}
