/** Gateway wire 校验复用公共合同的唯一 schema，业务请求经注册 validator 核验。 */
import { createAiGatewayDraftSchemas, AI_EXECUTION_CONTEXT_SCHEMAS, validateAiLeafSchemaValue,
  type AiExecutionContext, type AiGatewayIntentDraft, type AiGatewayConfigReferenceDraft,
  type AiGatewayResultDraft, type AiGatewayStreamEventDraft } from '@rental-os/platform-contracts/ai-gateway';
import type { GatewayToolResultPolicy } from './gateway-tool-policy.ports';

export function createGatewayContractValidators<TToolRequest = never>(
  toolPolicy?: GatewayToolResultPolicy<TToolRequest>
) {
  const schemas = { ...structuredClone(toolPolicy?.schemaDefinitions ?? {}),
    ...AI_EXECUTION_CONTEXT_SCHEMAS, ...createAiGatewayDraftSchemas(structuredClone(toolPolicy?.toolRequestSchema)) };
  const matches = (name: string, value: unknown) => validateAiLeafSchemaValue(schemas[name], value, schemas);
  const isGatewayResult = (value: unknown): value is AiGatewayResultDraft<TToolRequest> => {
    if (!matches('AiGatewayResultDraft', value)) return false;
    const result = value as AiGatewayResultDraft<TToolRequest>;
    return result.status !== 'completed' || result.toolRequests.every(request => toolPolicy?.validateToolRequest(request) === true);
  };
  return {
    isAiExecutionContext: (value: unknown): value is AiExecutionContext => matches('AiExecutionContext', value),
    isGatewayIntent: (value: unknown): value is AiGatewayIntentDraft => matches('AiGatewayIntentDraft', value),
    isGatewayConfig: (value: unknown): value is AiGatewayConfigReferenceDraft => matches('AiGatewayConfigReferenceDraft', value),
    isGatewayResult,
    isGatewayEvent: (value: unknown): value is AiGatewayStreamEventDraft<TToolRequest> => {
      if (!matches('AiGatewayStreamEventDraft', value)) return false;
      const event = value as AiGatewayStreamEventDraft<TToolRequest>;
      return event.kind !== 'terminal' || isGatewayResult(event.result);
    }
  };
}

export type GatewayContractValidators<TToolRequest = never> = ReturnType<typeof createGatewayContractValidators<TToolRequest>>;
const validators = createGatewayContractValidators();
export const isGatewayIntent = validators.isGatewayIntent;
export const isGatewayConfig = validators.isGatewayConfig;
export const isAiExecutionContext = validators.isAiExecutionContext;
