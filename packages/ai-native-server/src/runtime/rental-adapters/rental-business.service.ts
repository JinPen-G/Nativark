/** AI 仅以原事务类型引用 Rental 正式实现；实例及生命周期由宿主供给。 */
import type { Prisma } from "@prisma/client";
import { RentalBusinessService as Implementation } from "@rental-os/rental-core/mysql-business-runtime";
export const RentalBusinessService: typeof Implementation<Prisma.TransactionClient> = Implementation<Prisma.TransactionClient>;
export type RentalBusinessService = Implementation<Prisma.TransactionClient>;
export type { RentalBusinessContext as BusinessContext } from "@rental-os/rental-core/configuration-basis";
export { RentalNotificationDraftUnknownError } from "@rental-os/rental-core/notification-draft";
export type { RentalNotificationDraftInput, RentalNotificationDraftOriginal, RentalNotificationDraftObservation } from "@rental-os/rental-core/notification-draft";
