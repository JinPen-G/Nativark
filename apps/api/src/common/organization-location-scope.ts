export interface OrganizationScopeNode {
  id: string;
  parentId: string | null;
  status: string;
}

export interface OrganizationLocationScope {
  mode: "all" | "selected";
  locationIds: string[];
}

/**
 * Resolve the enabled subtree rooted at an operator's organization.
 * The caller must tenant-scope the input rows before invoking this helper.
 * Missing/disabled roots and disabled intermediate nodes fail closed.
 */
export function enabledOrganizationSubtreeIds(
  organizations: OrganizationScopeNode[],
  rootId: string
): string[] {
  const byId = new Map(organizations.map((organization) => [organization.id, organization]));
  const root = byId.get(rootId);
  if (!root || root.status !== "enabled") return [];

  const children = new Map<string, OrganizationScopeNode[]>();
  for (const organization of organizations) {
    if (!organization.parentId) continue;
    const siblings = children.get(organization.parentId) ?? [];
    siblings.push(organization);
    children.set(organization.parentId, siblings);
  }

  const result: string[] = [];
  const visited = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const current = byId.get(id);
    if (!current || current.status !== "enabled") continue;
    result.push(id);
    for (const child of children.get(id) ?? []) {
      if (child.status === "enabled") pending.push(child.id);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}

/**
 * An organization scope is always a concrete selected-location scope.
 * An administrator-provided location allowlist can only narrow, never widen, it.
 */
export function organizationLocationScope(
  mappedLocationIds: string[],
  configuredScope: OrganizationLocationScope
): OrganizationLocationScope {
  const mapped = [...new Set(mappedLocationIds)].sort((left, right) => left.localeCompare(right));
  const allowed = configuredScope.mode === "selected"
    ? new Set(configuredScope.locationIds)
    : undefined;
  return {
    mode: "selected",
    locationIds: allowed ? mapped.filter((id) => allowed.has(id)) : mapped
  };
}
