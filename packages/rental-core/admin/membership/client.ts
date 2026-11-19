/** 租户统一会员、方案和审核沿原 HTTP，证件类型配置使用当前经营空间。 */
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";
import type {
  AssignCustomerMembershipPlanRequest,
  BookingMemberOption,
  CorporateMembershipMember,
  CustomerCorporateMembership,
  CustomerMembershipPlan,
  CustomerMembershipScopeOptions,
  CustomerMembershipQualificationType,
  CustomerMembershipRegistrationSettings,
  CustomerMembershipReview,
  CustomerQualificationRevision,
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
  UpdateCustomerMembershipRegistrationSettingsRequest,
} from "@rental-os/rental-core";

export function createRentalMembershipApi(request: AdminRuntime["request"]) {
  return {
    registrationSettings: () =>
      request<CustomerMembershipRegistrationSettings>("/membership/registration-settings"),
    saveRegistrationSettings: (data: UpdateCustomerMembershipRegistrationSettingsRequest) =>
      request<CustomerMembershipRegistrationSettings>("/membership/registration-settings", {
        method: "put",
        data,
      }),
    personal: () => request<PersonalMembershipMember[]>("/membership/personal"),
    personalOptions: () => request<BookingMemberOption[]>("/membership/personal-options"),
    benefitScopeOptions: () =>
      request<CustomerMembershipScopeOptions>("/membership/benefit-scope-options"),
    registerPersonal: (data: RegisterPersonalMembershipRequest) =>
      request<{ customerId: string; skipped?: boolean }>("/membership/personal", {
        method: "post",
        data,
      }),
    savePersonal: (customerId: string, data: SavePersonalMembershipRequest) =>
      request<unknown>(`/membership/personal/${customerId}`, { method: "put", data }),
    setTemporaryPassword: (
      customerId: string,
      data: SetCustomerMembershipTemporaryPasswordRequest,
    ) =>
      request<unknown>(`/membership/personal/${customerId}/temporary-password`, {
        method: "put",
        data,
      }),
    submitQualification: (customerId: string, data: SubmitCustomerQualificationRequest) =>
      request<unknown>(`/membership/personal/${customerId}/qualifications`, {
        method: "post",
        data,
      }),
    qualificationHistory: (customerId: string, qualificationType?: string) =>
      request<CustomerQualificationRevision[]>(
        `/membership/personal/${customerId}/qualification-history`,
        { params: qualificationType ? { qualificationType } : undefined },
      ),
    reviews: (params?: { status?: string; type?: string }) =>
      request<CustomerMembershipReview[]>("/membership/reviews", { params }),
    review: (reviewId: string, data: ReviewCustomerMembershipRequest) =>
      request<CustomerMembershipReview>(`/membership/reviews/${reviewId}/decision`, {
        method: "post",
        data,
      }),
    qualificationOptions: () =>
      request<CustomerMembershipQualificationType[]>("/membership/qualification-options"),
    qualificationTypes: () =>
      request<CustomerMembershipQualificationType[]>("/membership/qualification-types"),
    saveQualificationType: (data: SaveCustomerMembershipQualificationTypeRequest) =>
      request<CustomerMembershipQualificationType>("/membership/qualification-types", {
        method: "put",
        data,
      }),
    corporate: () => request<CorporateMembershipMember[]>("/membership/corporate"),
    saveCorporate: (data: SaveCorporateMembershipRequest) =>
      request<CorporateMembershipMember>("/membership/corporate", { method: "put", data }),
    corporateEmployees: (corporateCustomerId: string) =>
      request<CustomerCorporateMembership[]>(
        `/membership/corporate/${corporateCustomerId}/employees`,
      ),
    saveCorporateEmployee: (
      corporateCustomerId: string,
      data: SaveCustomerCorporateMembershipRequest,
    ) =>
      request<CustomerCorporateMembership>(
        `/membership/corporate/${corporateCustomerId}/employees`,
        { method: "put", data },
      ),
    plans: () => request<CustomerMembershipPlan[]>("/membership/plans"),
    savePlan: (data: SaveCustomerMembershipPlanRequest) =>
      request<CustomerMembershipPlan>("/membership/plans", { method: "put", data }),
    publishPlan: (planId: string, versionId: string) =>
      request<CustomerMembershipPlan>(`/membership/plans/${planId}/versions/${versionId}/publish`, {
        method: "post",
      }),
    disablePlan: (planId: string, versionId: string, reason: string) =>
      request<CustomerMembershipPlan>(`/membership/plans/${planId}/versions/${versionId}/disable`, {
        method: "post",
        data: { reason },
      }),
    restorePlan: (planId: string, versionId: string, reason: string) =>
      request<CustomerMembershipPlan>(`/membership/plans/${planId}/versions/${versionId}/restore`, {
        method: "post",
        data: { reason },
      }),
    assignPlan: (data: AssignCustomerMembershipPlanRequest) =>
      request<unknown>("/membership/plans/assignments", { method: "post", data }),
    planAssignments: (customerId: string) =>
      request<import("@rental-os/rental-core").CustomerMembershipPlanAssignment[]>(
        `/membership/plans/assignments/${customerId}`,
      ),
    revokePlanAssignment: (assignmentId: string, reason: string) =>
      request<unknown>(`/membership/plans/assignments/${assignmentId}/revoke`, {
        method: "post",
        data: { reason },
      }),
  };
}
export type RentalMembershipApi = ReturnType<typeof createRentalMembershipApi>;
