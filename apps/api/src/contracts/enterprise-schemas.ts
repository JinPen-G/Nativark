/** Enterprise portal schemas: masked customer projections, never operator DTOs. */
import type { SchemaObject } from "./openapi-document";
import { ENTERPRISE_ORDER_EXPORT_LIMIT, ENTERPRISE_ORDER_GROUPS, ENTERPRISE_PORTAL_ACTIONS } from "@rental-os/shared";
import { ENTERPRISE_WORKFLOW_SCHEMAS } from "../modules/enterprise/enterprise-workflow-schemas";
import { ENTERPRISE_EXCHANGE_SCHEMAS } from "../modules/enterprise/enterprise-exchange-schemas";
import { ENTERPRISE_EXTENSION_SCHEMAS } from "../modules/enterprise/enterprise-extension-schemas";
import { ENTERPRISE_TRANSFER_DECISION_SCHEMAS } from "../modules/enterprise/enterprise-transfer-decision.schemas";
const string: SchemaObject = { type: "string" };
const integer: SchemaObject = { type: "integer", minimum: 0 };
const boolean: SchemaObject = { type: "boolean" };
const object = (properties: Record<string, SchemaObject>, required = Object.keys(properties)): SchemaObject => ({ type: "object", properties, required, additionalProperties: false });
const array = (items: SchemaObject): SchemaObject => ({ type: "array", items });
const ref = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
const grant = object({ membershipId: string, actions: array({ type: "string", enum: [...ENTERPRISE_PORTAL_ACTIONS] }) });
const change = { enabled: boolean, expectedRevision: integer, operationKey: { type: "string", minLength: 1, maxLength: 128 }, reason: { type: "string", minLength: 1, maxLength: 500 } };
const nullableText: SchemaObject = { type: "string", nullable: true };
const nullableMoney: SchemaObject = { type: "number", nullable: true };
const instant: SchemaObject = { type: "string", format: "date-time" };
const orderIndex = {
  orderId: string, orderNo: string, group: { type: "string", enum: [...ENTERPRISE_ORDER_GROUPS] } as SchemaObject,
  categoryCode: string, status: string, employeeCustomerId: nullableText, employeeName: nullableText, corporateMembershipId: nullableText,
  startAt: instant, endAt: instant, effectiveEndAt: { ...instant, nullable: true }, currentReturnAt: instant, currency: nullableText,
  payableAmount: nullableMoney, finalPayableAmount: nullableMoney, discountAmount: nullableMoney, createdAt: instant, updatedAt: instant
};
const orderScope = {
  apiVersion: { type: "string", enum: ["v1"] } as SchemaObject, tenantCode: string, corporateCustomerId: string, permissionRevision: string,
  workspaceId: string, workspaceCode: string, workspaceName: string,
  coverage: { type: "string", enum: ["current_workspace_authorized_enterprise_orders"] } as SchemaObject
};
export const ENTERPRISE_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  ...ENTERPRISE_WORKFLOW_SCHEMAS,
  ...ENTERPRISE_EXTENSION_SCHEMAS,
  ...ENTERPRISE_EXCHANGE_SCHEMAS,
  ...ENTERPRISE_TRANSFER_DECISION_SCHEMAS,
  EnterpriseTenantSettings: object({ enabled: boolean, revision: integer }),
  EnterprisePortalOperationResponse: object({ state: { type: "string", enum: ["not_recorded", "committed"] }, result: { type: "object", additionalProperties: true } }, ["state"]),
  SaveEnterpriseTenantSettingsRequest: object(change),
  EnterprisePortalConfiguration: object({ tenantEnabled: boolean, tenantRevision: integer, corporateCustomerId: string, enabled: boolean, revision: integer, grants: array(grant) }),
  SaveEnterprisePortalConfigurationRequest: object({ ...change, grants: { type: "array", maxItems: 200, items: grant } }),
  EnterprisePortalChangeResult: object({ corporateCustomerId: string, enabled: boolean, revision: integer, grants: array(grant) }),
  EnterpriseManagedCorporate: object({ corporateCustomerId: string, corporateName: string, membershipId: string, actions: grant.properties!.actions, permissionRevision: string }),
  EnterpriseEntryResponse: object({ apiVersion: { type: "string", enum: ["v1"] }, tenantCode: string, tenantName: string, customerId: string, displayName: string,
    state: { type: "string", enum: ["ready", "not_enabled", "membership_restricted", "no_management_access"] }, corporates: array(ref("EnterpriseManagedCorporate")), ownRelations: array(object({ corporateCustomerId: string, corporateName: string, role: string })) }),
  EnterpriseMemberView: object({ membershipId: string, displayName: string, updatedAt: { type: "string", format: "date-time" }, role: string, department: string, employeeNo: string, status: string, effectiveFrom: { type: "string", format: "date-time" }, effectiveTo: { type: "string", format: "date-time" } }, ["membershipId", "displayName", "updatedAt", "role", "status", "effectiveFrom"]),
  EnterpriseAdministratorView: object({ membershipId: string, role: { type: "string", enum: ["admin", "employee"] }, actions: grant.properties!.actions, updatedAt: { type: "string", format: "date-time" }, revision: integer }),
  EnterpriseOwnRelation: object({ membershipId: string, corporateCustomerId: string, corporateName: string, displayName: string, updatedAt: { type: "string", format: "date-time" }, role: string, status: string, department: string, employeeNo: string, effectiveFrom: { type: "string", format: "date-time" }, effectiveTo: { type: "string", format: "date-time" } }, ["membershipId", "corporateCustomerId", "corporateName", "displayName", "updatedAt", "role", "status", "effectiveFrom"]),
  EnterpriseOwnRelations: array(ref("EnterpriseOwnRelation")),
  EnterpriseMembersResponse: object({ apiVersion: { type: "string", enum: ["v1"] }, corporateCustomerId: string, permissionRevision: string, items: array(ref("EnterpriseMemberView")), page: integer, pageSize: integer, total: integer }),
  EnterpriseOrdersQuery: object({ group: orderIndex.group, keyword: { type: "string", maxLength: 120 },
    page: { type: "integer", minimum: 1, maximum: 1_000_000 }, pageSize: { type: "integer", minimum: 1, maximum: 50 } }, []),
  EnterpriseOrderIndex: object(orderIndex),
  EnterpriseOrderLineView: object({ lineId: string, itemGroupName: string, pricingGroupName: nullableText, quantity: integer,
    cancelledQuantity: integer, amount: nullableMoney }),
  EnterpriseOrderBenefitView: object({ planName: string, type: string, appliesTo: string, appliedAmount: nullableMoney }),
  EnterpriseOrderDetail: object({ ...orderIndex, corporateName: nullableText, fulfillmentMode: string, rentalAmount: nullableMoney,
    serviceAmount: nullableMoney, fulfillmentAmount: nullableMoney, couponAmount: nullableMoney, adjustmentAmount: nullableMoney,
    taxAmount: nullableMoney, depositAmount: nullableMoney, preAuthAmount: nullableMoney,
    disclosure: { ...object({ noticeVersion: string, acknowledgedAt: instant }), nullable: true },
    lines: { type: "array", maxItems: 200, items: ref("EnterpriseOrderLineView") },
    chargeLines: { type: "array", maxItems: 1000, items: object({ code: string, name: string, type: string, amount: nullableMoney }) },
    corporateBenefits: { type: "array", nullable: true, maxItems: 200, items: ref("EnterpriseOrderBenefitView") } }),
  EnterpriseOrdersResponse: object({ ...orderScope, group: orderIndex.group, items: { type: "array", maxItems: 50, items: ref("EnterpriseOrderIndex") },
    page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 50 }, total: integer }),
  EnterpriseOrderDetailResponse: object({ ...orderScope, order: ref("EnterpriseOrderDetail") }),
  EnterpriseOrderExportQuery: object({ group: orderIndex.group, keyword: { type: "string", maxLength: 120 } }, []),
  EnterpriseOrderExportResponse: object({ ...orderScope, group: orderIndex.group,
    items: { type: "array", maxItems: ENTERPRISE_ORDER_EXPORT_LIMIT, items: ref("EnterpriseOrderIndex") }, total: integer,
    maxRows: { type: "integer", enum: [ENTERPRISE_ORDER_EXPORT_LIMIT] } })
};
