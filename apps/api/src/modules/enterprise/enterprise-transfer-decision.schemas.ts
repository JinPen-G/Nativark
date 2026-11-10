/** Public K/C refusal evidence; it cannot authorize a new handoff or imply a rollback. */
import type { SchemaObject } from "../../contracts/openapi-document";
const ref: SchemaObject = { type: "string", minLength: 1, maxLength: 191 };
const key: SchemaObject = { type: "string", minLength: 1, maxLength: 128 };
const object = (properties: Record<string, SchemaObject>): SchemaObject => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const ENTERPRISE_TRANSFER_DECISION_SCHEMAS: Record<string, SchemaObject> = {
  CloseEnterpriseTransferDecisionRequest: object({ operationKey: key, expectedRevision: { type: "integer", minimum: 0 }, reason: { type: "string", minLength: 1, maxLength: 500 }, confirm: { type: "boolean", enum: [true] } }),
  EnterpriseTransferDecisionResolution: { ...object({
    version: { type: "integer", enum: [1] }, purpose: { type: "string", enum: ["administrator_transfer_resolution"] }, outcome: { type: "string", enum: ["observed", "closed"] },
    tenantId: ref, corporateCustomerId: ref, applicantCustomerId: ref, transferId: ref, originalOperationKey: key, closureOperationKey: key,
    decision: object({ id: ref, state: { type: "string", enum: ["approved", "rejected"] }, revision: { type: "integer", minimum: 2 } }), retryable: { type: "boolean", enum: [false] },
  }), oneOf: [
    { properties: { outcome: { type: "string", enum: ["observed"] } } },
    { properties: { outcome: { type: "string", enum: ["closed"] }, decision: { properties: { state: { type: "string", enum: ["rejected"] } } } } },
  ] },
};
