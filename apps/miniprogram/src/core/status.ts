/** 原订单页面入口，展示分组和事实映射由 Rental 客户客户端提供。 */
export {
  ORDER_FILTERS, presentOrder, matchesFilter,
  type StatusGroup, type OrderFilterKey, type Tone, type FundingFacts,
  type OrderFacts, type OrderAction, type OrderPresentation,
} from "@rental-os/rental-core/clients/miniprogram";
