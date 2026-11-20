/** 原员工列表展示入口，标签与媒体函数绑定同一 Core 展示实例。 */
import { createRentalStaffPresenters } from "@rental-os/rental-core/clients/staff";
import { itemGroupImagePath } from "../api/context";
import { orderStatusLabel, orderStatusTone } from "./labels";

const presenters = createRentalStaffPresenters({
  labels: { orderStatusLabel, orderStatusTone }, media: { itemGroupImagePath },
});
export const { maskPhone, itemGroupCover, orderCardOf, indexItemGroups, initialOf, relativeDay } = presenters;
export type { OrderCard } from "@rental-os/rental-core/clients/staff";
