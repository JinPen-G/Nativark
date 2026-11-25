/** 原服务端委托入口再导出同一封存来源与WeakMap；字段或JSON复制不能取得来源。 */
import type { Prisma } from "@prisma/client";
import { RentalMerchantDelegatedOrderPort as CoreMerchantOrderPort } from "@rental-os/rental-core/merchant-delegation";
export { assertMerchantDelegatedOrderAuthority, bindCoreMerchantDelegationProof, assertCoreMerchantDelegationProof } from "@rental-os/rental-core/merchant-delegation";
export type { MerchantDelegatedOrderAuthority } from "@rental-os/rental-core/merchant-delegation";

// 仅在原宿主实例化事务类型，构造器和封存存储仍是Rental包中的同一个运行时对象。
export const RentalMerchantDelegatedOrderPort: typeof CoreMerchantOrderPort<Prisma.TransactionClient> = CoreMerchantOrderPort<Prisma.TransactionClient>;
export type RentalMerchantDelegatedOrderPort = CoreMerchantOrderPort<Prisma.TransactionClient>;
