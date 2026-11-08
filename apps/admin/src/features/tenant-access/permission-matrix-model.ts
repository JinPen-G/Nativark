import type { PermissionModule, SystemRoleRow } from "@rental-os/shared";

export interface PermissionDraft {
  roleId: string;
  baseline: string;
  permissions: string[];
}

export interface RoleEditorTarget {
  section?: "profile" | "permissions" | "scope";
  query?: string;
  draft?: PermissionDraft;
}

export const rolePermissionCodes = (role: SystemRoleRow) => [...new Set([...role.permissions, ...role.buttonPermissions])];
export const isFixedRole = (role: SystemRoleRow) => role.fixedAllPermissions || rolePermissionCodes(role).includes("*");
export const roleHasPermission = (role: SystemRoleRow, code: string) => isFixedRole(role) || role.permissions.includes(code) || role.buttonPermissions.includes(code);

export function rolePermissionBaseline(role: SystemRoleRow) {
  return JSON.stringify([role.id, role.tenantId, role.code, role.name, role.description, role.scope,
    role.fixedAllPermissions, role.isActive, role.dataScope, [...role.enabledBusinessScopes].sort(), rolePermissionCodes(role).sort()]);
}

export function permissionDraftChanges(role: SystemRoleRow, draft: PermissionDraft | null) {
  const saved = new Set(rolePermissionCodes(role));
  const proposed = new Set(draft?.roleId === role.id ? draft.permissions : saved);
  return { added: [...proposed].filter(code => !saved.has(code)), removed: [...saved].filter(code => !proposed.has(code)) };
}

export function changePermissionDraft(role: SystemRoleRow, draft: PermissionDraft | null, codes: string[], enabled: boolean): PermissionDraft | null {
  if (isFixedRole(role) || draft && (draft.roleId !== role.id || draft.baseline !== rolePermissionBaseline(role))) return draft;
  const next = new Set(draft?.permissions ?? rolePermissionCodes(role));
  for (const code of codes) enabled ? next.add(code) : next.delete(code);
  const updated = { roleId: role.id, baseline: draft?.baseline ?? rolePermissionBaseline(role), permissions: [...next] };
  const changes = permissionDraftChanges(role, updated);
  return changes.added.length || changes.removed.length ? updated : null;
}

export function projectPermissionModules(modules: PermissionModule[], roles: SystemRoleRow[], query: string, moduleCode: string | undefined, differencesOnly: boolean, translate: (text: string) => string) {
  const normalized = query.trim().toLocaleLowerCase();
  return modules.filter(module => !moduleCode || module.code === moduleCode).map(module => ({
    ...module,
    children: module.children.filter(permission => {
      const matches = [translate(module.name), module.code, translate(permission.name), permission.code, permission.description && translate(permission.description)]
        .filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized);
      const different = roles.length > 1 && roles.some(role => roleHasPermission(role, permission.code) !== roleHasPermission(roles[0], permission.code));
      return matches && (!differencesOnly || roles.length < 2 || different);
    }),
  })).filter(module => module.children.length);
}

export interface PermissionCell { key: string; row: number; column: number }
export function nextPermissionCell(cells: PermissionCell[], current: PermissionCell, key: string, control = false) {
  const inRow = (row: number) => cells.filter(cell => cell.row === row).sort((left, right) => left.column - right.column);
  const currentRow = inRow(current.row);
  if (key === "ArrowLeft") return currentRow.filter(cell => cell.column < current.column).at(-1);
  if (key === "ArrowRight") return currentRow.find(cell => cell.column > current.column);
  if (key === "Home") return control ? cells[0] : currentRow[0];
  if (key === "End") return control ? cells.at(-1) : currentRow.at(-1);
  if (key !== "ArrowUp" && key !== "ArrowDown") return undefined;
  const rows = [...new Set(cells.map(cell => cell.row))].sort((left, right) => left - right);
  const nextRow = key === "ArrowUp" ? rows.filter(row => row < current.row).at(-1) : rows.find(row => row > current.row);
  return nextRow === undefined ? undefined : inRow(nextRow).sort((left, right) => Math.abs(left.column - current.column) - Math.abs(right.column - current.column))[0];
}
