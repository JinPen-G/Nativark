/** 原Rental C03 schema与叶构建器兼容出口，工具槽继续绑定原订单解释契约。 */
export { leafRef, leafEnum, leafText, leafId, leafInt, leafList, leafClosed, leafTime, createAiGatewayDraftSchemas } from "@rental-os/platform-contracts/ai-gateway";
export type { AiLeafSchemaDraft } from "@rental-os/platform-contracts/ai-gateway";
import { createAiGatewayDraftSchemas, leafRef } from "@rental-os/platform-contracts/ai-gateway";
export const AI_GATEWAY_DRAFT_SCHEMAS = createAiGatewayDraftSchemas(leafRef("AiOrderExplainRequestDraft"));
