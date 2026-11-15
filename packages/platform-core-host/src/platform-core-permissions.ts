/** 显式部署事务登记所选Core的权限元数据；保留原权限ID/角色关系，不分配Core或修改成员权限。 */
import { randomUUID } from "node:crypto";
import { CoreManifestSchema, corePermissionCode, type CoreManifest } from "@rental-os/core-contracts";

export interface CorePermissionRegistrationTransaction {
  permission: {
    findMany(input: { where: { code: { in: string[] } } }): PromiseLike<Array<{ code: string; module: string; kind: string }>>;
    upsert(input: { where: { code: string }; create: { id: string; code: string; name: string; module: string; kind: "ACTION" };
      update: { name: string; module: string } }): PromiseLike<unknown>;
  };
}

/** 调用方须在受控部署的Serializable事务中执行；先核全部清单及现存归属，再更新本Core声明。 */
export async function registerPlatformCorePermissions(transaction: CorePermissionRegistrationTransaction, input: readonly CoreManifest[]) {
  const manifests = input.map(manifest => CoreManifestSchema.parse(manifest)), ids = new Set<string>();
  const declarations = manifests.flatMap(manifest => {
    if (ids.has(manifest.id)) throw new Error("同一部署不能重复登记Core权限");
    ids.add(manifest.id);
    return manifest.permissions.map(permission => ({ code: corePermissionCode(manifest.id, permission),
      name: permission.name, module: `core:${manifest.id}` }));
  });
  if (!declarations.length) return { cores: manifests.map(({ id, version }) => ({ id, version })), permissions: 0 };
  const current = await transaction.permission.findMany({ where: { code: { in: declarations.map(item => item.code) } } });
  const byCode = new Map(current.map(item => [item.code, item]));
  for (const item of declarations) {
    const previous = byCode.get(item.code);
    if (previous && (previous.module !== item.module || previous.kind !== "ACTION"))
      throw new Error(`Core权限与原目录归属或类型冲突：${item.code}`);
  }
  // 只更新本版仍声明的名称，不删除旧权限或RolePermission，历史角色和其他Core由各自更新负责。
  for (const item of declarations) await transaction.permission.upsert({ where: { code: item.code },
    create: { id: randomUUID(), ...item, kind: "ACTION" }, update: { name: item.name, module: item.module } });
  return { cores: manifests.map(({ id, version }) => ({ id, version })), permissions: declarations.length };
}
