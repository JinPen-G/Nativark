export type RentalAssigneeDataScope = "all" | "organization" | "store" | "own";
export type RentalAssigneeLocationScope = { mode: "all" | "selected"; locationIds: string[] };

type ScopeRole = {
  isActive?: boolean;
  fixedAllPermissions?: boolean;
  dataScope?: string | null;
} | null | undefined;

/**
 * Mirrors the workspace-member scope precedence used by PlatformRepository:
 * an explicit workspace role replaces tenant roles, then member.dataScope overrides it.
 */
export function resolveWorkspaceMemberDataScope(input: {
  isPlatformAdmin?: boolean;
  memberDataScope?: string | null;
  memberRoleId?: string | null;
  memberRole?: ScopeRole;
  userRole?: ScopeRole;
  userRoleAssignments?: ScopeRole[];
}): RentalAssigneeDataScope | undefined {
  const normalize = (value?: string | null): RentalAssigneeDataScope | undefined => {
    const normalized = value?.toLowerCase();
    return normalized === "all" || normalized === "organization" || normalized === "store" || normalized === "own"
      ? normalized
      : undefined;
  };

  let inherited: RentalAssigneeDataScope = "own";
  if (input.memberRoleId && !input.memberRole?.isActive) return undefined;
  if (input.isPlatformAdmin) {
    inherited = "all";
  } else if (input.memberRoleId && input.memberRole?.isActive) {
    inherited = input.memberRole.fixedAllPermissions ? "all" : normalize(input.memberRole.dataScope) ?? "own";
  } else {
    const roles = [...(input.userRoleAssignments ?? []), input.userRole]
      .filter((role): role is NonNullable<ScopeRole> => Boolean(role?.isActive));
    if (roles.some((role) => role.fixedAllPermissions)) {
      inherited = "all";
    } else {
      const order: RentalAssigneeDataScope[] = ["own", "store", "organization", "all"];
      inherited = roles
        .map((role) => normalize(role.dataScope) ?? "own")
        .sort((left, right) => order.indexOf(right) - order.indexOf(left))[0] ?? "own";
    }
  }
  return normalize(input.memberDataScope) ?? inherited;
}

/** undefined means every location; [] means no location (fail-closed). */
export function resolveAssigneeLocationIds(
  dataScope: RentalAssigneeDataScope,
  configuredScope: unknown,
  organizationLocationIds: string[]
): string[] | undefined {
  let configured: RentalAssigneeLocationScope = { mode: "all", locationIds: [] };
  if (configuredScope !== null && configuredScope !== undefined) {
    if (!configuredScope || typeof configuredScope !== "object" || Array.isArray(configuredScope)) return [];
    const value = configuredScope as { mode?: unknown; locationIds?: unknown };
    if (value.mode === "all" && Array.isArray(value.locationIds) && value.locationIds.length === 0) {
      configured = { mode: "all", locationIds: [] };
    } else if (
      value.mode === "selected" && Array.isArray(value.locationIds) &&
      value.locationIds.every((id) => typeof id === "string")
    ) {
      configured = { mode: "selected", locationIds: [...new Set(value.locationIds as string[])] };
    } else {
      return [];
    }
  }

  if (dataScope !== "organization") {
    return configured.mode === "all" ? undefined : configured.locationIds;
  }
  const mapped = new Set(organizationLocationIds);
  return [...new Set(organizationLocationIds)]
    .filter((id) => configured.mode === "all" || mapped.has(id) && configured.locationIds.includes(id))
    .sort((left, right) => left.localeCompare(right));
}

export function assigneeCanAccessLocation(locationIds: string[] | undefined, locationId: string) {
  return locationIds === undefined || locationIds.includes(locationId);
}

export function assigneeScopesOverlap(left: string[] | undefined, right: string[]) {
  return left === undefined || left.some((id) => right.includes(id));
}
