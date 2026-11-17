/** 企业读取与原命令的私有MySQL视图，只描述本链实际使用的表/事务。
 * 当前客户签名由原Auth供给，企业动作来自包内数据库资格读取；此处不提供授权兜底。 */
import type { PrismaClient } from "@prisma/client";

export type RentalEnterpriseAccessStorage = Pick<PrismaClient,
  "$queryRaw" | "tenant" | "customerCorporateMembership">;
export type RentalEnterpriseReadStorage = RentalEnterpriseAccessStorage & Pick<PrismaClient,
  "$transaction" | "clientAuthSession" | "operationLog">;
export type RentalEnterpriseCommandStorage = Pick<PrismaClient, "$transaction">;
