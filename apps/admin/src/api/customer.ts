/** 原客户主档、预览和企业账务入口复用 Rental 同源客户端及原鉴权传输。 */
import { createRentalCustomerApi } from "@rental-os/rental-core/admin/membership/customer-client";
import { request } from "./http";
export const customerApi = createRentalCustomerApi(request);
