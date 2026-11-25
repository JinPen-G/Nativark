/** 原会员页面和身份选择器复用 Rental 同源客户端及原鉴权传输。 */
import { createRentalMembershipApi } from "@rental-os/rental-core/admin/membership/client";
import { request } from "./http";
export const membershipApi = createRentalMembershipApi(request);
