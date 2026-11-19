/** 品类治理、准备和采用共用原认证、能力、订阅和收据实例。
 * 这里只组合原应用，不读写数据库、不开放预览开关或改变采用事务/unknown 语义。 */
import { CategoryGovernanceService } from "./mysql-category-governance";
import { CategoryAdoptionPreparationService } from "./mysql-category-preparation";
import { CategoryAdoptionApplication } from "./mysql-category-adoption";
import type { RentalCategoryGovernanceStorage, RentalCategoryGovernanceHooks,
  RentalCategoryGovernanceSessionReader, RentalCategoryGovernancePrincipalReader } from "./category-governance-storage";
import type { RentalCategoryAdoptionStorage, RentalCategoryAdoptionReceiptStore, RentalCategoryAdoptionAuthority,
  RentalCategoryAdoptionCapabilities, RentalCategoryAdoptionHooks, RentalCategoryAdoptionCommercial } from "./category-adoption-ports";
import type { RentalCategoryHttpApplications } from "./http-category-applications";

export interface RentalCategoryApplicationDependencies {
  database: RentalCategoryGovernanceStorage & RentalCategoryAdoptionStorage;
  receipts: RentalCategoryAdoptionReceiptStore;
  auth: RentalCategoryGovernanceSessionReader & RentalCategoryAdoptionAuthority;
  principals: RentalCategoryGovernancePrincipalReader;
  capabilities: RentalCategoryAdoptionCapabilities;
  capabilityHooks: RentalCategoryGovernanceHooks & RentalCategoryAdoptionHooks;
  subscriptions: RentalCategoryAdoptionCommercial;
}

/** 宿主传入领域组合已创建的能力/Hook/收据，禁止另造一份政策、缓存或执行入口。 */
export function createRentalCategoryApplications(input: RentalCategoryApplicationDependencies) {
  for (const name of ["database", "receipts", "auth", "principals", "capabilities", "capabilityHooks", "subscriptions"] as const) {
    if (input[name] == null) throw new Error(`Rental 品类应用装配缺少原依赖: ${name}`);
  }
  const { database, receipts, auth, principals, capabilities, capabilityHooks, subscriptions } = input;
  const adoptions = new CategoryAdoptionApplication(database, receipts, auth, capabilities, capabilityHooks, subscriptions);
  const preparations = new CategoryAdoptionPreparationService(database, capabilities, capabilityHooks, subscriptions, auth, adoptions);
  const governance = new CategoryGovernanceService(database, capabilityHooks, auth, principals);
  return Object.freeze({ governance, preparations, adoptions }) satisfies RentalCategoryHttpApplications;
}

export type RentalCategoryApplications = ReturnType<typeof createRentalCategoryApplications>;
