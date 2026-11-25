/** 可信上下文的原C01结构，保留闭对象、范围、数量和主体限制；不替代Auth/Guard/Core授权。 */
import { AI_CONTRACT_DRAFT_VERSION, type AiOperatorAccess } from "./ai-context";
import { AI_SCOPE_DRAFT_SCHEMAS } from "./ai-scope-schemas";
import type { AiLeafSchemaDraft } from "./ai-leaf-schema";

const ref = (name: string): AiLeafSchemaDraft => ({ $ref: `#/components/schemas/${name}` });
const choice = (...values: string[]): AiLeafSchemaDraft => ({ type: "string", enum: values });
const text = (maxLength = 191): AiLeafSchemaDraft => ({ type: "string", minLength: 1, maxLength, pattern: "\\S" });
const id = (): AiLeafSchemaDraft => ({ type: "string", minLength: 1, maxLength: 191, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" });
const list = (items: AiLeafSchemaDraft, minItems = 0, maxItems = 64): AiLeafSchemaDraft => ({ type: "array", items, minItems, maxItems, uniqueItems: true });
const closed = (properties: Record<string, AiLeafSchemaDraft>, required = Object.keys(properties)): AiLeafSchemaDraft => ({
  type: "object", properties, required, additionalProperties: false
});
const timestamp: AiLeafSchemaDraft = { type: "string", format: "date-time" };
const version = choice(AI_CONTRACT_DRAFT_VERSION);
const tenantOrWorkspace: AiLeafSchemaDraft = { oneOf: [ref("AiTenantScope"), ref("AiWorkspaceScope")] };
const contextBase = { contractVersion: version, requestId: id(), authorizedAt: timestamp };
const positiveInteger: AiLeafSchemaDraft = { type: "integer", minimum: 1 };
const accessProperties = {
  permissions: list(text(128), 0, 256),
  dataScope: choice("all", "organization", "store", "own"),
  locationScope: ref("AiLocationScope"), organizationId: id()
} satisfies Record<keyof AiOperatorAccess, AiLeafSchemaDraft>;

export const AI_EXECUTION_CONTEXT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  ...AI_SCOPE_DRAFT_SCHEMAS,
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
  }
};
