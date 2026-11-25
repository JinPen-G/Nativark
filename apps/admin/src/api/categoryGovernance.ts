/** 原后台兼容入口；品类正文与字段规则由 Rental 单源提供。 */
export * from "@rental-os/rental-core/admin/governance/source/categoryGovernance";
import { createCategoryGovernanceApi } from "@rental-os/rental-core/admin/governance/source/categoryGovernance";
import { rentalBrowserSession } from "./http";
export const categoryGovernanceApi = createCategoryGovernanceApi(rentalBrowserSession.request);
