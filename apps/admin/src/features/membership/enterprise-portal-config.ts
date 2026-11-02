/** Full grant replacement is explicit: entry-only grants remain independently editable. */
import { ENTERPRISE_PORTAL_ACTIONS, type EnterprisePortalAction, type EnterprisePortalGrant } from "@rental-os/shared";
export interface PortalAccessForm { enabled: boolean; entryMembershipIds: string[]; memberMembershipIds: string[]; reason: string; actionMembershipIds?: Record<string, string[]> }
export function portalAccessGrants(values: PortalAccessForm, previous: EnterprisePortalGrant[] = []): EnterprisePortalGrant[] {
  const entry = new Set(values.entryMembershipIds ?? []), members = new Set(values.memberMembershipIds ?? []);
  if ([...members].some(id => !entry.has(id))) throw new Error("成员查看必须同时具有企业入口授权 / Member viewing requires portal entry");
  for (const [action, ids] of Object.entries(values.actionMembershipIds ?? {})) {
    if (!ENTERPRISE_PORTAL_ACTIONS.some(value => value === action) || action === "portal:enter" || action === "members:read"
      || !Array.isArray(ids) || ids.some(id => typeof id !== "string" || !entry.has(id))) {
      throw new Error("管理动作必须已登记，且目标须同时具有企业入口授权 / Management grants require a registered action and portal entry");
    }
  }
  return [...entry].map(membershipId => {
    const actions: EnterprisePortalAction[] = ["portal:enter", ...(previous.find(g => g.membershipId === membershipId)?.actions.filter(action => action !== "portal:enter" && action !== "members:read") ?? [])];
    if (values.actionMembershipIds) {
      for (const [action, ids] of Object.entries(values.actionMembershipIds)) {
        if (action === "portal:enter" || action === "members:read") continue;
        const index = actions.indexOf(action as EnterprisePortalAction);
        if (index >= 0) actions.splice(index, 1);
        if (ids.includes(membershipId)) actions.push(action as EnterprisePortalAction);
      }
    }
    if (members.has(membershipId)) actions.push("members:read");
    return { membershipId, actions };
  });
}
export function isPortalRevisionConflict(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { code?: string } } } | null)?.response;
  return response?.status === 409 && response.data?.code === "enterprise_revision_conflict";
}
