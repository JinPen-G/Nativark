import type { RentalFulfillmentMode } from "@rental-os/shared";

export const fulfillmentModeLabels: Record<RentalFulfillmentMode, string> & Record<string, string> = {
  store_pickup_return: "门店取还",
  partner_pickup_return: "合作点取还",
  warehouse_pickup_return: "仓库取还",
  locker_pickup_return: "智能柜取还",
  delivery: "配送取还",
  onsite_delivery: "现场交付",
  carrier_shipping: "承运寄送"
};
