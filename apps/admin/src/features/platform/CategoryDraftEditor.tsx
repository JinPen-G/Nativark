/** 原后台兼容入口；品类正文与字段规则由 Rental 单源提供。 */
export * from "@rental-os/rental-core/admin/governance/source/CategoryDraftEditor";
import { CategoryDraftEditor as OriginalCategoryDraftEditor } from "@rental-os/rental-core/admin/governance/source/CategoryDraftEditor";
import { bindLegacyRentalAssistant } from "../ai-operator/legacy-host";
export const CategoryDraftEditor = bindLegacyRentalAssistant(OriginalCategoryDraftEditor);
