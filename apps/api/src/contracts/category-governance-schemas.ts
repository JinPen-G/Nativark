import { CATEGORY_PREPARATION_LIMITS, RENTAL_CAPABILITY_CODES, RENTAL_CATEGORY_CODE_PATTERN, RENTAL_CATEGORY_TEMPLATE_IDS,
  RentalInventoryMode, RENTAL_PRICING_UNIT_CODES, RENTAL_FULFILLMENT_MODES } from "@rental-os/shared";
import type { SchemaObject } from "./openapi-document";

/** HTTP schemas for staged category changes. They expose no active write or
 * adoption permission; the same tenant/space guard and Core validator apply. */
const identifier: SchemaObject = { type: "string", minLength: 1, maxLength: 191, pattern: "\\S" };
const capabilityCode: SchemaObject = { type: "string", enum: [...RENTAL_CAPABILITY_CODES] };
export const CATEGORY_PREPARATION_PREVIEW_SCHEMA: SchemaObject = {
  type: "object", additionalProperties: true, properties: {
    sourceVersionId: identifier, sourceRevision: { type: "integer", minimum: 0 }, targetVersionId: identifier, targetVersionLabel: identifier,
    targetPolicyRevision: { type: "integer", minimum: 0 },
    targetDefinition: { type: "object", additionalProperties: true },
    registeredCapabilityVersions: { type: "array", items: identifier },
    validation: { type: "object", properties: { valid: { type: "boolean" }, errors: { type: "array", items: { type: "string" } } }, required: ["valid", "errors"] },
    businessCompatibility: { type: "object", additionalProperties: true, properties: {
      valid: { type: "boolean" }, complete: { type: "boolean" },
      blockers: { type: "array", items: { type: "object", properties: { domain: { type: "string" }, id: { type: "string" }, message: { type: "string" } }, required: ["domain", "id", "message"] } },
      requiredCapabilityCodes: { type: "array", uniqueItems: true, items: capabilityCode },
      conditionalReadiness: { type: "object", additionalProperties: false, properties: {
        required: { type: "array", uniqueItems: true, items: capabilityCode }, checkedItemGroupCount: { type: "integer", minimum: 0, maximum: CATEGORY_PREPARATION_LIMITS.collectionEntities },
        matches: { type: "array", maxItems: 512, items: { type: "object", additionalProperties: false, properties: {
          code: capabilityCode, fulfillmentMode: { type: "string", enum: [...RENTAL_FULFILLMENT_MODES] },
          itemGroupIds: { type: "array", maxItems: CATEGORY_PREPARATION_LIMITS.collectionEntities, uniqueItems: true, items: identifier }
        }, required: ["code", "fulfillmentMode", "itemGroupIds"] } }
      }, required: ["required", "checkedItemGroupCount", "matches"] }
    }, required: ["valid", "complete", "blockers"] },
    stale: { type: "boolean" }, previewOnly: { type: "boolean", enum: [true] }, adoptionImplemented: { type: "boolean" },
    entities: { type: "object", additionalProperties: true }, preparation: { type: "object", nullable: true, additionalProperties: true }
  }, required: ["sourceVersionId", "sourceRevision", "targetVersionId", "targetVersionLabel", "targetDefinition", "validation", "businessCompatibility", "stale", "adoptionImplemented", "entities", "preparation"]
};
const creationProperties: Record<string, SchemaObject> = {
  code: { type: "string", pattern: RENTAL_CATEGORY_CODE_PATTERN.source, maxLength: 64 }, name: { type: "string", minLength: 1, maxLength: 100, pattern: "\\S" },
  templateId: { type: "string", enum: [...RENTAL_CATEGORY_TEMPLATE_IDS] }, sourceVersionId: identifier,
  versionLabel: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", maxLength: 64 },
  inventoryModes: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: { type: "string", enum: Object.values(RentalInventoryMode) } },
  pricingUnits: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", enum: [...RENTAL_PRICING_UNIT_CODES] } },
  defaultPricingUnit: { type: "string", enum: [...RENTAL_PRICING_UNIT_CODES] },
  fulfillmentModes: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: { type: "string", enum: [...RENTAL_FULFILLMENT_MODES] } },
  capabilityCodes: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string", enum: [...RENTAL_CAPABILITY_CODES] } }
};
const creationRequired = ["code", "name", "versionLabel", "inventoryModes", "pricingUnits", "defaultPricingUnit", "fulfillmentModes", "capabilityCodes"];
export const CATEGORY_CREATION_PREVIEW_REQUEST_SCHEMA: SchemaObject = { type: "object", additionalProperties: false, properties: creationProperties,
  required: creationRequired, oneOf: [{ type: "object", required: ["templateId"] }, { type: "object", required: ["sourceVersionId"] }] };
export const CATEGORY_CREATION_REQUEST_SCHEMA: SchemaObject = { ...CATEGORY_CREATION_PREVIEW_REQUEST_SCHEMA,
  properties: { ...creationProperties, expectedDefinitionHash: { type: "string", pattern: "^[a-f0-9]{64}$", maxLength: 64 },
    idempotencyKey: { type: "string", pattern: "^[A-Za-z0-9._:-]{8,128}$", maxLength: 128 }, reason: { type: "string", minLength: 1, maxLength: 512, pattern: "\\S" } },
  required: [...creationRequired, "expectedDefinitionHash", "idempotencyKey", "reason"] };
export const CATEGORY_CREATED_VERSION_SCHEMA: SchemaObject = { type: "object", additionalProperties: false, properties: {
  id: identifier, categoryCode: creationProperties.code, versionLabel: creationProperties.versionLabel,
  structureVersion: { type: "integer", enum: [1] }, revision: { type: "integer", minimum: 0 }, status: { type: "string", enum: ["draft"] },
  sourceKind: { type: "string", maxLength: 32 }, sourceVersionId: { ...identifier, nullable: true }, definition: { type: "object", additionalProperties: true },
  dependencyDigest: { type: "object", additionalProperties: true, nullable: true },
  publishedAt: { type: "string", format: "date-time", nullable: true }, publishedBy: { ...identifier, nullable: true }, publishReason: { type: "string", nullable: true },
  createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }
}, required: ["id", "categoryCode", "versionLabel", "structureVersion", "revision", "status", "sourceKind", "definition", "createdAt", "updatedAt"] };
export const CATEGORY_CREATION_PREVIEW_SCHEMA: SchemaObject = { type: "object", additionalProperties: false, properties: {
  valid: { type: "boolean" }, errors: { type: "array", items: { type: "string" } }, definition: { type: "object", additionalProperties: true },
  definitionHash: { type: "string", pattern: "^[a-f0-9]{64}$" }, removedCapabilities: { type: "array", items: { type: "string", enum: [...RENTAL_CAPABILITY_CODES] } },
  previewOnly: { type: "boolean", enum: [true] }
}, required: ["valid", "errors", "definition", "definitionHash", "removedCapabilities", "previewOnly"] };
export const CATEGORY_CREATION_RECEIPT_SCHEMA: SchemaObject = { oneOf: [
  { type: "object", additionalProperties: false, properties: { outcome: { type: "string", enum: ["created"] }, version: CATEGORY_CREATED_VERSION_SCHEMA }, required: ["outcome", "version"] },
  { type: "object", additionalProperties: false, properties: { outcome: { type: "string", enum: ["unknown"] } }, required: ["outcome"] }
] };
const revision: SchemaObject = { type: "integer", minimum: 0 };
const entityType: SchemaObject = { type: "string", enum: ["item_group", "asset"] };
const fieldValue: SchemaObject = { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] };
const entityPatch: SchemaObject = {
  type: "object", additionalProperties: false,
  properties: {
    entityType, entityId: identifier, expectedUpdatedAt: { type: "string", format: "date-time", maxLength: 32 },
    values: { type: "object", additionalProperties: fieldValue, maxProperties: 100 }
  }, required: ["entityType", "entityId", "expectedUpdatedAt", "values"]
};
const capabilityPatch: SchemaObject = {
  type: "object", additionalProperties: false,
  properties: {
    code: { type: "string", enum: [...RENTAL_CAPABILITY_CODES] }, intent: { type: "string", enum: ["configure", "enable_new"] },
    expectedRevision: revision, expectedImplementationVersion: identifier, config: { type: "object", additionalProperties: true }
  }, required: ["code", "expectedRevision", "expectedImplementationVersion", "config"]
};
const commonProperties: Record<string, SchemaObject> = {
  expectedSourceVersionId: identifier, expectedSourceRevision: revision, expectedPreparationRevision: revision,
  operation: { type: "string", enum: ["upgrade", "restore"] }, reason: { type: "string", minLength: 1, maxLength: 512, pattern: "\\S" },
  patches: { type: "array", maxItems: CATEGORY_PREPARATION_LIMITS.batchEntities, items: entityPatch },
  capabilityPatches: { type: "array", maxItems: 100, items: capabilityPatch }
};
const required = ["expectedSourceVersionId", "expectedSourceRevision", "expectedPreparationRevision", "operation", "reason", "patches"];
export const CATEGORY_PREPARATION_REQUEST_SCHEMA: SchemaObject = {
  type: "object", additionalProperties: false, properties: commonProperties, required
};
export const CATEGORY_PREPARATION_BATCH_REQUEST_SCHEMA: SchemaObject = {
  type: "object", additionalProperties: false,
  properties: {
    ...commonProperties,
    batchId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$" },
    resetPreparation: { type: "boolean" },
    removeCapabilityCodes: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", enum: [...RENTAL_CAPABILITY_CODES] } },
    removals: {
      type: "array", maxItems: CATEGORY_PREPARATION_LIMITS.batchEntities,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          entityType, entityId: identifier,
          fieldCodes: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" } }
        }, required: ["entityType", "entityId"]
      }
    }
  }, required: [...required, "batchId"]
};
export const CATEGORY_PREPARATION_SAVE_RESULT_SCHEMA: SchemaObject = {
  type: "object", additionalProperties: false,
  properties: {
    id: identifier, revision, sourceRevision: revision, targetVersionId: identifier,
    preparedOnly: { type: "boolean", enum: [true] }, adoptionImplemented: { type: "boolean" },
    batchId: { type: "string" }, entityCount: { type: "integer", minimum: 0 }, replayed: { type: "boolean" }
  }, required: ["id", "revision", "sourceRevision", "targetVersionId", "preparedOnly", "adoptionImplemented"]
};
export const CATEGORY_PREPARATION_BATCH_READ_SCHEMA: SchemaObject = {
  oneOf: [
    { type: "object", additionalProperties: false, properties: { outcome: { type: "string", enum: ["saved"] }, result: CATEGORY_PREPARATION_SAVE_RESULT_SCHEMA }, required: ["outcome", "result"] },
    { type: "object", additionalProperties: false, properties: { outcome: { type: "string", enum: ["unknown"] } }, required: ["outcome"] }
  ]
};
export const CATEGORY_ADOPTION_REQUEST_SCHEMA: SchemaObject = {
  type: "object", additionalProperties: false, properties: {
    expectedSourceVersionId: identifier, expectedSourceRevision: { ...revision, maximum: 2147483646 },
    expectedPreparationRevision: { type: "integer", minimum: 1, maximum: 2147483646 },
    expectedTargetPolicyRevision: { ...revision, maximum: 2147483646 }, operation: { type: "string", enum: ["upgrade", "restore"] },
    idempotencyKey: { type: "string", pattern: "^[A-Za-z0-9._:-]{8,128}(?![\\s\\S])", minLength: 8, maxLength: 128 },
    reason: { type: "string", minLength: 1, maxLength: 512, pattern: "\\S" }
  }, required: ["expectedSourceVersionId", "expectedSourceRevision", "expectedPreparationRevision", "expectedTargetPolicyRevision", "operation", "idempotencyKey", "reason"]
};
export const CATEGORY_ADOPTION_RESULT_SCHEMA: SchemaObject = {
  type: "object", additionalProperties: false, properties: {
    outcome: { type: "string", enum: ["adopted"] }, operation: { type: "string", enum: ["upgrade", "restore"] },
    categoryCode: { type: "string", pattern: RENTAL_CATEGORY_CODE_PATTERN.source, maxLength: 64 },
    sourceVersionId: identifier, sourceRevision: revision, targetVersionId: identifier,
    adoptionRevision: { type: "integer", minimum: 1 }, preparationRevision: { type: "integer", minimum: 1 },
    targetPolicyRevision: revision, auditId: identifier, adoptedAt: { type: "string", format: "date-time" }
  }, required: ["outcome", "operation", "categoryCode", "sourceVersionId", "sourceRevision", "targetVersionId", "adoptionRevision", "preparationRevision", "targetPolicyRevision", "auditId", "adoptedAt"]
};
export const CATEGORY_ADOPTION_RECEIPT_SCHEMA: SchemaObject = { oneOf: [
  { type: "object", additionalProperties: false, properties: { outcome: { type: "string", enum: ["adopted"] }, result: CATEGORY_ADOPTION_RESULT_SCHEMA }, required: ["outcome", "result"] },
  { type: "object", additionalProperties: false, properties: { outcome: { type: "string", enum: ["unknown"] } }, required: ["outcome"] }
] };
export const CATEGORY_PREPARATION_ENTITY_PAGE_SCHEMA: SchemaObject = {
  type: "object", additionalProperties: false,
  properties: {
    entityType, sourceVersionId: identifier, sourceRevision: revision, preparationRevision: revision,
    total: { type: "integer", minimum: 0 }, nextCursor: identifier,
    rows: {
      type: "array", maxItems: 100,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          id: identifier, updatedAt: { type: "string", format: "date-time" },
          name: { type: "string" }, assetNo: { type: "string" }, serialNo: { type: "string", nullable: true },
          attributes: { type: "object", additionalProperties: true }, prepared: entityPatch, preparationStale: { type: "boolean" }
        }, required: ["id", "updatedAt", "attributes", "preparationStale"]
      }
    }
  }, required: ["entityType", "sourceVersionId", "sourceRevision", "preparationRevision", "total", "rows"]
};
