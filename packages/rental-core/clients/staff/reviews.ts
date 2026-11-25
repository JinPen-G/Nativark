/**
 * 员工会员注册与证件审核客户端。宿主 request 供给员工运输、租户范围及原错误处理。
 * 审核权限、数据范围与决策结果由原服务端会员应用裁定。
 * 接入与消费者见 [审核导读](reviews/README.md)。
 */
import type { CustomerMembershipReview, ReviewCustomerMembershipRequest } from "../../src/contracts";
import type { RentalStaffClientPorts } from "./ports";

export function createRentalStaffReviewsApi({ request }: RentalStaffClientPorts) {
  function listMembershipReviews(query: { status?: string; type?: "registration" | "qualification" } = {}): Promise<CustomerMembershipReview[]> {
    return request<CustomerMembershipReview[]>("/membership/reviews", { scope: "tenant", query: { status: query.status, type: query.type } });
  }

  function decideMembershipReview(reviewId: string, input: ReviewCustomerMembershipRequest): Promise<CustomerMembershipReview> {
    return request<CustomerMembershipReview>(`/membership/reviews/${encodeURIComponent(reviewId)}/decision`, { method: "POST", data: input, scope: "tenant" });
  }

  return {
    listMembershipReviews,
    decideMembershipReview,
  };
}
