/** 原Nest文件宿主，向Rental兼容编排供给同一数据库、配置、Auth/ACL及知识和检查参加者。
 * 本宿主管理原清理定时器，stop 停新并等待已进入的清理 Promise，AI物理清理沿原政策和收据参加者。 */
import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { RentalFileStorageApplication, type FileBusinessOwner as RentalFileBusinessOwner,
  type ExchangeInspectionUploadPlan as RentalExchangeInspectionUploadPlan } from "@rental-os/rental-core/file-application-runtime";
import { INSPECTION_OBJECT_READER, readInspectionMedia, type InspectionObjectReader } from "../ai-native/inspection-assist/inspection-media.reader";
import { KNOWLEDGE_FILE_ACCESS, type KnowledgeFileAccess } from "../ai-native/knowledge/knowledge-file-access";
import type { KnowledgeUploadRevision } from "../ai-native/knowledge/knowledge.ports";
import { KnowledgeCommitUnknownError } from "../ai-native/knowledge/knowledge-errors";
import { knowledgeUploadRevisionSchema, knowledgeUploadKey } from "../ai-native/knowledge/human-knowledge-upload.service";
import { PrismaService } from "../database/prisma.service";
import { TenantIntegrationService } from "./tenant-integration.service";
import { FileBusinessAccessService } from "../files/file-business-access.service";
import { OperationLogService } from "../../common/operation-log.service";
import { parseStaffUploadObservation } from "./file-upload.dto";
import { RENTAL_FILE_AUTHORITY, type RentalFileWorkspaceAuthority } from "./rental-file-application.participant";
import { FileAiRetentionParticipant } from "./file-ai-retention.participant";

export interface FileBusinessOwner extends RentalFileBusinessOwner<KnowledgeUploadRevision> {}
export type ExchangeInspectionUploadPlan = RentalExchangeInspectionUploadPlan<KnowledgeUploadRevision>;

@Injectable()
export class FileStorageRuntimeService extends RentalFileStorageApplication<KnowledgeUploadRevision>
  implements OnApplicationBootstrap, OnApplicationShutdown {
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private closing?: Promise<void>;
  private readonly cleanupWork = new Set<Promise<unknown>>();
  private readonly cleanupLogger = new Logger(FileStorageRuntimeService.name);
  private readonly aiRetention: FileAiRetentionParticipant;

  constructor(
    prisma: PrismaService,
    integrations: TenantIntegrationService,
    @Optional() operationLog?: OperationLogService,
    @Optional() @Inject(INSPECTION_OBJECT_READER) inspectionObjectReader?: InspectionObjectReader,
    @Optional() @Inject(KNOWLEDGE_FILE_ACCESS) knowledgeFiles?: KnowledgeFileAccess,
    @Optional() fileAccess?: FileBusinessAccessService,
    @Optional() @Inject(RENTAL_FILE_AUTHORITY) auth?: RentalFileWorkspaceAuthority
  ) {
    super(prisma, integrations, {
      operationLog, inspectionObjectReader, knowledgeFiles, fileAccess, auth,
      readInspectionMedia, parseStaffUploadObservation,
      parseKnowledgeUploadRevision: value => knowledgeUploadRevisionSchema.safeParse(value),
      knowledgeUploadKey,
      knowledgeCommitUnknown: () => new KnowledgeCommitUnknownError()
    });
    this.aiRetention = new FileAiRetentionParticipant(prisma, integrations, {
      presign: (...args) => this.presign(...args),
      deleteObject: (...args) => this.deleteObject(...args)
    });
  }


  onApplicationBootstrap() {
    // 多实例部署也可以各自运行：每个会话先用条件更新抢占，重复扫描不会重复删对象。
    // 测试进程不启动定时器；FILE_UPLOAD_CLEANUP_INTERVAL_MS 只允许调慢，避免误配成忙循环。
    if (this.stopping || this.cleanupTimer || process.env.NODE_ENV === "test" || process.env.FILE_UPLOAD_CLEANUP_DISABLED === "true") return;
    const configured = Number(process.env.FILE_UPLOAD_CLEANUP_INTERVAL_MS ?? 5 * 60 * 1000);
    const intervalMs = Number.isFinite(configured) ? Math.max(configured, 60 * 1000) : 5 * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      if (this.stopping) return;
      this.trackCleanup(this.cleanupExpiredUploadSessionsForAllTenants());
      this.trackCleanup(this.cleanupPendingFileAssetDeletesForAllTenants());
    }, intervalMs);
    this.cleanupTimer.unref?.();
  }


  private trackCleanup(work: Promise<unknown>): void {
    this.cleanupWork.add(work);
    void work.then(() => this.cleanupWork.delete(work), error => {
      this.cleanupWork.delete(work);
      this.cleanupLogger.error("文件清理失败", error instanceof Error ? error.stack : String(error));
    });
  }

  stop(): Promise<void> {
    this.stopping = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    return this.closing ??= (async () => {
      const results = await Promise.allSettled([...this.cleanupWork]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "文件清理排空失败");
    })();
  }

  onApplicationShutdown(): Promise<void> {
    return this.stop();
  }

  async eraseAiRetentionObject(tenantId: string, workspaceId: string, receiptId: string, recheck: () => Promise<void>) {
    return this.aiRetention.eraseAiRetentionObject(tenantId, workspaceId, receiptId, recheck);
  }
}
