/** Rental 原工具格式参加者，运行授权与业务结果仍经原 Task/Core 来源复验。 */
import type { GatewayToolResultPolicy } from '@rental-os/platform-server/ai-gateway';
import type { AiLeafSchemaDraft } from '@rental-os/platform-contracts/ai-gateway';
import type { AiOrderExplainRequestDraft } from '@rental-os/shared';
import type { SchemaObject } from '@rental-os/rental-core/http-openapi';
import { AI_NATIVE_COMPONENT_SCHEMAS } from './contracts/ai-native-schemas';
import { isGatewayOrderExplainRequest } from './gateway-contract-validation';
import { nativeOrderToolCallSchema } from './model-input/native-tool-result.ports';

/** 原 OpenAPI schema 与公共 leaf 的嵌套字段按实际结构衔接。 */
function gatewayLeafSchema(schema: SchemaObject): AiLeafSchemaDraft {
  const { properties, items, oneOf, ...fields } = schema;
  return {
    ...fields,
    ...(properties ? { properties: Object.fromEntries(Object.entries(properties)
      .map(([name, child]): [string, AiLeafSchemaDraft] => [name, gatewayLeafSchema(child)])) } : {}),
    ...(items ? { items: gatewayLeafSchema(items) } : {}),
    ...(oneOf ? { oneOf: oneOf.map(gatewayLeafSchema) } : {})
  };
}

export const rentalGatewayToolResultPolicy: GatewayToolResultPolicy<AiOrderExplainRequestDraft> = Object.freeze({
  toolRequestSchema: gatewayLeafSchema(AI_NATIVE_COMPONENT_SCHEMAS.AiOrderExplainRequestDraft),
  schemaDefinitions: { AiOrderExplainInput: gatewayLeafSchema(AI_NATIVE_COMPONENT_SCHEMAS.AiOrderExplainInput) },
  validateToolRequest: isGatewayOrderExplainRequest,
  validateNativeToolCall: (value: unknown) => nativeOrderToolCallSchema.safeParse(value).success
});
