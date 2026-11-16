/** 原组合的事务类型适配，批准/原收据合同由Rental包单源维护。 */
import type { Prisma } from "@prisma/client";
import type { ApprovedSettingsParticipant as CoreApprovedSettingsParticipant } from "@rental-os/rental-core/approved-settings-ports";
export * from "@rental-os/rental-core/approved-settings-ports";
export type ApprovedSettingsParticipant = CoreApprovedSettingsParticipant<Prisma.TransactionClient>;
