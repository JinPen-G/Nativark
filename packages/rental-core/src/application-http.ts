/** 将唯一 Rental 应用实例交给原 Controller。此处只选择实例，不创建权限、数据库或后台任务。
 * 全局 Guard 与客户读取后的复验必须由同一宿主供给；缺 AI 检查参加者仍沿原不可用语义。 */
import type { RentalApplication } from "./application";
import type { RentalHttpServiceGroups } from "./http.module";
import type { RentalAuthorizationGuard } from "./http-auth";
import type { RentalStaffInspectionEvidence } from "./http-staff-uploads.controller";

export function createRentalHttpApplications(application: RentalApplication, input: {
  guard: Pick<RentalAuthorizationGuard, "revalidateClientRead">;
  inspectionEvidence?: RentalStaffInspectionEvidence;
}): RentalHttpServiceGroups {
  const { database, primary, foundation, customers, integrations, client, enterprise } = application;
  return {
    rental: {
      ...primary, database, allocation: application.workers.allocation, orderConfirmation: application.orderConfirmation,
      idempotent: foundation.idempotent, reports: integrations.reports, serviceCapacities: foundation.serviceCapacities,
      funding: foundation.funding, documents: integrations.documents, operationLogs: application.operationLog,
      corporateSettlement: customers.corporateSettlement, memberships: customers.memberships, failureEvents: application.failureEvents,
      exchangePreview: application.exchangePreview, exchangeInspections: enterprise.exchangeInspectionPreparation,
      exchangeInspectionMedia: application.exchangeInspectionMedia, officialCalendarSources: application.officialCalendarSources,
      workspaceCapabilities: foundation.capabilities, staffPayments: integrations.staffPayments
    },
    enterprise: { ...enterprise, database, funding: foundation.funding, credit: customers.corporateSettlement,
      files: integrations.files, integrations: integrations.integrations },
    client: { ...client, readGuard: input.guard },
    category: application.category,
    channels: { client: client.channelProfile, website: client.websiteChannelProfile,
      assets: client.websiteAssets, miniProgram: client.miniProgramChannel },
    members: { membership: customers.memberships, enterprisePortal: customers.enterprisePortal },
    files: { ledger: integrations.ledger, storage: integrations.files, database, customerAuthority: customers.customerOperations },
    staff: { auth: application.auth, database, storage: integrations.files,
      observe: integrations.parseStaffUploadObservation, inspectionEvidence: input.inspectionEvidence },
    customerAvatar: customers.customerAvatar
  };
}
