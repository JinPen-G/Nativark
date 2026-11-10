/** Opt-in read-only publication of original order material and cited sources.
 * Original request/model v1 hashes and transports remain unchanged. Neither a
 * material reference nor this wire contract grants actor/scope or funds rights. */
import { AI_SCENE_REQUEST_HTTP_DRAFT, type AiSceneRequestReadDraft, type AiSceneRequestReceiptDraft } from './ai-scene-request-draft';
import { AI_SCENE_REQUEST_DRAFT_SCHEMAS } from './ai-scene-request-draft-schemas';
import { AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION, AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2,
  type AiOrderEvidenceFieldV2, type AiOrderSourceReadV2 } from './ai-business-material-draft';
import { leafClosed, leafEnum, leafText, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export interface AiOriginalOrderSourceReopenV2 extends AiSceneRequestReadDraft {
  materialVersion: typeof AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION;
  version: string;
  field: AiOrderEvidenceFieldV2;
}
export interface AiOriginalOrderSourceReadV2 {
  original: AiSceneRequestReceiptDraft;
  source: AiOrderSourceReadV2;
  execution: 'not_attempted';
}
export const AI_ORDER_EXPLANATION_HTTP_V2 = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/order-explanation-v2`, method: 'POST',
  material: 'material', source: 'source'
} as const);
export const AI_ORDER_EXPLANATION_HTTP_CONTRACTS_V2 = Object.freeze({
  material: { request: 'AiSceneRequestReadDraft', response: 'AiOrderSceneTaskMaterialV2', successStatus: 200 },
  source: { request: 'AiOriginalOrderSourceReopenV2', response: 'AiOriginalOrderSourceReadV2', successStatus: 200 }
} as const);
const ref = (name: string): AiLeafSchemaDraft => ({ $ref: `#/components/schemas/${name}` });
export const AI_ORDER_EXPLANATION_HTTP_SCHEMAS_V2: Record<string, AiLeafSchemaDraft> = {
  AiOriginalOrderSourceReopenV2: leafClosed({ ...AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReadDraft.properties!,
    materialVersion: leafEnum(AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION), version: leafText(191),
    field: leafEnum(...AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2) }),
  AiOriginalOrderSourceReadV2: leafClosed({ original: ref('AiSceneRequestReceiptDraft'), source: ref('AiOrderSourceReadV2'),
    execution: leafEnum('not_attempted') })
};
