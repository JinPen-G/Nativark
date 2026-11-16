/** Rental服务容量的私有MySQL视图；只提供本账和原品类锁/空间读取所需能力。 */
import type { Prisma } from "@prisma/client";
import type { RentalFactIdentity } from "./fact-request-context";

export interface RentalServiceCapacityTransaction {
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
  rentalServiceCapacity: Pick<Prisma.TransactionClient["rentalServiceCapacity"],
    "findMany" | "findFirst" | "findUnique" | "upsert" | "updateMany">;
  rentalServiceReservation: Pick<Prisma.TransactionClient["rentalServiceReservation"],
    "findFirst" | "findMany" | "create" | "updateMany">;
  rentalValueAddedService: Pick<Prisma.TransactionClient["rentalValueAddedService"], "findFirst">;
  rentalFulfillmentLocation: Pick<Prisma.TransactionClient["rentalFulfillmentLocation"], "findFirst">;
  // 品类定义仍由原Rental锁定算法裁定；空间只读取归属，不改公共身份或成员权限。
  rentalCategoryVersion: Pick<Prisma.TransactionClient["rentalCategoryVersion"], "findUnique">;
  businessWorkspace: Pick<Prisma.TransactionClient["businessWorkspace"], "findFirst">;
}

export interface RentalServiceCapacityStorage<TTransaction extends RentalServiceCapacityTransaction>
  extends RentalServiceCapacityTransaction {
  $transaction<T>(
    run: (transaction: TTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" | "RepeatableRead" }
  ): PromiseLike<T>;
}

export interface RentalServiceCapacityRequestContext {
  /** 供给原Auth/ALS完整对象；客户端输入和缓存不能替代服务端当前身份。 */
  getRequestIdentity(): (RentalFactIdentity & { staffApi?: boolean }) | undefined;
  /** 使用调用方传入的同一数据库/事务核当前空间；无会话兼容只沿原初始化路径。 */
  resolveWorkspaceId(client: RentalServiceCapacityTransaction, tenantId: string): PromiseLike<string>;
}
