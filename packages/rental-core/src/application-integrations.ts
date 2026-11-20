/** Rental 集成的分阶段组合：先文件/支付/通知，再 Core 单据/员工收款，最后企业换货影像。
 * 各阶段复用同一数据库、公共服务与原文件权威；构造不启动清理、连接外部服务或补造业务结果。 */
import { rentalPrismaNulls } from "./prisma-null-values";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import { TenantIntegrationRuntimeService } from "@rental-os/platform-server/integration-sms";
import { TenantEmailRuntimeService } from "@rental-os/platform-server/integration-email";
import { TenantIntegrationConnectivityService } from "@rental-os/platform-server/integration-connectivity";
import { WechatMiniProgramAdapter } from "@rental-os/platform-server/integration-wechat";
import { integrationTestWhere, type TenantIntegrationDataStore, type IntegrationRuntimeProviders } from "@rental-os/platform-server/integration-store";
import { getRequestIdentity, getRequestWorkspaceId, getRequestDataScope, getRequestLocationIds,
  getRequestUserId } from "@rental-os/platform-server/request-identity";
import { RentalIntegrationBusinessParticipant } from "./integration-business-participant";
import { RentalIntegrationApplication, type RentalIntegrationConfiguration } from "./integration-runtime";
import { MysqlRentalIntegrationRepository } from "./mysql-integrations";
import { RentalFileBusinessAccessService } from "./file-access";
import { RentalFileStorageApplication, type RentalFileStorageParticipants, type FileKnowledgeRevision,
  type ExchangeInspectionUploadPlan } from "./file-application-runtime";
import { parseStaffUploadObservation } from "./file-application-staff-observation";
import { TenantInspectionObjectReader } from "./inspection-object-reader";
import { PaymentRuntimeService } from "./mysql-payment-runtime";
import { PaymentReconciliationFileService } from "./mysql-payment-reconciliation-file";
import { RentalDocumentService } from "./mysql-documents";
import { RentalWorkspaceReportRepository } from "./mysql-reports";
import { StaffOfflinePaymentService } from "./mysql-staff-payments";
import { RentalExchangeInspectionMediaService } from "./mysql-exchange-inspection-media";
import { requestRentalOrderVisibilityWhere } from "./mysql-core-facts";

type FileAccessDependencies = ConstructorParameters<typeof RentalFileBusinessAccessService>;
type PaymentDependencies = ConstructorParameters<typeof PaymentRuntimeService>;
type StaffPaymentDependencies = ConstructorParameters<typeof StaffOfflinePaymentService<Prisma.TransactionClient>>;
type DocumentDependencies = ConstructorParameters<typeof RentalDocumentService>;

/** 此存储交集仅属于 MySQL 装配，不进入公共 Core 合同。 */
export type RentalIntegrationApplicationDatabase = Pick<PrismaClient,
  "tenantIntegrationConfig" | "externalAdapterLog" | "$queryRaw" | "$transaction">
  & ConstructorParameters<typeof RentalIntegrationBusinessParticipant>[0]
  & ConstructorParameters<typeof MysqlRentalIntegrationRepository>[0]
  & ConstructorParameters<typeof RentalFileStorageApplication>[0] & FileAccessDependencies[0]
  & ConstructorParameters<typeof TenantInspectionObjectReader>[0] & PaymentDependencies[0]
  & ConstructorParameters<typeof PaymentReconciliationFileService>[0]
  & NonNullable<DocumentDependencies[2]> & StaffPaymentDependencies[0]
  & ConstructorParameters<typeof RentalWorkspaceReportRepository>[0]
  & ConstructorParameters<typeof RentalExchangeInspectionMediaService<Prisma.TransactionClient>>[0];

/** 知识参加者整组可选；未装配时原文件应用保持 unavailable，不接受空成功替身。 */
export type RentalIntegrationKnowledgeParticipants<Revision extends FileKnowledgeRevision> = Required<Pick<
  RentalFileStorageParticipants<Revision>, "knowledgeFiles" | "parseKnowledgeUploadRevision" | "knowledgeUploadKey" | "knowledgeCommitUnknown">>;

export interface RentalIntegrationFoundationDependencies<Revision extends FileKnowledgeRevision = FileKnowledgeRevision> {
  database: RentalIntegrationApplicationDatabase;
  configuration: RentalIntegrationConfiguration;
  secrets: ConstructorParameters<typeof TenantIntegrationService>[1];
  operationLog: ConstructorParameters<typeof TenantIntegrationService>[2];
  coreFacts: FileAccessDependencies[1];
  businessFacts: FileAccessDependencies[2];
  customerOperations: FileAccessDependencies[3];
  funding: PaymentDependencies[2] & DocumentDependencies[1] & StaffPaymentDependencies[1];
  fileAuthority: NonNullable<RentalFileStorageParticipants<Revision>["auth"]>;
  fileCleanupAuthority: NonNullable<RentalFileStorageParticipants<Revision>["cleanupAuthority"]>;
  readInspectionMedia: RentalFileStorageParticipants<Revision>["readInspectionMedia"];
  failureEvents?: NonNullable<PaymentDependencies[4]>;
  knowledge?: RentalIntegrationKnowledgeParticipants<Revision>;
}

/** 与原宿主登记的实际运行目录一致；配置存在不等于权限、连通性或一次业务提交成功。 */
export const RENTAL_INTEGRATION_RUNTIME_PROVIDERS = Object.freeze({
  aliyun_sms: "sms", tencent_sms: "sms", smtp: "email", alipay: "payment", wechat_pay: "payment", stripe: "payment",
  aliyun_oss: "file", tencent_cos: "file", s3_compatible: "file"
} satisfies IntegrationRuntimeProviders);

/** 仅管理原文件清理的宿主生命周期；停新后等待当前批次，不取消、改键或再次删除未知结果。 */
class RentalFileCleanupLifecycle {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopping = false;
  constructor(private readonly files: Pick<RentalFileStorageApplication,
    "cleanupExpiredUploadSessionsForAllTenants" | "cleanupPendingFileAssetDeletesForAllTenants">,
    private readonly configuration: RentalIntegrationConfiguration) {}

  onApplicationBootstrap(): void {
    if (this.timer || this.configuration.get<string>("NODE_ENV") === "test"
      || this.configuration.get<string>("FILE_UPLOAD_CLEANUP_DISABLED") === "true") return;
    const configured = Number(this.configuration.get<unknown>("FILE_UPLOAD_CLEANUP_INTERVAL_MS") ?? 5 * 60 * 1000);
    const interval = Number.isFinite(configured) ? Math.max(configured, 60 * 1000) : 5 * 60 * 1000;
    this.stopping = false;
    this.timer = setInterval(() => { void this.runOnce(); }, interval);
    this.timer.unref?.();
  }

  runOnce(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.active) return this.active;
    const running = Promise.allSettled([
      this.files.cleanupExpiredUploadSessionsForAllTenants(),
      this.files.cleanupPendingFileAssetDeletesForAllTenants()
    ]).then(() => undefined);
    this.active = running;
    return running.finally(() => { if (this.active === running) this.active = undefined; });
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }
}

/** 阶段一在 Core 前构造。原 Auth 已就绪，fileAuthority 直接提供同事务主体锁，无延迟放行或反向构造。 */
export function createRentalIntegrationFoundation<Revision extends FileKnowledgeRevision = FileKnowledgeRevision>(
  input: RentalIntegrationFoundationDependencies<Revision>
) {
  for (const name of ["database", "configuration", "secrets", "operationLog", "coreFacts", "businessFacts",
    "customerOperations", "funding", "fileAuthority", "fileCleanupAuthority", "readInspectionMedia"] as const) {
    if (input[name] == null) throw new Error(`Rental 集成装配缺少依赖: ${name}`);
  }
  if (typeof input.configuration.get !== "function" || typeof input.fileAuthority.lockRequestWorkspaceAccess !== "function"
    || typeof input.fileCleanupAuthority.assert !== "function"
    || typeof input.readInspectionMedia !== "function"
    || input.failureEvents !== undefined && typeof input.failureEvents.refund !== "function") {
    throw new Error("Rental 集成装配的原配置、文件权威、媒体读取器或退款失败出箱无效");
  }
  const source = input.configuration.get<string>("INFRA_DATA_SOURCE") ?? input.configuration.get<string>("RENTAL_OS_DATA_SOURCE") ?? "mysql";
  if (source.toLowerCase() !== "mysql") throw new Error("Rental 标准集成宿主需要 mysql 持久存储");
  if (input.knowledge) {
    if (!input.knowledge.knowledgeFiles) throw new Error("Rental 知识文件缺少原 ACL 参加者");
    for (const name of ["parseKnowledgeUploadRevision", "knowledgeUploadKey", "knowledgeCommitUnknown"] as const) {
      if (typeof input.knowledge[name] !== "function") throw new Error(`Rental 知识文件缺少原方法: ${name}`);
    }
  }
  const { database, configuration, secrets, operationLog, funding } = input;
  // 保留原生成客户端的 JSON null 与事务委托，公共服务不会构造另一套数据库。
  const integrationStore: TenantIntegrationDataStore = {
    tenantIntegrationConfig: database.tenantIntegrationConfig,
    externalAdapterLog: database.externalAdapterLog,
    $queryRaw: (query, ...values) => database.$queryRaw(query, ...values),
    $transaction: (work, options) => database.$transaction(work, options),
    updateTestConfiguration: ({ where, data }) => database.tenantIntegrationConfig.updateMany({
      where: integrationTestWhere(where, rentalPrismaNulls.JsonNull), data
    })
  };
  const integrationBusiness = new RentalIntegrationBusinessParticipant(database);
  const integrations = new TenantIntegrationService(integrationStore, secrets, operationLog,
    integrationBusiness, RENTAL_INTEGRATION_RUNTIME_PROVIDERS);
  const notifications = new TenantIntegrationRuntimeService(database, integrations);
  const email = new TenantEmailRuntimeService(integrations);
  const wechatTransport = new WechatMiniProgramAdapter();
  const fileAccess = new RentalFileBusinessAccessService(database, input.coreFacts, input.businessFacts, input.customerOperations);
  const inspectionObjectReader = new TenantInspectionObjectReader(database, integrations);
  const files = new RentalFileStorageApplication<Revision>(database, integrations, {
    ...input.knowledge, operationLog, fileAccess, auth: input.fileAuthority, cleanupAuthority: input.fileCleanupAuthority, inspectionObjectReader,
    readInspectionMedia: input.readInspectionMedia, parseStaffUploadObservation
  });
  const payments = new PaymentRuntimeService(database, integrations, funding, {
    getRequestIdentity, getRequestWorkspaceId,
    requestRentalOrderVisibilityWhere: () => requestRentalOrderVisibilityWhere({
      getRequestDataScope, getRequestLocationIds, getRequestUserId
    })
  }, input.failureEvents);
  const connectivity = new TenantIntegrationConnectivityService(integrations, notifications, files, payments, email);
  const statements = new PaymentReconciliationFileService(database, { getRequestIdentity });
  const reports = new RentalWorkspaceReportRepository(database);
  const integrationRepository = new MysqlRentalIntegrationRepository(database);
  const ledger = new RentalIntegrationApplication(configuration, integrationRepository, fileAccess);
  const fileCleanup = new RentalFileCleanupLifecycle(files, configuration);
  return Object.freeze({ database, configuration, secrets, operationLog, funding, integrationStore, integrationBusiness,
    integrationRuntimeProviders: RENTAL_INTEGRATION_RUNTIME_PROVIDERS, integrations, notifications, email, wechatTransport,
    fileAccess, inspectionObjectReader, files, payments, connectivity, statements, reports, integrationRepository,
    ledger, fileCleanup, parseStaffUploadObservation });
}

export type RentalIntegrationFoundation<Revision extends FileKnowledgeRevision = FileKnowledgeRevision> =
  ReturnType<typeof createRentalIntegrationFoundation<Revision>>;
export type RentalIntegrationApplicationCore = DocumentDependencies[0] & StaffPaymentDependencies[2];

/** 阶段二在同一 Core 就绪后构造，返回给 Client 和原 HTTP 的实际单据/收款实例。 */
export function createRentalIntegrationApplications<Revision extends FileKnowledgeRevision>(input: {
  foundation: RentalIntegrationFoundation<Revision>; core: RentalIntegrationApplicationCore;
}) {
  if (!input.foundation || !input.core) throw new Error("Rental 单据/收款装配缺少原集成基础或 Core");
  const { database, funding } = input.foundation;
  const documents = new RentalDocumentService(input.core, funding, database);
  const staffPayments = new StaffOfflinePaymentService<Prisma.TransactionClient>(database, funding, input.core);
  return Object.freeze({ ...input.foundation, documents, staffPayments });
}

export type RentalIntegrationApplications<Revision extends FileKnowledgeRevision = FileKnowledgeRevision> =
  ReturnType<typeof createRentalIntegrationApplications<Revision>>;

/** 阶段三在企业工厂完成后接入其原检查准备实例，保留 files 内部冻结计划和同事务证据。 */
export function createRentalExchangeInspectionMedia<Revision extends FileKnowledgeRevision>(input: {
  foundation: RentalIntegrationFoundation<Revision>;
  inspections: ConstructorParameters<typeof RentalExchangeInspectionMediaService<Prisma.TransactionClient, ExchangeInspectionUploadPlan<Revision>>>[1];
}) {
  if (!input.foundation || !input.inspections) throw new Error("Rental 换货影像装配缺少原集成基础或检查准备");
  return new RentalExchangeInspectionMediaService<Prisma.TransactionClient, ExchangeInspectionUploadPlan<Revision>>(
    input.foundation.database, input.inspections, input.foundation.files
  );
}
