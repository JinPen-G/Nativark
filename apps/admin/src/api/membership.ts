import type {
  AssignCustomerMembershipPlanRequest,
  CorporateMembershipMember,
  CustomerCorporateMembership,
  CustomerMembershipPlan,
  CustomerMembershipQualificationType,
  CustomerMembershipRegistrationSettings,
  CustomerMembershipReview,
  PersonalMembershipMember,
  RegisterPersonalMembershipRequest,
  ReviewCustomerMembershipRequest,
  SaveCorporateMembershipRequest,
  SaveCustomerCorporateMembershipRequest,
  SaveCustomerMembershipPlanRequest,
  SaveCustomerMembershipQualificationTypeRequest,
  SavePersonalMembershipRequest,
  SetCustomerMembershipTemporaryPasswordRequest,
  SubmitCustomerQualificationRequest,
  UpdateCustomerMembershipRegistrationSettingsRequest
} from "@store-rental/shared";
import { request } from "./http";

/** 新会员体系唯一的管理端 API。所有请求的经营空间均由会话确定。 */
export const membershipApi = {
  registrationSettings: () => request<CustomerMembershipRegistrationSettings>("/membership/registration-settings"),
  saveRegistrationSettings: (data: UpdateCustomerMembershipRegistrationSettingsRequest) =>
    request<CustomerMembershipRegistrationSettings>("/membership/registration-settings", { method: "put", data }),
  personal: () => request<PersonalMembershipMember[]>("/membership/personal"),
  registerPersonal: (data: RegisterPersonalMembershipRequest) => request<{ customerId: string }>("/membership/personal", { method: "post", data }),
  savePersonal: (customerId: string, data: SavePersonalMembershipRequest) =>
    request<unknown>(`/membership/personal/${customerId}`, { method: "put", data }),
  setTemporaryPassword: (customerId: string, data: SetCustomerMembershipTemporaryPasswordRequest) =>
    request<unknown>(`/membership/personal/${customerId}/temporary-password`, { method: "put", data }),
  submitQualification: (customerId: string, data: SubmitCustomerQualificationRequest) =>
    request<unknown>(`/membership/personal/${customerId}/qualifications`, { method: "post", data }),
  reviews: (params?: { status?: string; type?: string }) => request<CustomerMembershipReview[]>("/membership/reviews", { params }),
  review: (reviewId: string, data: ReviewCustomerMembershipRequest) =>
    request<CustomerMembershipReview>(`/membership/reviews/${reviewId}/decision`, { method: "post", data }),
  qualificationTypes: () => request<CustomerMembershipQualificationType[]>("/membership/qualification-types"),
  saveQualificationType: (data: SaveCustomerMembershipQualificationTypeRequest) =>
    request<CustomerMembershipQualificationType>("/membership/qualification-types", { method: "put", data }),
  corporate: () => request<CorporateMembershipMember[]>("/membership/corporate"),
  saveCorporate: (data: SaveCorporateMembershipRequest) => request<CorporateMembershipMember>("/membership/corporate", { method: "put", data }),
  corporateEmployees: (corporateCustomerId: string) => request<CustomerCorporateMembership[]>(`/membership/corporate/${corporateCustomerId}/employees`),
  saveCorporateEmployee: (corporateCustomerId: string, data: SaveCustomerCorporateMembershipRequest) =>
    request<CustomerCorporateMembership>(`/membership/corporate/${corporateCustomerId}/employees`, { method: "put", data }),
  plans: () => request<CustomerMembershipPlan[]>("/membership/plans"),
  savePlan: (data: SaveCustomerMembershipPlanRequest) => request<CustomerMembershipPlan>("/membership/plans", { method: "put", data }),
  publishPlan: (planId: string, versionId: string) =>
    request<CustomerMembershipPlan>(`/membership/plans/${planId}/versions/${versionId}/publish`, { method: "post" }),
  assignPlan: (data: AssignCustomerMembershipPlanRequest) =>
    request<unknown>("/membership/plans/assignments", { method: "post", data })
};
