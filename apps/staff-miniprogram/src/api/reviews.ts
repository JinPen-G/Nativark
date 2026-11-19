/** 员工会员审核薄入口。原运输与 Rental 客户端共同供给租户级请求和原决策结果。 */
import { createRentalStaffReviewsApi } from "@rental-os/rental-core/clients/staff";
import { request } from "../core/http";

export const {
  listMembershipReviews,
  decideMembershipReview,
} = createRentalStaffReviewsApi({ request });
