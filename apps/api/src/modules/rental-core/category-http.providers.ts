/** 原宿主映射同一治理、准备与采用实例，不新增数据库或业务执行者。 */
import type { Provider, Type } from "@nestjs/common";
import {
  RENTAL_HTTP_CATEGORY_GOVERNANCE, RENTAL_HTTP_CATEGORY_PREPARATIONS, RENTAL_HTTP_CATEGORY_ADOPTIONS,
  type RentalCategoryHttpApplications,
} from "@rental-os/rental-core/http-category-applications";
import { CategoryGovernanceService } from "./category-governance.service";
import { CategoryAdoptionPreparationService } from "./category-adoption-preparation.service";
import { CategoryAdoptionApplication } from "./category-adoption.application";

function existing<T>(provide: symbol, source: Type<T>): Provider {
  return { provide, useExisting: source };
}

export const RENTAL_CATEGORY_HTTP_PROVIDERS: Provider[] = [
  existing<RentalCategoryHttpApplications["governance"]>(RENTAL_HTTP_CATEGORY_GOVERNANCE, CategoryGovernanceService),
  existing<RentalCategoryHttpApplications["preparations"]>(RENTAL_HTTP_CATEGORY_PREPARATIONS, CategoryAdoptionPreparationService),
  existing<RentalCategoryHttpApplications["adoptions"]>(RENTAL_HTTP_CATEGORY_ADOPTIONS, CategoryAdoptionApplication),
];
