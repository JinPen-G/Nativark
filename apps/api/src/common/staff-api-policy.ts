/** 原策略兼容入口：只注入 Shared 唯一常量，规则由 Rental 单源维护。 */
import * as contracts from "@rental-os/shared";
import { createRentalStaffPolicy } from "@rental-os/rental-core/staff-api-policy";
export const { isHumanAutomationRoute, isStaffAuthPath, isStaffBusinessRouteAllowed, staffRoutePermissions } = createRentalStaffPolicy(contracts);
