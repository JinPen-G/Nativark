/** Exact preparation contracts. No execution or consent operation is published. */
import type { ContractOperation, SchemaObject } from "../../contracts/openapi-document";
const id: SchemaObject = { type: "string", minLength: 1, maxLength: 191 };
const hash: SchemaObject = { type: "string", pattern: "^[a-f0-9]{64}$" };
const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, SchemaObject>, required = Object.keys(properties)): SchemaObject => ({ type: "object", properties, required, additionalProperties: false });
const intent = object({ orderLineId: id, allocationId: id, replacementItemGroupId: id, replacementAssetId: id, replacementPricingGroupId: id,
  priceBasis: { type: "string", enum: ["original_order_price", "replacement_current_price"] }, originalDisposition: { type: "string", enum: ["return_to_warehouse", "off_shelf"] } },
  ["orderLineId", "allocationId", "replacementItemGroupId", "priceBasis", "originalDisposition"]);
const base = { expectedOrderUpdatedAt: { type: "string", format: "date-time" } as SchemaObject, exchange: intent };
const facts: SchemaObject = { type: "object", maxProperties: 100, additionalProperties: { oneOf: [{ type: "string", maxLength: 1000 }, { type: "number" }, { type: "boolean" }] } };
const photoReference = object({ fieldCode: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" }, sourceId: id,
  operationKey: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" }, fileAssetId: id });
const inspections: SchemaObject = { type: "array", maxItems: 40, items: object({ side: { type: "string", enum: ["original_return", "replacement_pickup"] },
  templateId: id, templateVersion: id, results: facts, photoSources: { type: "array", maxItems: 100, items: photoReference } },
  ["side", "templateId", "templateVersion", "results"]) };
const exceptions: SchemaObject = { type: "array", maxItems: 20, items: object({ code: { type: "string", minLength: 1, maxLength: 128 }, description: { type: "string", minLength: 1, maxLength: 500 }, allocationId: id }) };
const template = object({ id, tenantId: id, categoryCode: id, code: id, name: id, stage: { type: "string", enum: ["pickup", "return"] }, version: id,
  fields: { type: "array", maxItems: 100, items: object({ code: id, label: id, type: { type: "string", enum: ["boolean", "number", "text", "select", "photo"] }, required: { type: "boolean" }, unit: id,
    options: { type: "array", items: { type: "string" } }, usageMetric: { type: "boolean" } }, ["code", "label", "type", "required"]) }, enabled: { type: "boolean" },
  allocationIds: { type: "array", items: id }, sourceTemplateId: id, exchangeId: id }, ["id", "tenantId", "categoryCode", "code", "name", "stage", "version", "fields", "enabled"]);
const executionBasis = ref("RentalExchangeExecutionBasis");
const requirements = { ...base, orderId: id, workspaceId: id, requirementsHash: hash, executionBasis,
  templates: { type: "array", maxItems: 40, items: object({ side: { type: "string", enum: ["original_return", "replacement_pickup"] }, template }) } as SchemaObject,
  media: { type: "string", enum: ["unavailable", "dedicated_source_only", "dedicated_source_verified"] } as SchemaObject,
  reservation: { type: "string", enum: ["not_reserved"] } as SchemaObject };
export const RENTAL_EXCHANGE_INSPECTION_SCHEMAS: Record<string, SchemaObject> = {
  RentalExchangeInspectionRequirementsRequest: object(base),
  RentalExchangeInspectionRequirements: object(requirements),
  PrepareRentalExchangeInspectionRequest: object({ ...base, operationKey: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" }, expectedRevision: { type: "integer", enum: [0] },
    reason: { type: "string", minLength: 1, maxLength: 500 }, requirementsHash: hash, inspections, exceptions },
    [...Object.keys(base), "operationKey", "expectedRevision", "reason", "requirementsHash", "inspections"]),
  RentalExchangeInspectionPreparation: object({ ...requirements, id, actorUserId: id, operationKey: id, requestHash: hash, revision: { type: "integer", enum: [1] }, state: { type: "string", enum: ["prepared"] },
    reason: { type: "string", maxLength: 500 }, createdAt: { type: "string", format: "date-time" }, inspections, exceptions,
    customerConsent: { type: "string", enum: ["not_connected"] }, execution: { type: "string", enum: ["not_connected"] },
    acceptedMedia: { type: "array", maxItems: 50, items: object({ ...photoReference.properties,
      side: { type: "string", enum: ["original_return", "replacement_pickup"] }, templateId: id, templateVersion: id, contentHash: hash, completionHash: hash }) } },
    [...Object.keys(requirements), "id", "actorUserId", "operationKey", "requestHash", "revision", "state", "reason", "createdAt", "inspections", "exceptions", "customerConsent", "execution"]),
  RentalExchangeInspectionPreparationOriginal: { oneOf: [object({ state: { type: "string", enum: ["not_recorded"] }, retryable: { type: "boolean", enum: [false] } }),
    object({ state: { type: "string", enum: ["observed"] }, retryable: { type: "boolean", enum: [false] }, preparation: ref("RentalExchangeInspectionPreparation") })] },
};
const path = "/api/rental/v1/orders/{id}/exchange-inspection";
const mediaInput = { ...base, operationKey: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" } as SchemaObject, requirementsHash: hash,
  side: { type: "string", enum: ["original_return", "replacement_pickup"] } as SchemaObject, templateId: id, templateVersion: id,
  fieldCode: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" } as SchemaObject, fileName: { type: "string", minLength: 1, maxLength: 180 } as SchemaObject,
  mimeType: { type: "string", enum: ["image/png", "image/jpeg"] } as SchemaObject, sizeBytes: { type: "integer", minimum: 1, maximum: 20 * 1024 * 1024 } as SchemaObject };
const mediaSource = object({ ...mediaInput, id, orderId: id, workspaceId: id, actorUserId: id, requestHash: hash, sessionId: id, fileAssetId: id,
  createdAt: { type: "string", format: "date-time" }, expiresAt: { type: "string", format: "date-time" }, state: { type: "string", enum: ["pending_upload", "completion_unknown", "completed"] },
  completion: object({ contentHash: hash, sizeBytes: mediaInput.sizeBytes, mimeType: mediaInput.mimeType, width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 }, completedAt: { type: "string", format: "date-time" } }),
  preparationUse: { type: "string", enum: ["not_connected"] }, retryable: { type: "boolean", enum: [false] } },
  [...Object.keys(mediaInput), "id", "orderId", "workspaceId", "actorUserId", "requestHash", "sessionId", "fileAssetId", "createdAt", "expiresAt", "state", "preparationUse", "retryable"]);
Object.assign(RENTAL_EXCHANGE_INSPECTION_SCHEMAS, {
  RentalExchangeInspectionMediaRequirements: object({ ...requirements, media: { type: "string", enum: ["dedicated_source_only"] } }),
  CreateRentalExchangeInspectionMediaRequest: object(mediaInput),
  RentalExchangeInspectionMediaSource: mediaSource,
  RentalExchangeInspectionMediaOriginal: { oneOf: [object({ state: { type: "string", enum: ["not_recorded"] }, retryable: { type: "boolean", enum: [false] } }),
    object({ state: { type: "string", enum: ["observed"] }, source: ref("RentalExchangeInspectionMediaSource"), retryable: { type: "boolean", enum: [false] } })] },
  CreateRentalExchangeInspectionMediaResult: { oneOf: [ref("RentalExchangeInspectionMediaOriginal"), object({ source: ref("RentalExchangeInspectionMediaSource"), uploadUrl: { type: "string", format: "uri" }, uploadHeaders: { type: "object", additionalProperties: { type: "string" } } })] }
});
const operationKey: SchemaObject = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" };
const timestamp: SchemaObject = { type: "string", format: "date-time", maxLength: 40 };
const consentFields = { orderId: id, workspaceId: id, customerId: id, preparationId: id, preparationHash: hash, materialHash: hash,
  expectedOrderUpdatedAt: timestamp, operationKey };
const customerFields: SchemaObject = { type: "array", maxItems: 100, items: object({ code: id, label: id,
  type: { type: "string", enum: ["boolean", "number", "text", "select", "photo"] }, required: { type: "boolean" }, unit: id,
  options: { type: "array", items: { type: "string" } } }, ["code", "label", "type", "required"]) };
const approvedExecution = { operationKey, approvalId: id, expectedApprovalRevision: { type: "integer", minimum: 3, maximum: 2147483647 } as SchemaObject,
  expectedOrderUpdatedAt: timestamp, preparationId: id, preparationHash: hash, consentId: id, consentOperationKey: operationKey,
  reason: { type: "string", minLength: 1, maxLength: 500 } as SchemaObject, confirm: { type: "boolean", enum: [true] } as SchemaObject };
Object.assign(RENTAL_EXCHANGE_INSPECTION_SCHEMAS, {
  RentalExchangeInspectionCustomerMaterial: object({ orderId: id, workspaceId: id, customerId: id, preparationId: id, preparationHash: hash, materialHash: hash,
    expectedOrderUpdatedAt: timestamp, exchange: intent,
    templates: { type: "array", maxItems: 40, items: object({ side: { type: "string", enum: ["original_return", "replacement_pickup"] }, templateId: id,
      templateVersion: id, name: id, fields: customerFields }) },
    inspections: { type: "array", maxItems: 40, items: object({ side: { type: "string", enum: ["original_return", "replacement_pickup"] }, templateId: id, templateVersion: id, results: facts }) },
    exceptions, photos: { type: "array", maxItems: 50, items: object({ side: { type: "string", enum: ["original_return", "replacement_pickup"] }, templateId: id,
      fieldCode: id, fileAssetId: id, contentHash: hash }) } },
    ["orderId", "workspaceId", "customerId", "preparationId", "preparationHash", "materialHash", "expectedOrderUpdatedAt", "exchange", "templates", "inspections", "exceptions", "photos"]),
  ConfirmRentalExchangeInspectionRequest: object({ operationKey, expectedRevision: { type: "integer", enum: [0] }, preparationId: id,
    preparationHash: hash, materialHash: hash, expectedOrderUpdatedAt: timestamp, confirm: { type: "boolean", enum: [true] } }),
  RentalExchangeInspectionConsent: object({ ...consentFields, id, requestHash: hash, confirmedAt: timestamp, revision: { type: "integer", enum: [1] },
    state: { type: "string", enum: ["confirmed"] }, scope: { type: "string", enum: ["specific_exchange_inspection_and_handover"] }, retryable: { type: "boolean", enum: [false] } }),
  RentalExchangeInspectionConsentOriginal: { oneOf: [object({ state: { type: "string", enum: ["not_recorded"] }, retryable: { type: "boolean", enum: [false] } }),
    object({ state: { type: "string", enum: ["observed"] }, consent: ref("RentalExchangeInspectionConsent"), retryable: { type: "boolean", enum: [false] } })] },
  ExecuteApprovedRentalExchangeRequest: object(approvedExecution),
  RentalApprovedExchangeReceipt: object({ orderId: id, workspaceId: id, changeId: id, approvalId: id, preparationId: id, preparationHash: hash, consentId: id,
    consentOperationKey: operationKey, consentHash: hash, actorUserId: id, operationKey, coreIdempotencyKey: id, requestHash: hash, changeHash: hash, appliedAt: timestamp,
    state: { type: "string", enum: ["applied"] }, retryable: { type: "boolean", enum: [false] } }),
  RentalApprovedExchangeOriginal: { oneOf: [object({ state: { type: "string", enum: ["not_recorded"] }, retryable: { type: "boolean", enum: [false] } }),
    object({ state: { type: "string", enum: ["observed"] }, receipt: ref("RentalApprovedExchangeReceipt"), retryable: { type: "boolean", enum: [false] } })] }
});
export const RENTAL_EXCHANGE_INSPECTION_OPERATIONS: ContractOperation[] = [
  { method: "post", path: `${path}/media/requirements`, operationId: "rentalExchangeInspectionMediaRequirements", requestSchema: "RentalExchangeInspectionRequirementsRequest", responseSchema: "RentalExchangeInspectionMediaRequirements", summary: "Read original dedicated photo source requirements; not preparation acceptance" },
  { method: "post", path: `${path}/media/uploads`, operationId: "createRentalExchangeInspectionMedia", requestSchema: "CreateRentalExchangeInspectionMediaRequest", responseSchema: "CreateRentalExchangeInspectionMediaResult", summary: "Create a dedicated upload once; an existing key only observes" },
  { method: "get", path: `${path}/media/operations/{key}`, operationId: "readRentalExchangeInspectionMediaOriginal", responseSchema: "RentalExchangeInspectionMediaOriginal", summary: "Read exact source key without PUT URL or provider request" },
  { method: "post", path: `${path}/media/operations/{key}/complete`, operationId: "completeRentalExchangeInspectionMedia", responseSchema: "RentalExchangeInspectionMediaOriginal", summary: "Claim and verify original bounded bytes once; unknown only observes durable evidence" },
  { method: "post", path: `${path}/requirements`, operationId: "rentalExchangeInspectionRequirements", requestSchema: "RentalExchangeInspectionRequirementsRequest", responseSchema: "RentalExchangeInspectionRequirements", summary: "Read pre-execution inspection requirements without fulfillment" },
  { method: "post", path: `${path}/preparations`, operationId: "prepareRentalExchangeInspection", requestSchema: "PrepareRentalExchangeInspectionRequest", responseSchema: "RentalExchangeInspectionPreparation", summary: "Record inspection preparation without consent or execution" },
  { method: "get", path: `${path}/preparations/{preparationId}`, operationId: "readRentalExchangeInspectionPreparation", responseSchema: "RentalExchangeInspectionPreparation", summary: "Read own original inspection preparation" },
  { method: "get", path: `${path}/operations/{key}`, operationId: "readRentalExchangeInspectionPreparationOriginal", responseSchema: "RentalExchangeInspectionPreparationOriginal", summary: "Read exact durable preparation key; missing is not retryable" },
].map(value => ({ ...value, tag: "RentalCore", permissions: ["rental-os:order:operate"] })) as ContractOperation[];
