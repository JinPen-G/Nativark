/** Rental原C03兼容出口，版本和数据形状保留，实际公共声明由platform-contracts单源维护。 */
export * from "@rental-os/platform-contracts/ai-gateway";
import type { AiOrderExplainRequestDraft } from "./ai-native";
import type { AiGatewayCallDraft as PlatformCall, AiGatewayResultDraft as PlatformResult, AiGatewayPortDraft as PlatformPort, AiGatewayStreamEventDraft as PlatformEvent } from "@rental-os/platform-contracts/ai-gateway";
export type AiGatewayCallDraft = PlatformCall<AiOrderExplainRequestDraft>;
export type AiGatewayResultDraft = PlatformResult<AiOrderExplainRequestDraft>;
export type AiGatewayPortDraft = PlatformPort<AiOrderExplainRequestDraft>;
export type AiGatewayStreamEventDraft = PlatformEvent<AiOrderExplainRequestDraft>;
