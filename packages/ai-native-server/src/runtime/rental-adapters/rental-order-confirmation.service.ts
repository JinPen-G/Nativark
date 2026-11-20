/** AI 仅以原事务类型引用 Rental 正式实现；实例及生命周期由宿主供给。 */
import type { Prisma } from "@prisma/client";
import { RentalOrderConfirmationService as Implementation } from "@rental-os/rental-core/mysql-order-confirmation";
export const RentalOrderConfirmationService: typeof Implementation<Prisma.TransactionClient> = Implementation<Prisma.TransactionClient>;
export type RentalOrderConfirmationService = Implementation<Prisma.TransactionClient>;
