/** AI 请求内的原文件构造适配。业务算法仍由 Rental 单源执行；无计时器、连接或宿主生命周期。 */
import { RentalFileStorageApplication, type FileBusinessOwner as OriginalOwner } from "@rental-os/rental-core/file-application-runtime";
import { parseStaffUploadObservation } from "@rental-os/rental-core/file-application-staff-observation";
import type { RentalFileWorkspaceAuthority } from "@rental-os/rental-core/file-application-participant";
import type { RentalFileBusinessAccessService as FileBusinessAccessService } from "@rental-os/rental-core/file-access";
import type { TenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import type { PrismaService } from "./prisma.service";
import type { OperationLogService } from "./operation-log.service";
import { readInspectionMedia, type InspectionObjectReader } from "../inspection-assist/inspection-media.reader";
import type { KnowledgeFileAccess } from "../knowledge/knowledge-file-access";
import type { KnowledgeUploadRevision } from "../knowledge/knowledge.ports";
import { KnowledgeCommitUnknownError } from "../knowledge/knowledge-errors";
import { knowledgeUploadRevisionSchema, knowledgeUploadKey } from "../knowledge/human-knowledge-upload.service";
import { FileAiRetentionParticipant } from "../integrations/file-ai-retention.participant";
export interface FileBusinessOwner extends OriginalOwner<KnowledgeUploadRevision> {}
export class FileStorageRuntimeService extends RentalFileStorageApplication<KnowledgeUploadRevision> {
  private readonly aiRetention: FileAiRetentionParticipant;
  constructor(prisma: PrismaService, integrations: TenantIntegrationService, operationLog?: OperationLogService,
    inspectionObjectReader?: InspectionObjectReader, knowledgeFiles?: KnowledgeFileAccess,
    fileAccess?: FileBusinessAccessService, auth?: RentalFileWorkspaceAuthority) {
    super(prisma, integrations, { operationLog, inspectionObjectReader, knowledgeFiles, fileAccess, auth,
      readInspectionMedia, parseStaffUploadObservation,
      parseKnowledgeUploadRevision: value => knowledgeUploadRevisionSchema.safeParse(value), knowledgeUploadKey,
      knowledgeCommitUnknown: () => new KnowledgeCommitUnknownError() });
    this.aiRetention = new FileAiRetentionParticipant(prisma, integrations, {
      presign: (...args) => this.presign(...args), deleteObject: (...args) => this.deleteObject(...args) });
  }
  eraseAiRetentionObject(tenantId: string, workspaceId: string, receiptId: string, recheck: () => Promise<void>) {
    return this.aiRetention.eraseAiRetentionObject(tenantId, workspaceId, receiptId, recheck);
  }
}
