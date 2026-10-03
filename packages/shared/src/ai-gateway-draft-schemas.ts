import { AI_GATEWAY_DRAFT_VERSION } from "./ai-gateway-draft";
/** Browser/Node neutral JSON-Schema builders reused by the other owned leaf drafts. */
export interface AiLeafSchemaDraft {
  [key: string]: unknown;
  type?: string | readonly string[]; properties?: Record<string, AiLeafSchemaDraft>; required?: readonly string[];
  items?: AiLeafSchemaDraft; oneOf?: readonly AiLeafSchemaDraft[]; $ref?: string;
}
export const leafRef = (name: string): AiLeafSchemaDraft => ({ $ref: `#/components/schemas/${name}` });
export const leafEnum = (...values: readonly string[]): AiLeafSchemaDraft => ({ type: "string", enum: values });
export const leafText = (maxLength = 191, minLength = 1): AiLeafSchemaDraft => ({ type: "string", minLength, maxLength });
export const leafId = (): AiLeafSchemaDraft => ({ type: "string", minLength: 1, maxLength: 191, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" });
export const leafInt = (minimum = 0, maximum = 2147483647): AiLeafSchemaDraft => ({ type: "integer", minimum, maximum });
export const leafList = (items: AiLeafSchemaDraft, maxItems = 64, minItems = 0): AiLeafSchemaDraft => ({ type: "array", items, minItems, maxItems });
export const leafClosed = (properties: Record<string, AiLeafSchemaDraft>, required: readonly string[] = Object.keys(properties)): AiLeafSchemaDraft => ({ type: "object", properties, required, additionalProperties: false });
export const leafTime: AiLeafSchemaDraft = { type: "string", format: "date-time", minLength: 20, maxLength: 40 };
const v = leafEnum(AI_GATEWAY_DRAFT_VERSION), features = leafList(leafEnum("text", "tools", "structured_output", "image", "audio", "streaming", "embedding", "reasoning"), 8);
features.uniqueItems = true;
const configBase = { configId: leafId(), configRevision: leafInt(1), credentialRef: leafId(), protocol: leafId(), provider: leafText(128), model: leafText(256) };
const config = { oneOf: [
  leafClosed({ ...configBase, tenantId: leafId(), serviceMode: leafEnum("platform_managed"), configurationScope: leafRef("AiPlatformScope") }),
  leafClosed({ ...configBase, tenantId: leafId(), serviceMode: leafEnum("tenant_managed"), configurationScope: leafRef("AiTenantScope") }),
  leafClosed({ ...configBase, consumerScope: leafRef("AiPlatformScope"), serviceMode: leafEnum("platform_managed"), configurationScope: leafRef("AiPlatformScope") })
] };
const base = { draftVersion: v, requestId: leafId(), actual: leafRef("AiGatewayConfigReferenceDraft"), evidence: leafEnum("mock", "live"), usage: leafRef("AiGatewayUsageDraft") };
const unknownUsage = leafClosed({ kind: leafEnum("unknown"), reason: leafEnum("not_returned", "result_unknown"), nextAction: leafEnum("reconcile") });
const error = leafClosed({ code: leafEnum("authentication_failed", "timeout", "cancelled", "rate_limited", "capability_unsupported", "adapter_unavailable", "configuration_changed", "invalid_response"), message: leafText(512), nextAction: leafEnum("manual", "reauthorize", "retry_later") });
const unknownError = leafClosed({ code: leafEnum("AI_RESULT_UNKNOWN"), message: leafText(512), retryable: { type: "boolean", const: false }, nextAction: leafEnum("reconcile") });
const event = { draftVersion: v, requestId: leafId(), sequence: leafInt(1) };
const messages = leafList(leafClosed({ role: leafEnum("system", "user", "assistant"), content: leafList(leafRef("AiGatewayContentDraft"), 16, 1) }), 64, 1);
export const AI_GATEWAY_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiGatewayCapabilityAssessmentDraft: { oneOf: [leafClosed({ feature: features.items!, status: leafEnum("supported", "unsupported"), evidence: leafEnum("mock", "live"), methodVersion: leafId(), checkedAt: leafTime, configRevision: leafInt(1) }), leafClosed({ feature: features.items!, status: leafEnum("unverified"), reason: leafEnum("not_tested", "probe_unavailable", "configuration_changed") })] },
  AiGatewayIntentDraft: leafClosed({ draftVersion: v, requestId: leafId(), sceneCode: leafId(), messages, requiredFeatures: features, optionalFeatures: features, maxOutputTokens: leafInt(1, 32768) }),
  AiGatewayConfigReferenceDraft: config,
  AiGatewayCapabilitiesDraft: leafClosed({ draftVersion: v, protocol: leafId(), provider: leafText(128), model: leafText(256), configRevision: leafInt(1), features, contextTokens: leafInt(1), maxOutputTokens: leafInt(1), usageAvailability: leafEnum("reported", "estimated_only", "unavailable"), evidence: leafEnum("mock", "live") }),
  AiGatewayContentDraft: { oneOf: [leafClosed({ kind: leafEnum("text"), text: leafText(32000, 0) }), ...["image", "audio"].map(kind => leafClosed({ kind: leafEnum(kind), attachmentId: leafId(), attachmentRevision: leafInt(1) }))] },
  AiGatewayUsageDraft: { oneOf: [leafClosed({ kind: leafEnum("reported"), inputTokens: leafInt(), outputTokens: leafInt() }), leafClosed({ kind: leafEnum("estimated"), inputTokens: leafInt(), outputTokens: leafInt(), methodVersion: leafId() }), unknownUsage] },
  AiGatewayCallDraft: leafClosed({ draftVersion: v, requestId: leafId(), runId: leafId(), stepId: leafId(), sceneCode: leafId(), context: leafRef("AiExecutionContext"), config: leafRef("AiGatewayConfigReferenceDraft"), expectation: leafClosed({ model: leafText(256), configRevision: leafInt(1), requiredFeatures: features, optionalFeatures: features }, ["configRevision", "requiredFeatures", "optionalFeatures"]), messages, authorizedToolRequests: leafList(leafRef("AiOrderExplainRequestDraft"), 32), maxOutputTokens: leafInt(1, 32768), mode: leafEnum("mock", "live") }),
  AiGatewayResultDraft: { oneOf: [leafClosed({ ...base, status: leafEnum("completed"), text: leafText(128000, 0), toolRequests: leafList(leafRef("AiOrderExplainRequestDraft"), 32) }), leafClosed({ ...base, status: leafEnum("failed"), error }), leafClosed({ ...base, usage: unknownUsage, status: leafEnum("unknown"), error: unknownError })] },
  AiGatewayStreamEventDraft: { oneOf: [leafClosed({ ...event, kind: leafEnum("started"), actual: config, evidence: leafEnum("mock", "live") }), leafClosed({ ...event, kind: leafEnum("text_delta"), delta: leafText(16000) }), leafClosed({ ...event, kind: leafEnum("terminal"), result: leafRef("AiGatewayResultDraft") })] }
};
