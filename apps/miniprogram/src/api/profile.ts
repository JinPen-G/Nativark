import type {
  ClientMembershipAssignmentsResponse,
  ClientMembershipBenefitsResponse,
  ClientMembershipPlansResponse,
  ClientProfileUpdateRequest,
  ClientProfileView,
  ClientQualificationFileUrlResponse,
  ClientQualificationUploadSessionResponse,
  CustomerMembershipQualificationType,
  CustomerQualificationRevision,
  SubmitCustomerQualificationRequest
} from "@rental-os/shared";
import { request } from "../core/http";

export async function fetchProfile(): Promise<ClientProfileView> {
  return request<ClientProfileView>("/profile", { scope: "tenant" });
}

/** 服务端 PATCH /profile 的 PUT 别名（wx.request 不支持 PATCH）；语义仍是部分字段更新。 */
export async function updateProfile(input: ClientProfileUpdateRequest): Promise<ClientProfileView> {
  return request<ClientProfileView>("/profile", { method: "PUT", data: input, scope: "tenant" });
}

export async function fetchMembershipPlans(): Promise<ClientMembershipPlansResponse> {
  return request<ClientMembershipPlansResponse>("/membership/plans", { scope: "tenant" });
}

export async function fetchMembershipAssignments(): Promise<ClientMembershipAssignmentsResponse> {
  return request<ClientMembershipAssignmentsResponse>("/membership/assignments", { scope: "tenant" });
}

/** 当前服务下的权益解析：同一张卡在不同服务的适用结果。 */
export async function fetchMembershipBenefits(): Promise<ClientMembershipBenefitsResponse> {
  return request<ClientMembershipBenefitsResponse>("/membership/benefits");
}

export async function fetchQualificationTypes(): Promise<CustomerMembershipQualificationType[]> {
  return request<CustomerMembershipQualificationType[]>("/membership/qualification-types");
}

export async function fetchQualifications(): Promise<CustomerQualificationRevision[]> {
  return request<CustomerQualificationRevision[]>("/membership/qualifications", { scope: "tenant" });
}

export async function submitQualification(input: SubmitCustomerQualificationRequest): Promise<unknown> {
  return request("/membership/qualifications", { method: "POST", data: input });
}

export async function createQualificationUpload(input: { qualificationType: string; fileName: string; mimeType: string; sizeBytes: number; idempotencyKey: string }): Promise<ClientQualificationUploadSessionResponse> {
  return request<ClientQualificationUploadSessionResponse>("/membership/qualifications/files", { method: "POST", data: input });
}

export async function completeQualificationUpload(sessionId: string, checksum?: string): Promise<{ id?: string; fileAssetId?: string; status?: string }> {
  return request(`/membership/qualifications/files/${encodeURIComponent(sessionId)}/complete`, { method: "POST", data: checksum ? { checksum } : {} });
}

export async function qualificationFileUrl(fileAssetId: string): Promise<ClientQualificationFileUrlResponse> {
  return request<ClientQualificationFileUrlResponse>(`/membership/qualifications/files/${encodeURIComponent(fileAssetId)}/download-url`);
}
