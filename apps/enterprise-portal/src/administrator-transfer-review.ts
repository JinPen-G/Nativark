/** Decode only recorded transfer review material from the public WorkflowView payload.
 * This shape check is not current authority; the original server decision remains authoritative. */
import { ENTERPRISE_PORTAL_ACTIONS, type EnterprisePortalAction, type EnterpriseWorkflowView } from "@rental-os/shared";
type TransferReviewMaterial = {
  outgoingRelationshipId: string;
  outgoingRevision: string;
  incomingRevision: string;
  permissionRevision: string;
  actions: EnterprisePortalAction[];
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const reference = (value: unknown): value is string => typeof value === "string" && Boolean(value);
const revision = (value: unknown): value is string => reference(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function readAdministratorTransferMaterial(row: EnterpriseWorkflowView): TransferReviewMaterial | undefined {
  if (row.kind !== "administrator_transfer" || !record(row.payload)) return undefined;
  const payload = row.payload, basis = payload.authorityBasis;
  // Never fill legacy/partial material with current relationships, grants or browser state.
  if (!reference(payload.fromCustomerId) || !reference(payload.targetMembershipId) || !record(basis) || basis.version !== 1
      || !reference(basis.fromMembershipId) || !revision(basis.fromUpdatedAt) || !revision(basis.targetUpdatedAt)
      || typeof basis.permissionRevision !== "string" || !/^\d+:\d+$/.test(basis.permissionRevision)
      || !Array.isArray(basis.actions) || basis.actions.length > ENTERPRISE_PORTAL_ACTIONS.length
      || new Set(basis.actions).size !== basis.actions.length
      || basis.actions.some(action => !ENTERPRISE_PORTAL_ACTIONS.includes(action as EnterprisePortalAction))
      || !basis.actions.includes("portal:enter") || !basis.actions.includes("administrators:manage")) return undefined;
  return {
    outgoingRelationshipId: basis.fromMembershipId, outgoingRevision: basis.fromUpdatedAt,
    incomingRevision: basis.targetUpdatedAt, permissionRevision: basis.permissionRevision,
    actions: [...basis.actions] as EnterprisePortalAction[],
  };
}
