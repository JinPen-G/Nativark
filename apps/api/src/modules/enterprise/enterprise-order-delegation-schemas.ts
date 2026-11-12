/** Public reference/receipt projections only. The immutable server source is excluded. */
import type { SchemaObject } from "../../contracts/openapi-document";
const string: SchemaObject = { type: "string", minLength: 1, maxLength: 191 };
const key: SchemaObject = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" };
const date: SchemaObject = { type: "string", format: "date-time" };
const integer: SchemaObject = { type: "integer", minimum: 0 };
const object = (properties: Record<string, SchemaObject>, required = Object.keys(properties)): SchemaObject => ({ type: "object", additionalProperties: false, properties, required });
const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const noRetry: SchemaObject = { type: "boolean", enum: [false] };
const change = { operationKey: key, expectedRevision: integer, reason: { type: "string", minLength: 1, maxLength: 500 } as SchemaObject };
export const ENTERPRISE_ORDER_DELEGATION_SCHEMAS: Record<string, SchemaObject> = {
  EnterpriseOrderDelegationRequestReference: { oneOf: [object({ approvalId: string }), object({ quoteId: string })] },
  IssueEnterpriseOrderDelegation: object({ ...change, requestReference: ref("EnterpriseOrderDelegationRequestReference"), confirm: { type: "boolean", enum: [true] } }),
  RevokeEnterpriseOrderDelegation: object({ ...change, delegationKey: key, confirm: { type: "boolean", enum: [true] } }),
  EnterpriseOrderDelegationReference: object({ delegationKey: key, expectedRevision: { type: "integer", minimum: 1, maximum: 1 }, approvalId: string }, ["delegationKey", "expectedRevision"]),
  EnterpriseOrderDelegationReceipt: object({ state: { type: "string", enum: ["consumed"] }, delegationKey: key, sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    tenantId: string, workspaceId: string, personalCustomerId: string, corporateCustomerId: string, quoteId: string, requestHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    coreIdempotencyKey: key, actorUserId: string, orderId: string, consumedAt: date, retryable: noRetry }),
  EnterpriseOrderDelegationView: object({ delegationKey: key, requestReference: ref("EnterpriseOrderDelegationRequestReference"),
    state: { type: "string", enum: ["issued", "expired", "revoked", "consumed"] }, revision: integer, expiresAt: date, confirmedAt: date,
    purpose: { type: "string", enum: ["merchant_operator"] }, original: { oneOf: [ref("EnterpriseOrderDelegationReceipt"),
      object({ state: { type: "string", enum: ["not_submitted", "revoked"] }, retryable: noRetry })] }, retryable: noRetry }),
  EnterpriseOrderDelegationOriginal: { oneOf: [ref("EnterpriseOrderDelegationView"), object({ state: { type: "string", enum: ["not_recorded"] }, delegationKey: key, retryable: noRetry })] }
};
