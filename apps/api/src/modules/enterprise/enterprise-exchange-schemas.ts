/** Exchange HTTP contracts expose only spending review, not original internal pricing evidence. */
import type { SchemaObject } from "../../contracts/openapi-document";
const string: SchemaObject = { type: "string" };
const reference: SchemaObject = { type: "string", minLength: 1, maxLength: 191 };
const date: SchemaObject = { type: "string", format: "date-time" };
const number: SchemaObject = { type: "number" };
const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, SchemaObject>, required = Object.keys(properties)): SchemaObject => ({ type: "object", properties, required, additionalProperties: false });
const change = { operationKey: { type: "string", minLength: 1, maxLength: 128 } as SchemaObject, expectedRevision: { type: "integer", minimum: 0 } as SchemaObject, reason: { type: "string", minLength: 1, maxLength: 500 } as SchemaObject };
export const ENTERPRISE_EXCHANGE_SCHEMAS: Record<string, SchemaObject> = {
  ConfirmEnterpriseExchangeExpense: object({ ...change, expectedRevision: { type: "integer", minimum: 1 }, confirm: { type: "boolean", enum: [true] } }),
  EnterpriseExchangeConfirmationCommandResult: object({ id: reference, orderId: reference, workspaceId: reference, applicantCustomerId: reference, operationKey: change.operationKey,
    confirmedAt: date, revision: { type: "integer", minimum: 1 }, scope: { type: "string", enum: ["expense_only_not_inspection_or_execution"] } }),
  EnterpriseExchangeConfirmationResult: object({ approval: ref("EnterpriseExchangeApprovalView"), original: { oneOf: [
    object({ state: { type: "string", enum: ["not_confirmed"] }, retryable: { type: "boolean", enum: [false] } }),
    object({ state: { type: "string", enum: ["observed"] }, operationKey: change.operationKey, retryable: { type: "boolean", enum: [false] } })
  ] } }),
  CloseEnterpriseExchangeRequest: object({ ...change, expectedRevision: { type: "integer", enum: [0] }, confirm: { type: "boolean", enum: [true] } }),
  EnterpriseExchangeRequestOriginalResult: { oneOf: [
    object({ state: { type: "string", enum: ["not_recorded"] }, retryable: { type: "boolean", enum: [false] } }),
    object({ state: { type: "string", enum: ["observed"] }, approval: ref("EnterpriseExchangeApprovalView"), retryable: { type: "boolean", enum: [false] } }),
    object({ state: { type: "string", enum: ["closed"] }, orderId: reference, workspaceId: reference, workspaceCode: string, applicantCustomerId: reference, closedOperationKey: change.operationKey, retryable: { type: "boolean", enum: [false] } })
  ] },
  EnterpriseExchangeChoicesQuery: object({ allocationId: reference, replacementItemGroupId: reference }, []),
  EnterpriseExchangeChoices: object({ orderId: reference, orderNo: string, expectedOrderUpdatedAt: date, workspaceId: reference, applicantCustomerId: reference,
    lines: { type: "array", maxItems: 200, items: object({ orderLineId: reference, allocationId: reference, itemGroupId: reference, itemGroupName: string, quantity: number, assetNo: string }, ["orderLineId", "allocationId", "itemGroupId", "itemGroupName", "quantity"]) },
    replacements: { type: "array", maxItems: 200, items: object({ itemGroupId: reference, name: string, inventoryMode: { type: "string", enum: ["serialized", "quantity"] }, pricingGroups: { type: "array", maxItems: 200, items: object({ id: reference, name: string }) } }) },
    assets: { type: "array", maxItems: 200, items: object({ assetId: reference, assetNo: string }) }, selectedAllocationId: reference, selectedReplacementItemGroupId: reference,
    reservation: { type: "string", enum: ["not_reserved"] } }, ["orderId", "orderNo", "expectedOrderUpdatedAt", "workspaceId", "applicantCustomerId", "lines", "replacements", "assets", "reservation"]),
  EnterpriseExchangeIntent: object({ orderLineId: reference, allocationId: reference, replacementItemGroupId: reference, replacementAssetId: reference, replacementPricingGroupId: reference,
    priceBasis: { type: "string", enum: ["original_order_price", "replacement_current_price"] } }, ["orderLineId", "allocationId", "replacementItemGroupId", "priceBasis"]),
  RequestEnterpriseExchangeApproval: object({ ...change, expectedRevision: { type: "integer", enum: [0] }, orderId: reference, expectedOrderUpdatedAt: date, exchange: ref("EnterpriseExchangeIntent") }),
  DecideEnterpriseExchangeApproval: object({ ...change, decision: { type: "string", enum: ["approve", "reject", "withdraw"] } }),
  EnterpriseExchangeApprovalView: object({ id: string, orderId: string, workspaceId: string, corporateCustomerId: string, applicantCustomerId: string,
    expectedOrderUpdatedAt: date, revision: { type: "integer", minimum: 1 }, state: { type: "string", enum: ["pending", "approved", "rejected", "withdrawn", "expired", "consumed"] }, reason: string, expiresAt: date,
    exchange: ref("EnterpriseExchangeIntent"), preview: object({ originalItemGroupName: string, replacementItemGroupName: string, originalAmount: number, replacementAmount: number,
      additionalAmount: number, refundAmount: number, depositDelta: number, preAuthDelta: number, currency: string, originalPriceVersion: string, replacementPriceVersion: string },
    ["originalItemGroupName", "replacementItemGroupName", "originalAmount", "replacementAmount", "additionalAmount", "refundAmount", "depositDelta", "preAuthDelta", "currency"]),
    employeeConfirmation: object({ operationKey: change.operationKey, confirmedAt: date, scope: { type: "string", enum: ["expense_only_not_inspection_or_execution"] } }),
    execution: { type: "string", enum: ["original_merchant_execution_not_connected", "original_merchant_execution_required", "original_merchant_receipt_required"] } }, ["id", "orderId", "workspaceId", "corporateCustomerId", "applicantCustomerId", "expectedOrderUpdatedAt", "revision", "state", "reason", "expiresAt", "exchange", "preview", "execution"]),
  EnterpriseExchangeApprovalList: { type: "array", items: ref("EnterpriseExchangeApprovalView") },
  EnterpriseExchangeCommandResult: object({ id: string, state: { type: "string", enum: ["pending", "approved", "rejected", "withdrawn"] }, revision: { type: "integer", minimum: 1 }, expiresAt: date }, ["id", "state", "revision"]),
};
