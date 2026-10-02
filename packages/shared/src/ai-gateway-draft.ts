import type { AiExecutionContext, AiOrderExplainRequestDraft, AiPlatformScope } from "./ai-native";
/** AIN-C03 draft only; public contract, not a model/authorization/connection implementation. */
export const AI_GATEWAY_DRAFT_VERSION = "ain-c03-draft-2" as const;
export type AiGatewayFeatureDraft = "text" | "tools" | "structured_output" | "image" | "audio" | "streaming" | "embedding" | "reasoning";
export type AiGatewayServiceModeDraft = "platform_managed" | "tenant_managed";
/** Probe evidence only, never authorization. Unverified is not unsupported or supported. */
export type AiGatewayCapabilityAssessmentDraft = {
  feature: AiGatewayFeatureDraft;
} & (
  | { status: "supported" | "unsupported"; evidence: "mock" | "live"; methodVersion: string; checkedAt: string; configRevision: number }
  | { status: "unverified"; reason: "not_tested" | "probe_unavailable" | "configuration_changed" }
);
export interface AiGatewayCapabilitiesDraft {
  draftVersion: typeof AI_GATEWAY_DRAFT_VERSION;
  protocol: string; provider: string; model: string; configRevision: number;
  features: AiGatewayFeatureDraft[]; contextTokens: number; maxOutputTokens: number;
  usageAvailability: "reported" | "estimated_only" | "unavailable";
  evidence: "mock" | "live";
}
/** These are server-established references, not bearer capabilities or model-selected settings. */
interface AiGatewayConfigReferenceBaseDraft {
  configId: string; configRevision: number; credentialRef: string;
  protocol: string; provider: string; model: string;
}
export type AiGatewayConfigReferenceDraft = AiGatewayConfigReferenceBaseDraft & (
  | { tenantId: string; serviceMode: "platform_managed"; configurationScope: AiPlatformScope }
  | { tenantId: string; serviceMode: "tenant_managed"; configurationScope: { kind: "tenant"; tenantId: string } }
  /** Explicit SaaS/platform work, not an absent tenantId silently interpreted as platform. */
  | { consumerScope: AiPlatformScope; serviceMode: "platform_managed"; configurationScope: AiPlatformScope }
);
export type AiGatewayContentDraft =
  | { kind: "text"; text: string }
  | { kind: "image"; attachmentId: string; attachmentRevision: number }
  | { kind: "audio"; attachmentId: string; attachmentRevision: number };
export type AiGatewayUsageDraft =
  | { kind: "reported"; inputTokens: number; outputTokens: number }
  | { kind: "estimated"; inputTokens: number; outputTokens: number; methodVersion: string }
  | { kind: "unknown"; reason: "not_returned" | "result_unknown"; nextAction: "reconcile" };
/** Agent-facing intent: the Gateway resolves provider/config/model only after authorization. */
export interface AiGatewayIntentDraft {
  draftVersion: typeof AI_GATEWAY_DRAFT_VERSION;
  requestId: string;
  sceneCode: string;
  messages: AiGatewayCallDraft["messages"];
  requiredFeatures: AiGatewayFeatureDraft[];
  optionalFeatures: AiGatewayFeatureDraft[];
  maxOutputTokens: number;
}
/** Internal resolved envelope between Gateway/Router and Adapter, not the Agent input. */
export interface AiGatewayCallDraft {
  draftVersion: typeof AI_GATEWAY_DRAFT_VERSION;
  requestId: string; runId: string; stepId: string;
  /** Trusted server envelope only. Model-facing messages/tools never supply context/config. */
  context: AiExecutionContext;
  config: AiGatewayConfigReferenceDraft;
  /** The Agent needs a scene and capabilities, never a supplier/model. Model pin is server-only. */
  sceneCode: string;
  expectation: { model?: string; configRevision: number; requiredFeatures: AiGatewayFeatureDraft[]; optionalFeatures: AiGatewayFeatureDraft[] };
  messages: Array<{ role: "system" | "user" | "assistant"; content: AiGatewayContentDraft[] }>;
  /** Currently only the C02 input example is typed. Other tools await their own strict inputs. */
  authorizedToolRequests: AiOrderExplainRequestDraft[];
  maxOutputTokens: number;
  mode: "mock" | "live";
}
export type AiGatewayFailureCodeDraft = "authentication_failed" | "timeout" | "cancelled" | "rate_limited" | "capability_unsupported" | "adapter_unavailable" | "configuration_changed" | "invalid_response";
interface AiGatewayResultBaseDraft {
  draftVersion: typeof AI_GATEWAY_DRAFT_VERSION; requestId: string;
  actual: AiGatewayConfigReferenceDraft; evidence: "mock" | "live";
  usage: AiGatewayUsageDraft;
}
export type AiGatewayResultDraft = AiGatewayResultBaseDraft & (
  | { status: "completed"; text: string; toolRequests: AiOrderExplainRequestDraft[] }
  | { status: "failed"; error: { code: AiGatewayFailureCodeDraft; message: string; nextAction: "manual" | "reauthorize" | "retry_later" } }
  | { status: "unknown"; error: { code: "AI_RESULT_UNKNOWN"; message: string; retryable: false; nextAction: "reconcile" }; usage: Extract<AiGatewayUsageDraft, { kind: "unknown" }> }
);
/** All callers use one Gateway port; no supplier SDK or endpoint appears in this input. */
export interface AiGatewayPortDraft {
  invoke(context: AiExecutionContext, intent: AiGatewayIntentDraft): Promise<AiGatewayResultDraft>;
  stream(context: AiExecutionContext, intent: AiGatewayIntentDraft): AsyncIterable<AiGatewayStreamEventDraft>;
}

/** Provider stream events only, not business success or C04 task UI events. */
export type AiGatewayStreamEventDraft = {
  draftVersion: typeof AI_GATEWAY_DRAFT_VERSION; requestId: string; sequence: number;
} & (
  | { kind: "started"; actual: AiGatewayConfigReferenceDraft; evidence: "mock" | "live" }
  | { kind: "text_delta"; delta: string }
  | { kind: "terminal"; result: AiGatewayResultDraft }
);
