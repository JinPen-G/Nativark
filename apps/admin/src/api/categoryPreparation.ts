/** 原 AI 与治理入口使用 Rental 同源品类准备客户端及原鉴权传输。 */
import { createRentalCategoryPreparationApi } from "@rental-os/rental-core/admin/governance/client";
import { request } from "./http";
export type {
  CategoryPreparationOperation,
  CategoryPreparationEntity,
  CategoryPreparationPreview,
} from "@rental-os/rental-core/category-governance";
export const categoryPreparationApi = createRentalCategoryPreparationApi(request);
