/** Rental品类HTTP的应用接点。宿主提供当前服务实例，HTTP不授予权限或创建业务事务。 */
import type { CategoryGovernanceService } from "./mysql-category-governance";
import type { CategoryAdoptionPreparationService } from "./mysql-category-preparation";
import type { CategoryAdoptionApplication } from "./mysql-category-adoption";

type PublicMethods<T> = Pick<T, keyof T>;

export interface RentalCategoryHttpApplications {
  governance: PublicMethods<CategoryGovernanceService>;
  preparations: PublicMethods<CategoryAdoptionPreparationService>;
  adoptions: Pick<CategoryAdoptionApplication, "readOriginal" | "adopt">;
}

export const RENTAL_HTTP_CATEGORY_GOVERNANCE = Symbol("rental.http.category-governance");
export const RENTAL_HTTP_CATEGORY_PREPARATIONS = Symbol("rental.http.category-preparations");
export const RENTAL_HTTP_CATEGORY_ADOPTIONS = Symbol("rental.http.category-adoptions");
