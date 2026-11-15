/** 认证私有存储边界，只声明平台身份表；Core不通过此端口读取业务库。 */
import type { Prisma, PrismaClient } from "@prisma/client";

export type PlatformAuthDataStore = Pick<
  PrismaClient,
  | "tenant"
  | "user"
  | "authSession"
  | "authLoginFailure"
  | "systemParameterSet"
  | "operationLog"
  | "$transaction"
>;
export type PlatformAuthTransaction = Pick<Prisma.TransactionClient, "user" | "authSession" | "$queryRaw">;

export const PLATFORM_AUTH_DATA_STORE = Symbol("platform.auth.data-store");
