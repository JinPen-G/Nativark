/**
 * AIN-C01/C02 草案 schema：只并入 OpenAPI components，不公布可调用 paths。
 * JSON 结构校验不是身份验证、资源授权或业务校验；没有任何执行 handler。
 */
import { AI_CONTRACT_DRAFT_VERSION, AI_ERROR_CODES, AI_TOOL_CODES, AI_TOOL_DRAFT_VERSION } from "@rental-os/shared";
import type { AiOperatorAccess, AiToolContractDraft } from "@rental-os/shared";
import type { SchemaObject } from "./openapi-document";

const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const choice = (...values: string[]): SchemaObject => ({ type: "string", enum: values });
const text = (maxLength = 191): SchemaObject => ({ type: "string", minLength: 1, maxLength, pattern: "\\S" });
const id = (): SchemaObject => ({ type: "string", minLength: 1, maxLength: 191, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" });
const list = (items: SchemaObject, minItems = 0, maxItems = 64): SchemaObject => ({ type: "array", items, minItems, maxItems, uniqueItems: true });
const closed = (properties: Record<string, SchemaObject>, required = Object.keys(properties)): SchemaObject => ({
  type: "object", properties, required, additionalProperties: false
});
const timestamp: SchemaObject = { type: "string", format: "date-time" };
const version = choice(AI_CONTRACT_DRAFT_VERSION);
const tenantOrWorkspace: SchemaObject = { oneOf: [ref("AiTenantScope"), ref("AiWorkspaceScope")] };
const contextBase = { contractVersion: version, requestId: id(), authorizedAt: timestamp };
const positiveInteger: SchemaObject = { type: "integer", minimum: 1 };
const checks = ["current_identity", "audience", "scope", "membership", "permission", "data_scope", "location_scope", "resource_ownership", "field_visibility", "capability", "subscription", "controller_preconditions"];
const errorProperties = {
  code: choice(...AI_ERROR_CODES), message: text(512), retryable: { type: "boolean" } as SchemaObject,
  nextAction: choice("none", "clarify", "reconfirm", "reauthorize", "reconcile", "retry_later", "manual"),
  missingFields: list({ type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z][A-Za-z0-9_.\\[\\]-]*$" }, 0, 32)
};

const knownError = closed({ ...errorProperties, code: choice(...AI_ERROR_CODES.filter(code => code !== "AI_RESULT_UNKNOWN")) });
const unknownError = closed({ ...errorProperties, code: choice("AI_RESULT_UNKNOWN"), retryable: { type: "boolean", enum: [false] }, nextAction: choice("reconcile") });

const accessProperties = {
  permissions: list(text(128), 0, 256),
  dataScope: choice("all", "organization", "store", "own"),
  locationScope: ref("AiLocationScope"), organizationId: id()
} satisfies Record<keyof AiOperatorAccess, SchemaObject>;

const toolProperties = {
  contractVersion: version, contractStatus: choice("draft"), code: choice(...AI_TOOL_CODES),
  version: choice(AI_TOOL_DRAFT_VERSION), description: text(1000), aiMaturity: choice("unavailable"),
  businessMaturity: choice("implemented", "preview_only", "not_implemented"), risk: choice("R0", "R1", "R2", "R3"),
  audiences: list(choice("operator", "staff", "client", "automation"), 1, 4),
  scopeKinds: list(choice("platform", "tenant", "workspace"), 1, 3),
  permissionAnyOf: list(text(128), 0, 64), authorization: choice("revalidate_each_step_and_replay"),
  additionalChecks: list(choice(...checks), 1, checks.length),
  capabilityCodes: list(text(128)), subscriptionFeatures: list(text(128)),
  inputSchemaId: id(), outputSchemaId: id(), preconditions: list(text(512)), sideEffects: list(text(512)),
  redactionRules: list(text(512), 1),
  // 由工具责任人显式给值，不在草案里假设生产限额。测试样例数字不作为运行默认值。
  limits: closed({ maxResults: positiveInteger, timeoutMs: positiveInteger, maxAttempts: positiveInteger }),
  idempotency: choice("read_only", "business_action", "proposal_revision", "pending"),
  retry: choice("no_retry", "bounded_read", "reconcile_before_retry"),
  resultChecks: list(text(512), 1), manualExit: text(512), ownerModule: id(), blockers: list(text(512), 1)
} satisfies Record<keyof AiToolContractDraft, SchemaObject>;

export const AI_NATIVE_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  AiPlatformScope: closed({ kind: choice("platform") }),
  AiTenantScope: closed({ kind: choice("tenant"), tenantId: id() }),
  AiWorkspaceScope: closed({ kind: choice("workspace"), tenantId: id(), workspaceId: id() }),
  AiExecutionScope: { oneOf: [ref("AiPlatformScope"), ref("AiTenantScope"), ref("AiWorkspaceScope")] },
  AiLocationScope: {
    oneOf: [
      closed({ mode: choice("all"), locationIds: list(id(), 0, 0) }),
      closed({ mode: choice("selected"), locationIds: list(id(), 0, 1000) })
    ]
  },
  AiOperatorAccess: closed(accessProperties, ["permissions", "dataScope", "locationScope"]),
  AiExecutionContext: {
    description: "DRAFT: server-established context only; schema validity grants no authority. Reauthorize before every step and replay.",
    oneOf: [
      closed({ ...contextBase, audience: choice("operator"), actor: closed({ kind: choice("saas_admin"), userId: id() }), scope: ref("AiPlatformScope"), permissions: list(text(128), 0, 256) }),
      closed({ ...contextBase, audience: choice("operator", "staff"), actor: closed({ kind: choice("user"), userId: id() }), scope: tenantOrWorkspace, access: ref("AiOperatorAccess") }),
      closed({ ...contextBase, audience: choice("client"), actor: closed({ kind: choice("customer"), customerId: id() }), scope: tenantOrWorkspace }),
      closed({ ...contextBase, audience: choice("automation"), actor: closed({ kind: choice("automation"), subjectId: id(), policyId: id(), policyRevision: positiveInteger, expiresAt: timestamp }), scope: tenantOrWorkspace, access: ref("AiOperatorAccess") })
    ]
  },
  AiOrderExplainInput: closed({ orderId: id() }),
  AiOrderExplainRequestDraft: {
    ...closed({ contractVersion: version, toolCode: choice("rental.order.explain"), toolVersion: choice(AI_TOOL_DRAFT_VERSION), input: ref("AiOrderExplainInput") }),
    description: "DRAFT input example, not a callable endpoint. No caller-selected identity, scope or computed amounts. Order ownership must still be verified."
  },
  AiToolContractDraft: {
    ...closed(toolProperties),
    description: "DRAFT metadata only. All tools unavailable; schema references and metadata are not executable authority. Tool-specific schemas and activation evidence remain pending."
  },
  AiFactReference: closed({
    scope: ref("AiExecutionScope"), resourceType: choice("order", "quote", "configuration", "report", "inspection", "knowledge"),
    resourceId: id(), observedAt: timestamp,
    basis: { oneOf: [
      closed({ kind: choice("current") }),
      closed({ kind: choice("snapshot"), version: id() }),
      closed({ kind: choice("missing"), reason: choice("snapshot_missing", "source_unavailable") }),
      closed({ kind: choice("legacy_current_fallback"), reason: choice("snapshot_missing") })
    ] }
  }),
  AiToolError: { oneOf: [knownError, unknownError] },
  AiToolFailure: {
    oneOf: [
      closed({ contractVersion: version, requestId: id(), status: choice("failed"), error: knownError }),
      closed({ contractVersion: version, requestId: id(), status: choice("unknown"), error: unknownError })
    ],
    description: "Unknown business results require reconciliation, not blind retry or invented success. Messages must be redacted by the producer."
  }
};
