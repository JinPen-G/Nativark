/** Enterprise portal schemas: masked customer projections, never operator DTOs. */
import type { SchemaObject } from "./openapi-document";
import { ENTERPRISE_PORTAL_ACTIONS } from "@rental-os/shared";
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
  EnterpriseMembersResponse: object({ apiVersion: { type: "string", enum: ["v1"] }, corporateCustomerId: string, permissionRevision: string, items: array(ref("EnterpriseMemberView")), page: integer, pageSize: integer, total: integer })
};
