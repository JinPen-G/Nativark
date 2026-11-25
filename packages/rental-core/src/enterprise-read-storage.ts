/** 企业读取与原命令的私有MySQL视图，只描述本链实际使用的表/事务。
 * 当前客户签名由原Auth供给，企业动作来自包内数据库资格读取；此处不提供授权兜底。 */
import type { PrismaClient } from "@prisma/client";
import type { Sql } from "@prisma/client/runtime/library";

/** 原调用方已持有 Tenant 父锁的查询视图；不创建事务、不用根连接替代当前事务。 */
export interface RentalEnterpriseAuthorityTransaction {
  $queryRaw<T>(query: Sql): PromiseLike<T>;
}

export type RentalEnterpriseAccessStorage = Pick<PrismaClient,
  "$queryRaw" | "tenant" | "customerCorporateMembership">;
export type RentalEnterpriseReadStorage = RentalEnterpriseAccessStorage & Pick<PrismaClient,
  "$transaction" | "clientAuthSession" | "operationLog">;
export type RentalEnterpriseCommandStorage = Pick<PrismaClient, "$transaction">;

/** 仍传入原宿主实例，保证政策的事务/非事务读取身份比较及锁语义不变。 */
export type RentalEnterprisePolicyStorage = Pick<PrismaClient,
  "$queryRaw" | "$executeRaw" | "$transaction" | "businessWorkspace" | "customerProfile" |
  "customerCorporateMembership" | "rentalCategoryDefinition">;
export type RentalEnterpriseMembersStorage = Pick<PrismaClient,
  "$queryRaw" | "$executeRaw" | "$transaction" | "customerProfile" | "customerCorporateMembership">;

export type RentalEnterpriseApplicationStorage = Pick<PrismaClient, "$queryRaw" | "$transaction">;
export type RentalEnterpriseManagementStorage = RentalEnterpriseReadStorage & Pick<PrismaClient,
  "rentalCategoryDefinition">;
export type RentalEnterpriseTaskCenterStorage = Pick<PrismaClient, "$queryRaw">;
export type RentalEnterpriseHandoffStorage = Pick<PrismaClient, "$queryRaw" | "$transaction">;
