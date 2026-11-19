/** 客户小程序业务客户端入口，宿主供给与调用链见同目录 README.md。 */
export { createRentalMiniProgramAddressesApi } from "./addresses";
export { createRentalMiniProgramCatalogApi } from "./catalog";
export { createRentalMiniProgramEnterpriseApi } from "./enterprise";
export { createRentalMiniProgramMerchantApi, type PublicServicesResponse } from "./merchant";
export { createRentalMiniProgramOrdersApi, type CreateOrderResult, type ExtensionResult } from "./orders";
export { createRentalMiniProgramPaymentsApi } from "./payments";
export { createRentalMiniProgramProfileApi } from "./profile";
export type {
  RentalMiniProgramRequestOptions,
  RentalMiniProgramRequest,
  RentalMiniProgramClientPorts,
  RentalMiniProgramPublicConfig,
  RentalMiniProgramCatalogPorts,
  RentalMiniProgramMerchantPorts,
} from "./ports";
