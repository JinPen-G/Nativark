/** 装配同一Rental治理/准备/采用服务与原HTTP。宿主仍须提供全局身份/权限Guard。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { CategoryGovernanceController } from "./http-category-governance.controller";
import { CategoryAdoptionPreparationController } from "./http-category-adoption-preparation.controller";
import { CategoryGovernancePreviewGuard } from "./http-category-preview.guard";
import {
  RENTAL_HTTP_CATEGORY_GOVERNANCE, RENTAL_HTTP_CATEGORY_PREPARATIONS, RENTAL_HTTP_CATEGORY_ADOPTIONS,
  type RentalCategoryHttpApplications,
} from "./http-category-applications";

export interface RentalCategoryHttpRegistration
  extends Pick<FactoryProvider<RentalCategoryHttpApplications>, "inject" | "useFactory"> {
  imports?: ModuleMetadata["imports"];
}

const APPLICATIONS = Symbol("rental.http.category-applications");
const applications = [
  [RENTAL_HTTP_CATEGORY_GOVERNANCE, "governance"],
  [RENTAL_HTTP_CATEGORY_PREPARATIONS, "preparations"],
  [RENTAL_HTTP_CATEGORY_ADOPTIONS, "adoptions"],
] as const;

export const RENTAL_CATEGORY_HTTP_CONTROLLERS = [
  CategoryGovernanceController, CategoryAdoptionPreparationController,
];

@Module({})
export class RentalCategoryHttpModule {
  static register(services: RentalCategoryHttpApplications): DynamicModule {
    return this.registerFactory({ useFactory: () => services });
  }

  static registerFactory(options: RentalCategoryHttpRegistration): DynamicModule {
    return {
      module: RentalCategoryHttpModule,
      imports: options.imports,
      controllers: RENTAL_CATEGORY_HTTP_CONTROLLERS,
      providers: [
        { provide: APPLICATIONS, inject: options.inject, useFactory: options.useFactory },
        ...applications.map(([provide, key]) => ({
          provide, inject: [APPLICATIONS],
          useFactory: (services: RentalCategoryHttpApplications) => services[key],
        })),
        CategoryGovernancePreviewGuard,
      ],
      exports: applications.map(([token]) => token),
    };
  }
}

export * from "./http-category-applications";
export { CategoryGovernanceController, CategoryAdoptionPreparationController, CategoryGovernancePreviewGuard };
