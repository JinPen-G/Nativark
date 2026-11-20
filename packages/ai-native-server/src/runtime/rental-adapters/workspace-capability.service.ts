/** AI 仅以原事务类型引用 Rental 正式实现；实例及生命周期由宿主供给。 */
import type { Prisma } from "@prisma/client";
import { WorkspaceCapabilityService as Implementation } from "@rental-os/rental-core/workspace-capabilities";
export const WorkspaceCapabilityService: typeof Implementation<Prisma.TransactionClient> = Implementation<Prisma.TransactionClient>;
export type WorkspaceCapabilityService = Implementation<Prisma.TransactionClient>;
