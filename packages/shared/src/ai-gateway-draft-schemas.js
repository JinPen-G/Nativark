"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_GATEWAY_DRAFT_SCHEMAS = exports.leafTime = exports.leafClosed = exports.leafList = exports.leafInt = exports.leafId = exports.leafText = exports.leafEnum = exports.leafRef = void 0;
const ai_gateway_draft_1 = require("./ai-gateway-draft");
const leafRef = (name) => ({ $ref: `#/components/schemas/${name}` });
exports.leafRef = leafRef;
const leafEnum = (...values) => ({ type: "string", enum: values });
exports.leafEnum = leafEnum;
const leafText = (maxLength = 191, minLength = 1) => ({ type: "string", minLength, maxLength });
exports.leafText = leafText;
const leafId = () => ({ type: "string", minLength: 1, maxLength: 191, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" });
exports.leafId = leafId;
const leafInt = (minimum = 0, maximum = 2147483647) => ({ type: "integer", minimum, maximum });
exports.leafInt = leafInt;
const leafList = (items, maxItems = 64, minItems = 0) => ({ type: "array", items, minItems, maxItems });
exports.leafList = leafList;
const leafClosed = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
exports.leafClosed = leafClosed;
exports.leafTime = { type: "string", format: "date-time", minLength: 20, maxLength: 40 };
const v = (0, exports.leafEnum)(ai_gateway_draft_1.AI_GATEWAY_DRAFT_VERSION), features = (0, exports.leafList)((0, exports.leafEnum)("text", "tools", "structured_output", "image", "audio", "streaming", "embedding", "reasoning"), 8);
features.uniqueItems = true;
const configBase = { configId: (0, exports.leafId)(), configRevision: (0, exports.leafInt)(1), credentialRef: (0, exports.leafId)(), protocol: (0, exports.leafId)(), provider: (0, exports.leafText)(128), model: (0, exports.leafText)(256) };
const config = { oneOf: [
        (0, exports.leafClosed)({ ...configBase, tenantId: (0, exports.leafId)(), serviceMode: (0, exports.leafEnum)("platform_managed"), configurationScope: (0, exports.leafRef)("AiPlatformScope") }),
        (0, exports.leafClosed)({ ...configBase, tenantId: (0, exports.leafId)(), serviceMode: (0, exports.leafEnum)("tenant_managed"), configurationScope: (0, exports.leafRef)("AiTenantScope") }),
        (0, exports.leafClosed)({ ...configBase, consumerScope: (0, exports.leafRef)("AiPlatformScope"), serviceMode: (0, exports.leafEnum)("platform_managed"), configurationScope: (0, exports.leafRef)("AiPlatformScope") })
    ] };
const base = { draftVersion: v, requestId: (0, exports.leafId)(), actual: (0, exports.leafRef)("AiGatewayConfigReferenceDraft"), evidence: (0, exports.leafEnum)("mock", "live"), usage: (0, exports.leafRef)("AiGatewayUsageDraft") };
const unknownUsage = (0, exports.leafClosed)({ kind: (0, exports.leafEnum)("unknown"), reason: (0, exports.leafEnum)("not_returned", "result_unknown"), nextAction: (0, exports.leafEnum)("reconcile") });
const error = (0, exports.leafClosed)({ code: (0, exports.leafEnum)("authentication_failed", "timeout", "cancelled", "rate_limited", "capability_unsupported", "adapter_unavailable", "configuration_changed", "invalid_response"), message: (0, exports.leafText)(512), nextAction: (0, exports.leafEnum)("manual", "reauthorize", "retry_later") });
const unknownError = (0, exports.leafClosed)({ code: (0, exports.leafEnum)("AI_RESULT_UNKNOWN"), message: (0, exports.leafText)(512), retryable: { type: "boolean", const: false }, nextAction: (0, exports.leafEnum)("reconcile") });
const event = { draftVersion: v, requestId: (0, exports.leafId)(), sequence: (0, exports.leafInt)(1) };
const messages = (0, exports.leafList)((0, exports.leafClosed)({ role: (0, exports.leafEnum)("system", "user", "assistant"), content: (0, exports.leafList)((0, exports.leafRef)("AiGatewayContentDraft"), 16, 1) }), 64, 1);
exports.AI_GATEWAY_DRAFT_SCHEMAS = {
    AiGatewayCapabilityAssessmentDraft: { oneOf: [(0, exports.leafClosed)({ feature: features.items, status: (0, exports.leafEnum)("supported", "unsupported"), evidence: (0, exports.leafEnum)("mock", "live"), methodVersion: (0, exports.leafId)(), checkedAt: exports.leafTime, configRevision: (0, exports.leafInt)(1) }), (0, exports.leafClosed)({ feature: features.items, status: (0, exports.leafEnum)("unverified"), reason: (0, exports.leafEnum)("not_tested", "probe_unavailable", "configuration_changed") })] },
    AiGatewayIntentDraft: (0, exports.leafClosed)({ draftVersion: v, requestId: (0, exports.leafId)(), sceneCode: (0, exports.leafId)(), messages, requiredFeatures: features, optionalFeatures: features, maxOutputTokens: (0, exports.leafInt)(1, 32768) }),
    AiGatewayConfigReferenceDraft: config,
    AiGatewayCapabilitiesDraft: (0, exports.leafClosed)({ draftVersion: v, protocol: (0, exports.leafId)(), provider: (0, exports.leafText)(128), model: (0, exports.leafText)(256), configRevision: (0, exports.leafInt)(1), features, contextTokens: (0, exports.leafInt)(1), maxOutputTokens: (0, exports.leafInt)(1), usageAvailability: (0, exports.leafEnum)("reported", "estimated_only", "unavailable"), evidence: (0, exports.leafEnum)("mock", "live") }),
    AiGatewayContentDraft: { oneOf: [(0, exports.leafClosed)({ kind: (0, exports.leafEnum)("text"), text: (0, exports.leafText)(32000, 0) }), ...["image", "audio"].map(kind => (0, exports.leafClosed)({ kind: (0, exports.leafEnum)(kind), attachmentId: (0, exports.leafId)(), attachmentRevision: (0, exports.leafInt)(1) }))] },
    AiGatewayUsageDraft: { oneOf: [(0, exports.leafClosed)({ kind: (0, exports.leafEnum)("reported"), inputTokens: (0, exports.leafInt)(), outputTokens: (0, exports.leafInt)() }), (0, exports.leafClosed)({ kind: (0, exports.leafEnum)("estimated"), inputTokens: (0, exports.leafInt)(), outputTokens: (0, exports.leafInt)(), methodVersion: (0, exports.leafId)() }), unknownUsage] },
    AiGatewayCallDraft: (0, exports.leafClosed)({ draftVersion: v, requestId: (0, exports.leafId)(), runId: (0, exports.leafId)(), stepId: (0, exports.leafId)(), sceneCode: (0, exports.leafId)(), context: (0, exports.leafRef)("AiExecutionContext"), config: (0, exports.leafRef)("AiGatewayConfigReferenceDraft"), expectation: (0, exports.leafClosed)({ model: (0, exports.leafText)(256), configRevision: (0, exports.leafInt)(1), requiredFeatures: features, optionalFeatures: features }, ["configRevision", "requiredFeatures", "optionalFeatures"]), messages, authorizedToolRequests: (0, exports.leafList)((0, exports.leafRef)("AiOrderExplainRequestDraft"), 32), maxOutputTokens: (0, exports.leafInt)(1, 32768), mode: (0, exports.leafEnum)("mock", "live") }),
    AiGatewayResultDraft: { oneOf: [(0, exports.leafClosed)({ ...base, status: (0, exports.leafEnum)("completed"), text: (0, exports.leafText)(128000, 0), toolRequests: (0, exports.leafList)((0, exports.leafRef)("AiOrderExplainRequestDraft"), 32) }), (0, exports.leafClosed)({ ...base, status: (0, exports.leafEnum)("failed"), error }), (0, exports.leafClosed)({ ...base, usage: unknownUsage, status: (0, exports.leafEnum)("unknown"), error: unknownError })] },
    AiGatewayStreamEventDraft: { oneOf: [(0, exports.leafClosed)({ ...event, kind: (0, exports.leafEnum)("started"), actual: config, evidence: (0, exports.leafEnum)("mock", "live") }), (0, exports.leafClosed)({ ...event, kind: (0, exports.leafEnum)("text_delta"), delta: (0, exports.leafText)(16000) }), (0, exports.leafClosed)({ ...event, kind: (0, exports.leafEnum)("terminal"), result: (0, exports.leafRef)("AiGatewayResultDraft") })] }
};
//# sourceMappingURL=ai-gateway-draft-schemas.js.map