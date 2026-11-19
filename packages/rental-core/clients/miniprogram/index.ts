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
export { createRentalMiniProgramAuthApi, type RentalMiniProgramAuthPorts } from "./auth";
export { createRentalMiniProgramTaskApi, type RentalMiniProgramTaskPorts, type ClientTaskApi, type ClientOrderNavigationPort } from "./ai-tasks";
export { createRentalMiniProgramTaskCancellationApi, type RentalMiniProgramTaskCancellationPorts, type ClientTaskCancellationApi } from "./ai-task-cancellation";
export { createRentalMiniProgramQuoteApi, type RentalMiniProgramQuotePorts } from "./ai-quotes";
export { createRentalMiniProgramPublicApi, type RentalMiniProgramPublicPorts } from "./ai-public";
export { createRentalMiniProgramGoalApi, type RentalMiniProgramGoalPorts } from "./ai-goals";
export { createRentalMiniProgramBookingTransferApi, type RentalMiniProgramBookingTransferPorts, type ClientBookingTransferApi } from "./ai-booking-transfers";
export { createRentalMiniProgramEntryActionApi, type RentalMiniProgramEntryActionPorts, type RentalMiniProgramEntryActionSession, type ClientOriginalPaymentRecord } from "./ai-entry-actions";
