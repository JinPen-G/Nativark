/** C03同源严格schema；工具输入只由宿主明确登记，缺登记时仅允许空工具数组。 */
import { AI_GATEWAY_DRAFT_VERSION, AI_GATEWAY_TOOL_RESULT_REFERENCE_VERSION } from "./ai-gateway-draft";
import { leafRef, leafEnum, leafText, leafId, leafInt, leafList, leafClosed, leafTime, type AiLeafSchemaDraft } from "./ai-leaf-schema";

export function createAiGatewayDraftSchemas(toolRequestSchema?: AiLeafSchemaDraft): Record<string, AiLeafSchemaDraft> {
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
  const toolRequests = toolRequestSchema ? leafList(toolRequestSchema, 32) : leafList(leafClosed({}), 0);
  return {
    AiGatewayCapabilityAssessmentDraft: { oneOf: [leafClosed({ feature: features.items!, status: leafEnum("supported", "unsupported"), evidence: leafEnum("mock", "live"), methodVersion: leafId(), checkedAt: leafTime, configRevision: leafInt(1) }), leafClosed({ feature: features.items!, status: leafEnum("unverified"), reason: leafEnum("not_tested", "probe_unavailable", "configuration_changed") })] },
    AiGatewayIntentDraft: leafClosed({ draftVersion: v, requestId: leafId(), sceneCode: leafId(), messages, requiredFeatures: features, optionalFeatures: features, maxOutputTokens: leafInt(1, 32768) }),
    AiGatewayConfigReferenceDraft: config,
    AiGatewayCapabilitiesDraft: leafClosed({ draftVersion: v, protocol: leafId(), provider: leafText(128), model: leafText(256), configRevision: leafInt(1), features, contextTokens: leafInt(1), maxOutputTokens: leafInt(1), usageAvailability: leafEnum("reported", "estimated_only", "unavailable"), evidence: leafEnum("mock", "live") }),
    AiGatewayToolResultReferenceDraft: leafClosed({ referenceVersion: leafEnum(AI_GATEWAY_TOOL_RESULT_REFERENCE_VERSION),
      taskId: { ...leafId(), maxLength: 36 }, runId: { ...leafId(), maxLength: 36 },
      modelRegistrationRef: leafId(), toolRegistrationRef: leafId(), callIndex: leafInt(0, 7) }),
    AiGatewayContentDraft: { oneOf: [leafClosed({ kind: leafEnum("text"), text: leafText(32000, 0) }), ...["image", "audio"].map(kind => leafClosed({ kind: leafEnum(kind), attachmentId: leafId(), attachmentRevision: leafInt(1) })),
      leafClosed({ kind: leafEnum("tool_result_reference"), reference: leafRef("AiGatewayToolResultReferenceDraft") })] },
    AiGatewayUsageDraft: { oneOf: [leafClosed({ kind: leafEnum("reported"), inputTokens: leafInt(), outputTokens: leafInt() }), leafClosed({ kind: leafEnum("estimated"), inputTokens: leafInt(), outputTokens: leafInt(), methodVersion: leafId() }), unknownUsage] },
    AiGatewayCallDraft: leafClosed({ draftVersion: v, requestId: leafId(), runId: leafId(), stepId: leafId(), sceneCode: leafId(), context: leafRef("AiExecutionContext"), config: leafRef("AiGatewayConfigReferenceDraft"), expectation: leafClosed({ model: leafText(256), configRevision: leafInt(1), requiredFeatures: features, optionalFeatures: features }, ["configRevision", "requiredFeatures", "optionalFeatures"]), messages, authorizedToolRequests: toolRequests, maxOutputTokens: leafInt(1, 32768), mode: leafEnum("mock", "live") }),
    AiGatewayResultDraft: { oneOf: [leafClosed({ ...base, status: leafEnum("completed"), text: leafText(128000, 0), toolRequests: toolRequests }), leafClosed({ ...base, status: leafEnum("failed"), error }), leafClosed({ ...base, usage: unknownUsage, status: leafEnum("unknown"), error: unknownError })] },
    AiGatewayStreamEventDraft: { oneOf: [leafClosed({ ...event, kind: leafEnum("started"), actual: config, evidence: leafEnum("mock", "live") }), leafClosed({ ...event, kind: leafEnum("text_delta"), delta: leafText(16000) }), leafClosed({ ...event, kind: leafEnum("terminal"), result: leafRef("AiGatewayResultDraft") })] }
  };
}

export const AI_GATEWAY_DRAFT_SCHEMAS = createAiGatewayDraftSchemas();
