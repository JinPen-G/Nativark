/** 显式部署事务登记所选 Core 的权限元数据，固定兼容参加者可保留原业务码和按钮类型。
 * 保留原权限 ID、模块和角色关系，调用方持有同一 Serializable 事务及已核定清单。 */
import { randomUUID } from "node:crypto";
import { CoreManifestSchema, corePermissionCode, type CoreManifest } from "@rental-os/core-contracts";

export interface CorePermissionRegistrationDeclaration {
  permission: Pick<CoreManifest["permissions"][number], "resource" | "action">;
  code: string;
  name: string;
  module: string;
  kind: "ACTION" | "BUTTON";
  description?: string;
  /** 固定原业务资料确认的历史模块名，仅用于同码归属校验，更新仍保留现存模块。 */
  previousModules?: readonly string[];
}

/** 由受控宿主按所选包的固定代码提供，HTTP 输入不能选择或构造参加者。 */
export interface CorePermissionRegistrationParticipant {
  coreId: string;
  declarations(manifest: CoreManifest): readonly CorePermissionRegistrationDeclaration[];
}

export interface CorePermissionRegistrationTransaction {
  permission: {
    findMany(input: { where: { code: { in: string[] } } }): PromiseLike<Array<{ code: string; module: string; kind: string }>>;
    upsert(input: { where: { code: string };
      create: { id: string; code: string; name: string; module: string; kind: "ACTION" | "BUTTON"; description?: string };
      update: { name: string; module: string; description?: string } }): PromiseLike<unknown>;
  };
}

/** 调用方须在受控部署的Serializable事务中执行；先核全部清单及现存归属，再更新本Core声明。 */
export async function registerPlatformCorePermissions(transaction: CorePermissionRegistrationTransaction,
  input: readonly CoreManifest[], participants: readonly CorePermissionRegistrationParticipant[] = []) {
  const manifests = input.map(manifest => CoreManifestSchema.parse(manifest));
  const ids = new Set<string>();
  for (const manifest of manifests) {
    if (ids.has(manifest.id)) throw new Error("同一部署不能重复登记Core权限");
    ids.add(manifest.id);
  }
  const byCore = new Map<string, CorePermissionRegistrationParticipant>();
  for (const participant of participants) {
    if (!ids.has(participant.coreId) || byCore.has(participant.coreId))
      throw new Error("权限兼容参加者必须对应唯一的所选Core");
    byCore.set(participant.coreId, participant);
  }
  const codes = new Set<string>();
  const declarations = manifests.flatMap(manifest => {
    const declared = new Set(manifest.permissions.map(permission => corePermissionCode(manifest.id, permission)));
    const references = new Set<string>();
    const participant = byCore.get(manifest.id);
    const entries: readonly CorePermissionRegistrationDeclaration[] = participant ? participant.declarations(manifest)
      : manifest.permissions.map(permission => ({ permission, code: corePermissionCode(manifest.id, permission),
        name: permission.name, module: `core:${manifest.id}`, kind: "ACTION" }));
    for (const entry of entries) {
      const reference = corePermissionCode(manifest.id, entry.permission);
      if (!declared.has(reference) || references.has(reference) || codes.has(entry.code))
        throw new Error("权限登记必须唯一对应所选清单的原声明");
      if (!entry.code || entry.code === "*" || /\s/u.test(entry.code) || !entry.name.trim() || !entry.module.trim()
        || !["ACTION", "BUTTON"].includes(entry.kind)) throw new Error("权限登记元数据无效");
      references.add(reference);
      codes.add(entry.code);
    }
    return entries;
  });
  if (!declarations.length) return { cores: manifests.map(({ id, version }) => ({ id, version })), permissions: 0 };
  const current = await transaction.permission.findMany({ where: { code: { in: declarations.map(item => item.code) } } });
  const byCode = new Map(current.map(item => [item.code, item]));
  for (const item of declarations) {
    const previous = byCode.get(item.code);
    if (previous && (previous.kind !== item.kind
      || previous.module !== item.module && !item.previousModules?.includes(previous.module)))
      throw new Error(`Core权限与原目录归属或类型冲突：${item.code}`);
  }
  // 只更新本版仍声明的名称，不删除旧权限或RolePermission，历史角色和其他Core由各自更新负责。
  for (const item of declarations) {
    const description = item.description === undefined ? {} : { description: item.description };
    await transaction.permission.upsert({ where: { code: item.code },
      create: { id: randomUUID(), code: item.code, name: item.name, module: item.module, kind: item.kind, ...description },
      update: { name: item.name, module: byCode.get(item.code)?.module ?? item.module, ...description } });
  }
  return { cores: manifests.map(({ id, version }) => ({ id, version })), permissions: declarations.length };
}
