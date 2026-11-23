/** 原后台兼容入口；品类正文与字段规则由 Rental 单源提供。 */
export * from "@rental-os/rental-core/admin/governance/source/CategoryPolicyDialog";
import { CategoryPolicyDialog as OriginalCategoryPolicyDialog } from "@rental-os/rental-core/admin/governance/source/CategoryPolicyDialog";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const CategoryPolicyDialog = bindLegacyRentalAssistant(OriginalCategoryPolicyDialog);
