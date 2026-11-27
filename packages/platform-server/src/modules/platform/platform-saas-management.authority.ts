/** 可信平台管理复用原持久账号权威，在调用方同一 Native 事务内重读。
 * binding 须先经原会话认证；本函数不认证会话、不授予业务权限、不创建事务。 */
import { ForbiddenException } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/platform-contracts";

export interface PlatformSaasManagementSource<TTransaction> {
  useMysqlDataSource(): boolean;
  repository: {
    findUserById(id: string, transaction: TTransaction): Promise<SystemUserRow | undefined>;
  };
}

// 保留原 PlatformService.assertSaasAdmin 的裁定和错误语义。
function assertSaasAdmin(user?: SystemUserRow): void {
  if (!user?.isSaasAdmin) throw new ForbiddenException("仅 SaaS 平台管理员可以管理租户");
}

export async function assertTrustedPlatformSaasManagement<TTransaction extends { user: unknown }>(
  source: PlatformSaasManagementSource<TTransaction>,
  binding: { userId: string; tenantId: string },
  transaction: TTransaction
): Promise<Readonly<{ userId: string; tenantId: string }>> {
  if (!source.useMysqlDataSource() || !transaction?.user || !binding || typeof binding !== "object"
    || Array.isArray(binding) || ![Object.prototype, null].includes(Object.getPrototypeOf(binding))) {
    throw new ForbiddenException("可信平台管理需要原持久身份系统");
  }
  const fields = Object.getOwnPropertyDescriptors(binding), userId = fields.userId, tenantId = fields.tenantId;
  const valid = (field: PropertyDescriptor | undefined): field is PropertyDescriptor & { value: string } => Boolean(field?.enumerable && Object.hasOwn(field, "value")
    && typeof field.value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(field.value));
  if (Reflect.ownKeys(fields).length !== 2 || !valid(userId) || !valid(tenantId)) throw new ForbiddenException("缺少当前平台管理主体");
  const user = await source.repository.findUserById(userId.value, transaction);
  if (!user || user.id !== userId.value || user.tenantId !== tenantId.value || user.isActive !== true
    || user.isSaasAdmin !== true || user.mustChangePassword !== false) throw new ForbiddenException("缺少当前平台管理身份");
  assertSaasAdmin(user);
  return Object.freeze({ userId: user.id, tenantId: user.tenantId });
}
