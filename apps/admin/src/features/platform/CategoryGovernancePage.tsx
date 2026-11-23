/** 原后台兼容入口；品类正文与字段规则由 Rental 单源提供。 */
export * from "@rental-os/rental-core/admin/governance/source/CategoryGovernancePage";
import { CategoryGovernancePage as OriginalCategoryGovernancePage, CategoryCapabilityCatalogPage as OriginalCategoryCapabilityCatalogPage } from "@rental-os/rental-core/admin/governance/source/CategoryGovernancePage";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const CategoryGovernancePage = bindLegacyRentalAssistant(OriginalCategoryGovernancePage);
export const CategoryCapabilityCatalogPage = bindLegacyRentalAssistant(OriginalCategoryCapabilityCatalogPage);
