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
export { createRentalMiniProgramSceneCatalogApi, type RentalMiniProgramSceneCatalogPorts } from "./ai-scene-catalog";
export { createRentalMiniProgramExtensionOperation, type RentalMiniProgramExtensionOperationPorts } from "./enterprise-extension-operation";
export { createRentalMiniProgramExchangeRequest, type RentalMiniProgramExchangeRequestPorts } from "./enterprise-exchange-request";
export { createRentalMiniProgramExchangeConfirmation, type RentalMiniProgramExchangeConfirmationPorts } from "./enterprise-exchange-confirmation";
export {
  ORDER_FILTERS, presentOrder, matchesFilter,
  type StatusGroup, type OrderFilterKey, type Tone, type FundingFacts,
  type OrderFacts, type OrderAction, type OrderPresentation,
} from "./status";
export { fulfillmentLabel, inventoryLabel, pricingUnitLabel, membershipLabel, reviewLabel, qualificationLabel, chargeLabel, extensionLabel, paymentMethodLabel, categoryIcon, categoryImage } from "./labels";
export { createRentalMiniProgramPaymentFlow, VERIFY_SCHEDULE_MS, type RentalMiniProgramPaymentFlowPorts, type PaymentOutcome, type PaymentVerification } from "./payment";
export {
  createRentalMiniProgramCart, isDeliveryMode, CartServiceMismatch, CartLocked,
  type RentalMiniProgramCartPorts, type CartLine, type CartServiceSelection,
  type CartSubmission, type CartState,
} from "./cart";
export { createRentalMiniProgramServiceFlow, type RentalMiniProgramServiceFlowPorts } from "./flow";
export { createRentalMiniProgramCatalogStore, type RentalMiniProgramCatalogStorePorts, type ItemCard } from "./catalog-store";
export { createRentalMiniProgramMerchantStore, type RentalMiniProgramMerchantStorePorts, type MerchantService, type MerchantInfo } from "./merchant-store";
export { createRentalMiniProgramFavorites, type RentalMiniProgramFavoritesPorts, type FavoriteItem } from "./favorites";
export { createRentalMiniProgramServiceZones, type RentalMiniProgramServiceZonePorts } from "./zones";
