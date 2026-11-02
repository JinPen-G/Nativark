/** Shared extension-approval projections; original Core price/rule internals are not HTTP inputs. */
import type { SchemaObject } from "../../contracts/openapi-document";
const string: SchemaObject = { type: "string" };
const integer: SchemaObject = { type: "integer", minimum: 0 };
const date: SchemaObject = { type: "string", format: "date-time" };
const noRetry: SchemaObject = { type: "boolean", enum: [false] };
const object = (properties: Record<string, SchemaObject>, required = Object.keys(properties)): SchemaObject => ({ type: "object", properties, required, additionalProperties: false });
const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const change = { operationKey: { type: "string", minLength: 1, maxLength: 128 } as SchemaObject, expectedRevision: integer, reason: { type: "string", minLength: 1, maxLength: 500 } as SchemaObject };
export const ENTERPRISE_EXTENSION_SCHEMAS: Record<string, SchemaObject> = {
  EnterpriseExtensionEligibility: object({ orderId: string, expectedOrderUpdatedAt: date, approvalRequired: { type: "boolean" }, corporateCustomerId: string }, ["orderId", "expectedOrderUpdatedAt", "approvalRequired"]),
  EnterpriseExtensionInput: object({ newEndAt: date, services: { type: "array", maxItems: 100, items: object({ serviceId: string, quantity: { type: "integer", minimum: 1 }, scheduledStartAt: date, scheduledEndAt: date, serviceLocationId: string }, ["serviceId", "quantity"]) }, memo: { type: "string", maxLength: 500 } }, ["newEndAt"]),
  RequestEnterpriseExtensionApproval: object({ ...change, orderId: string, expectedOrderUpdatedAt: date, extension: ref("EnterpriseExtensionInput") }),
  DecideEnterpriseExtensionApproval: object({ ...change, decision: { type: "string", enum: ["approve", "reject", "withdraw"] } }),
  SubmitEnterpriseExtensionApproval: object({ ...change, approvalId: string, confirm: { type: "boolean", enum: [true] } }),
  CloseEnterpriseExtensionExecution: object({ ...change, originalOperationKey: { type: "string", minLength: 1, maxLength: 128 }, confirm: { type: "boolean", enum: [true] } }),
  EnterpriseExtensionReview: object({ originalEndAt: date, newEndAt: date,
    rentalAmount: { type: "number" }, serviceAmount: { type: "number" }, depositDelta: { type: "number" }, preAuthDelta: { type: "number" }, payableAmount: { type: "number" }, currency: string,
    settlementMode: { type: "string", enum: ["immediate", "monthly"] }, paymentRequired: { type: "boolean" },
    chargeLines: { type: "array", items: object({ code: string, name: string, type: string, amount: { type: "number" } }) } }),
  EnterpriseExtensionApprovalView: object({ id: string, corporateCustomerId: string, applicantCustomerId: string, workspaceId: string, orderId: string, expectedOrderUpdatedAt: date,
    state: { type: "string", enum: ["pending", "approved", "rejected", "withdrawn", "expired", "consumed", "closed"] }, revision: integer, expiresAt: date, reason: string,
    preview: ref("EnterpriseExtensionReview"), extensionId: string, closedOperationKey: string }, ["id", "corporateCustomerId", "applicantCustomerId", "workspaceId", "orderId", "expectedOrderUpdatedAt", "state", "revision", "expiresAt", "reason", "preview"]),
  EnterpriseExtensionApprovalList: { type: "array", items: ref("EnterpriseExtensionApprovalView") },
  EnterpriseExtensionCommandResult: object({ id: string, state: { type: "string", enum: ["pending", "approved", "rejected", "withdrawn"] }, revision: integer, expiresAt: date }, ["id", "state", "revision"]),
  EnterpriseExtensionOriginalResult: object({ approval: ref("EnterpriseExtensionApprovalView"), original: { oneOf: [
    object({ state: { type: "string", enum: ["not_submitted", "closed"] }, retryable: noRetry }),
    object({ state: { type: "string", enum: ["observed"] }, extensionId: string, extensionState: { type: "string", enum: ["pending_payment", "effective", "cancelled", "expired"] }, retryable: noRetry }),
  ] }, retryable: noRetry }),
};
