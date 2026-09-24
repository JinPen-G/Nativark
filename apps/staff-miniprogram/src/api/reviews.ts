import type { CustomerMembershipReview, ReviewCustomerMembershipRequest } from "@rental-os/shared";
import { request } from "../core/http";

/**
 * 会员注册审核 / 证件审核（S14）。租户级动作：需对应审核权限 + 租户级 dataScope=all（服务端强制），
 * 员工端只据 canTenant() 渲染入口，服务端仍独立校验。走员工门面 /api/staff/v1/membership/*。
 */
export function listMembershipReviews(query: { status?: string; type?: "registration" | "qualification" } = {}): Promise<CustomerMembershipReview[]> {
  return request<CustomerMembershipReview[]>("/membership/reviews", { scope: "tenant", query: { status: query.status, type: query.type } });
}

export function decideMembershipReview(reviewId: string, input: ReviewCustomerMembershipRequest): Promise<CustomerMembershipReview> {
  return request<CustomerMembershipReview>(`/membership/reviews/${encodeURIComponent(reviewId)}/decision`, { method: "POST", data: input, scope: "tenant" });
}
