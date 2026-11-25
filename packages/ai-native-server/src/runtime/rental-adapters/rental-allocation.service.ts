/** AI 仅以原事务类型引用 Rental 正式实现；实例及生命周期由宿主供给。 */
import type { Prisma } from "@prisma/client";
import { RentalAllocationService as Implementation } from "@rental-os/rental-core/mysql-allocation";
export const RentalAllocationService: typeof Implementation<Prisma.TransactionClient> = Implementation<Prisma.TransactionClient>;
export type RentalAllocationService = Implementation<Prisma.TransactionClient>;
