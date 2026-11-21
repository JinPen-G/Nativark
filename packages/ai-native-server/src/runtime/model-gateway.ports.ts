/** 原 Rental AI 模型类型转接，运行值复用公共 Gateway，工具请求保留原严格类型。 */
import type { AiOrderExplainRequestDraft } from "@rental-os/shared";
import type { AdapterResult as PublicAdapterResult, ModelResponsePolicy as PublicModelResponsePolicy, AdapterStreamEvent as PublicAdapterStreamEvent, NativeAdapterResult as PublicNativeAdapterResult, ModelAdapter as PublicModelAdapter } from "@rental-os/platform-server/ai-gateway";
export { isPlatformGatewayContext, GATEWAY_MAX_INPUT_BYTES, isBoundedGatewayInput, modelRequestSchema, modelProtocolContentSchema, modelProtocolRequestBaseSchema, modelProtocolRequestSchema, modelUsageSchema, modelReasoningEvidenceSchema, modelEmbeddingEvidenceSchema, modelAdapterSupportsCapabilities, ModelGatewayError, ModelAdapterError } from "@rental-os/platform-server/ai-gateway";
export type { ModelFeature, WorkspaceGatewayContext, PlatformGatewayContext, GatewayContext, ModelRequest, ModelProtocolContent, ModelProtocolRequest, ModelUsage, ModelProtocolInvocation, ModelReasoningEvidence, ModelEmbeddingEvidence, ProtocolToolCall, GatewayProfile, GatewayPorts, GatewayErrorCode } from "@rental-os/platform-server/ai-gateway";
export type AdapterResult = PublicAdapterResult<AiOrderExplainRequestDraft>;
export type ModelResponsePolicy = PublicModelResponsePolicy<AiOrderExplainRequestDraft>;
export type AdapterStreamEvent = PublicAdapterStreamEvent<AiOrderExplainRequestDraft>;
export type NativeAdapterResult = PublicNativeAdapterResult<AiOrderExplainRequestDraft>;
export type ModelAdapter = PublicModelAdapter<AiOrderExplainRequestDraft>;
