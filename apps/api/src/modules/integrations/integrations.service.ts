import { BadRequestException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type {
  AdapterLogSummary,
  AsyncJobSummary,
  BindTBoxDeviceRequest,
  CreateAsyncJobRequest,
  CreateDataExchangeJobRequest,
  CreateFileAssetRequest,
  CreatePrintJobRequest,
  DataExchangeJobResult,
  DataExchangeTemplateSummary,
  FileAssetQuery,
  FileAssetSummary,
  InfraAdapterCapability,
  InfraCapabilityCard,
  InfraDashboardResult,
  InvokeMockAdapterRequest,
  NotificationSendLogSummary,
  NotificationTemplateSummary,
  PrintJobSummary,
  SaveTBoxDeviceRequest,
  SendMockNotificationRequest,
  TBoxDeviceSummary
} from "@rental-os/shared";
import { requireRequestTenantId } from "../../common/request-identity";
import { RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE } from "@rental-os/shared";
import { IntegrationsRepository } from "./integrations.repository";
import { FileBusinessAccessService } from "../files/file-business-access.service";

function safeFileAssetSummary(file: FileAssetSummary): FileAssetSummary {
  const safe = { ...file };
  delete safe.storageKey;
  delete safe.publicUrl;
  return safe;
}

@Injectable()
export class IntegrationsService {
  private get defaultTenantId() {
    return requireRequestTenantId();
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationsRepository: IntegrationsRepository,
    @Optional() private readonly fileAccess?: FileBusinessAccessService
  ) {}

  private readonly files: FileAssetSummary[] = [
    {
      id: "file_demo_contract_001",
      businessModule: "rental-os",
      businessType: "order_contract",
      businessId: "order_10001",
      fileName: "SR202605060001-租赁合约.pdf",
      fileExt: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 186_240,
      storageProvider: "local_mock",
      storageKey: "mock/tenant_001/file_demo_contract_001/SR202605060001-租赁合约.pdf",
      publicUrl: "/api/files/file_demo_contract_001/download",
      uploadScene: "contract_mock",
      status: "active",
      uploadedBy: "系统预置",
      createdAt: "2026-06-08T08:30:00.000Z"
    }
  ];
  /** 内存 mock 也必须按当前租户隔离，不能把演示数组当成共享数据源。 */
  private readonly filesByTenant = new Map<string, FileAssetSummary[]>();
  /**
   * 内存 fallback 不能因为没有 Prisma 就退回进程级共享数组。
   * 这些集合都承载租户可见的运行事实；每个租户首次访问时从只读演示模板复制一份。
   */
  private readonly notificationLogsByTenant = new Map<string, NotificationSendLogSummary[]>();
  private readonly adapterLogsByTenant = new Map<string, AdapterLogSummary[]>();
  private readonly jobsByTenant = new Map<string, AsyncJobSummary[]>();
  private readonly printJobsByTenant = new Map<string, PrintJobSummary[]>();
  private readonly tboxDevicesByTenant = new Map<string, TBoxDeviceSummary[]>();

  private readonly notificationTemplates = defaultNotificationTemplates();
  private readonly dataExchangeTemplates = defaultDataExchangeTemplates();

  private readonly notificationLogs: NotificationSendLogSummary[] = [
    {
      id: "notify_demo_001",
      templateCode: "order_confirmed",
      businessType: "rental_order",
      businessId: "order_10001",
      targetType: "member",
      targetName: "陈小明",
      targetMasked: "852****0001",
      channels: ["APP", "SMS"],
      provider: "mock-notification-adapter",
      status: "mock_success",
      sentAt: "2026-06-08T09:00:00.000Z",
      createdAt: "2026-06-08T09:00:00.000Z",
      requestJson: {
        templateCode: "order_confirmed",
        variables: { 订单号: "SR202605060001" }
      },
      responseJson: {
        externalCallSkipped: true,
        message: "MVP 阶段未调用真实短信或 APP 推送。"
      }
    }
  ];

  private readonly adapterLogs: AdapterLogSummary[] = [
    {
      id: "adapter_demo_ai_001",
      provider: "mock-ai-dispatch-adapter",
      capability: "ai_dispatch",
      operation: "connection_test",
      businessType: "dispatch",
      businessId: "system_rules",
      status: "mock_success",
      requestJson: {
        model: "gpt-xxx",
        privacyFilter: ["手机号", "证件号", "支付资料", "API Key"]
      },
      responseJson: {
        externalCallSkipped: true,
        message: "AI 连接测试仅校验配置结构。"
      },
      createdAt: "2026-06-08T09:05:00.000Z"
    }
  ];

  private readonly jobs: AsyncJobSummary[] = [
    {
      id: "job_demo_pending_payment_timeout",
      jobType: "pending_payment_timeout",
      businessType: "rental_order",
      businessId: "order_10002",
      status: "queued",
      attempt: 0,
      maxAttempts: 3,
      scheduledAt: "2026-06-08T10:00:00.000Z",
      operator: "系统预置",
      payload: {
        ruleSnapshot: "待支付资源保留 30 分钟，到期后自动取消并释放库存。"
      },
      createdAt: "2026-06-08T09:30:00.000Z",
      updatedAt: "2026-06-08T09:30:00.000Z"
    }
  ];

  private readonly printJobs: PrintJobSummary[] = [
    {
      id: "print_demo_001",
      documentNo: "DOC-20260608-0001",
      documentType: "rental_contract",
      templateCode: "rental-os-contract-v1",
      businessType: "rental_order",
      businessId: "order_10001",
      status: "mock_generated",
      fileAssetId: "file_demo_contract_001",
      operator: "系统预置",
      payload: { orderNo: "SR202605060001" },
      result: {
        externalCallSkipped: true,
        message: "MVP 阶段仅生成 mock 单据记录。"
      },
      createdAt: "2026-06-08T08:30:00.000Z",
      updatedAt: "2026-06-08T08:30:00.000Z"
    }
  ];

  private readonly tboxDevices: TBoxDeviceSummary[] = [
    {
      id: "tbox_demo_001",
      cid: "CID-HK-880001",
      simNo: "89852-0000-0001",
      model: "STORE-TBOX-A1",
      status: "bound",
      boundVehicleId: "vehicle_001",
      boundPlateNo: "RX 7821",
      vehicleModel: "Toyota Corolla",
      firmwareVersion: "V1.4.8",
      appVersion: "V2.1.0",
      warrantyExpireAt: "2027-05-31",
      supportsIButton: true,
      iButtonCode: "IB-8F31",
      powerOnAt: "2026-06-08T07:50:00.000Z",
      lastHeartbeatAt: "2026-06-08T09:12:00.000Z",
      telemetry: { voltage: "12.4V", gps: "normal", doorLock: "locked" },
      updatedAt: "2026-06-08T09:12:00.000Z"
    },
    {
      id: "tbox_demo_002",
      cid: "CID-HK-880002",
      simNo: "89852-0000-0002",
      model: "STORE-TBOX-A1",
      status: "unbound",
      firmwareVersion: "V1.4.8",
      appVersion: "V2.1.0",
      warrantyExpireAt: "2027-05-31",
      supportsIButton: false,
      updatedAt: "2026-06-08T09:00:00.000Z"
    }
  ];

  async getDashboard(): Promise<InfraDashboardResult> {
    const [
      files,
      notificationTemplates,
      notificationLogs,
      adapterLogs,
      jobs,
      dataExchangeTemplates,
      printJobs,
      tboxDevices
    ] = await Promise.all([
      this.listFiles(),
      this.listNotificationTemplates(),
      this.listNotificationLogs(),
      this.listAdapterLogs(),
      this.listJobs(),
      Promise.resolve(this.listDataExchangeTemplates()),
      this.listPrintJobs(),
      this.listTBoxDevices()
    ]);

    return {
      generatedAt: new Date().toISOString(),
      capabilities: buildCapabilityCards({
        adapterLogs,
        notificationLogs,
        printJobs,
        files
      }),
      files,
      notificationTemplates,
      notificationLogs,
      adapterLogs,
      jobs,
      dataExchangeTemplates,
      printJobs,
      tboxDevices
    };
  }

  async listFiles(query: FileAssetQuery = {}) {
    if (!this.fileAccess) throw new ServiceUnavailableException("文件业务读取权威未配置");
    const tenantId = this.defaultTenantId;
    if (this.useMysqlDataSource()) {
      const key = this.fileAccess.authorityKey(tenantId);
      const candidates = await this.integrationsRepository.listFiles(tenantId, query);
      if (this.fileAccess.authorityKey(tenantId) !== key) throw new ServiceUnavailableException("文件读取期间授权范围已变化");
      return this.fileAccess.filterReadable(tenantId, candidates);
    }
    const limit = Math.min(Math.max(Number(query.limit ?? 80), 1), 200);
    const candidates = this.memoryFilesForTenant(tenantId)
      .filter((file) => {
        if (file.uploadScene === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) return false;
        if (query.businessModule && file.businessModule !== query.businessModule) {
          return false;
        }
        if (query.businessType && file.businessType !== query.businessType) {
          return false;
        }
        if (query.businessId && file.businessId !== query.businessId) {
          return false;
        }
        if (query.uploadScene && file.uploadScene !== query.uploadScene) {
          return false;
        }
        if (query.status && file.status !== query.status) {
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map(safeFileAssetSummary);
    return this.fileAccess.filterReadable(tenantId, candidates);
  }

  async createFile(input: CreateFileAssetRequest) {
    if (input.uploadScene?.trim() === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new BadRequestException("不能直接登记专用换货影像");
    // 该接口只登记开发/演示用的模拟文件元数据，不是实际的对象存储上传。
    // 生产环境禁止它生成 local_mock active 资产，避免未配置真实文件平台时
    // 把“已生成元数据”误读成“文件已上传并可用”。真实业务必须走
    // FileStorageRuntimeService 的上传会话、live 门禁和完成确认链。
    if (process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException("生产环境禁止创建模拟文件资产，请使用真实文件存储上传链");
    }
    validateRequired(input.businessModule, "业务模块不能为空");
    validateRequired(input.businessType, "业务对象类型不能为空");
    validateRequired(input.fileName, "文件名不能为空");
    validateRequired(input.mimeType, "文件类型不能为空");

    const created = this.useMysqlDataSource()
      ? await this.integrationsRepository.createFile(input, this.defaultTenantId)
      : this.createMemoryFile(input);

    await this.recordAdapterLog({
      provider: "mock-file-storage-adapter",
      capability: "file",
      operation: "upload_metadata",
      businessType: input.businessType,
      businessId: input.businessId,
      status: "mock_success",
      requestJson: {
        fileName: input.fileName,
        mimeType: input.mimeType,
        businessModule: input.businessModule,
        businessType: input.businessType,
        businessId: input.businessId,
        storageProvider: "local_mock"
      },
      responseJson: {
        externalCallSkipped: true,
        fileId: created.id,
        reference: "protected-file-reference"
      }
    });

    return safeFileAssetSummary(created);
  }

  async listNotificationTemplates() {
    if (this.useMysqlDataSource()) {
      return this.integrationsRepository.listNotificationTemplates(this.defaultTenantId);
    }
    return [...this.notificationTemplates];
  }

  async listNotificationLogs() {
    if (this.useMysqlDataSource()) {
      return this.integrationsRepository.listNotificationLogs(this.defaultTenantId);
    }
    return [...this.memoryNotificationLogsForTenant(this.defaultTenantId)];
  }

  async sendNotification(input: SendMockNotificationRequest) {
    if (!input.channels?.length) {
      throw new BadRequestException("至少选择一个通知渠道");
    }
    if (process.env.NODE_ENV === "production" && input.channels.some((channel) => String(channel).toUpperCase() === "SMS")) {
      throw new ServiceUnavailableException("生产环境禁止通过模拟入口记录短信发送，请使用已验证的租户短信平台");
    }
    validateRequired(input.businessType, "业务对象类型不能为空");

    const log = this.useMysqlDataSource()
      ? await this.integrationsRepository.recordNotification(input, this.defaultTenantId)
      : this.createMemoryNotificationLog(input);

    await this.recordAdapterLog({
      provider: "mock-notification-adapter",
      capability: inferNotificationCapability(input.channels),
      operation: "send_notification",
      businessType: input.businessType,
      businessId: input.businessId,
      status: "mock_success",
      requestJson: {
        templateCode: input.templateCode,
        channels: input.channels,
        targetMasked: input.targetMasked,
        variables: input.variables ?? {}
      },
      responseJson: {
        externalCallSkipped: true,
        notificationLogId: log.id,
        message: "MVP 阶段未调用真实短信、邮件或 APP 推送。"
      }
    });

    return log;
  }

  async listAdapterLogs() {
    if (this.useMysqlDataSource()) {
      return this.integrationsRepository.listAdapterLogs(this.defaultTenantId);
    }
    return [...this.memoryAdapterLogsForTenant(this.defaultTenantId)];
  }

  async invokeMockAdapter(input: InvokeMockAdapterRequest) {
    validateRequired(input.provider, "适配器 provider 不能为空");
    validateRequired(input.capability, "适配能力不能为空");
    validateRequired(input.operation, "操作类型不能为空");
    if (process.env.NODE_ENV === "production" && ["payment", "pre_auth", "sms", "file"].includes(input.capability)) {
      throw new ServiceUnavailableException("生产环境禁止调用支付、短信或文件模拟适配器");
    }

    return this.recordAdapterLog({
      provider: input.provider,
      capability: input.capability,
      operation: input.operation,
      businessType: input.businessType,
      businessId: input.businessId,
      status: "mock_success",
      requestJson: {
        payload: input.payload ?? {},
        operator: input.operator ?? "营运端"
      },
      responseJson: {
        externalCallSkipped: true,
        traceId: `TRACE-${Date.now()}`,
        message: "MVP 阶段自动跳过真实外部调用，仅记录可追踪日志。"
      }
    });
  }

  async recordAdapterLog(input: Omit<AdapterLogSummary, "id" | "createdAt">) {
    if (this.useMysqlDataSource()) {
      return this.integrationsRepository.recordAdapterLog(input, this.defaultTenantId);
    }

    const row: AdapterLogSummary = {
      id: `adapter_${shortId()}`,
      createdAt: new Date().toISOString(),
      ...input
    };
    this.memoryAdapterLogsForTenant(this.defaultTenantId).unshift(row);
    return row;
  }

  async listJobs() {
    if (this.useMysqlDataSource()) {
      return this.integrationsRepository.listJobs(this.defaultTenantId);
    }
    return [...this.memoryJobsForTenant(this.defaultTenantId)];
  }

  async createJob(input: CreateAsyncJobRequest) {
    validateRequired(input.jobType, "任务类型不能为空");
    const job = this.useMysqlDataSource()
      ? await this.integrationsRepository.createJob(input, this.defaultTenantId)
      : this.createMemoryJob(input);

    await this.recordAdapterLog({
      provider: "mock-job-runner",
      capability: "export",
      operation: "enqueue_job",
      businessType: input.businessType,
      businessId: input.businessId,
      status: "mock_success",
      requestJson: {
        jobType: input.jobType,
        scheduledAt: job.scheduledAt
      },
      responseJson: {
        externalCallSkipped: true,
        jobId: job.id
      }
    });

    return job;
  }

  listDataExchangeTemplates() {
    return [...this.dataExchangeTemplates];
  }

  async createDataExchangeJob(
    input: CreateDataExchangeJobRequest
  ): Promise<DataExchangeJobResult> {
    validateRequired(input.operation, "导入导出操作不能为空");
    validateRequired(input.targetModule, "目标模块不能为空");
    validateRequired(input.targetObject, "目标对象不能为空");
    const template = this.findDataExchangeTemplate(input);
    if (!template) {
      throw new BadRequestException("未找到可用的导入导出模板");
    }

    let sourceFileAsset: FileAssetSummary | undefined;
    if (input.operation === "import_validate") {
      if (!input.sourceFileAssetId && !input.sourceFileName) {
        throw new BadRequestException("导入校验需要上传文件或指定已有附件 ID");
      }
      if (input.sourceFileName) {
        sourceFileAsset = await this.createFile({
          businessModule: input.targetModule,
          businessType: `data_exchange_${input.targetObject}`,
          businessId: input.templateCode ?? template.templateCode,
          fileName: input.sourceFileName,
          mimeType: spreadsheetMimeType(template.format),
          sizeBytes: 0,
          uploadScene: "import_source_mock",
          uploadedBy: input.operator ?? "营运端",
          metadata: {
            templateCode: template.templateCode,
            targetObject: input.targetObject,
            externalCallSkipped: true
          }
        });
      }
    }

    const job = await this.createJob({
      jobType: `data_${input.operation}`,
      businessType: `data_exchange_${input.targetObject}`,
      businessId: input.templateCode ?? template.templateCode,
      operator: input.operator ?? "营运端",
      payload: {
        dataExchangeOperation: input.operation,
        targetModule: input.targetModule,
        targetObject: input.targetObject,
        templateCode: template.templateCode,
        templateName: template.name,
        format: template.format,
        importMode: input.importMode ?? "validate_only",
        sourceFileAssetId: input.sourceFileAssetId ?? sourceFileAsset?.id,
        filters: input.filters ?? {},
        mockFileName: buildDataExchangeFileName(template, input.operation),
        externalCallSkipped: true
      }
    });

    await this.recordAdapterLog({
      provider: "mock-export-adapter",
      capability: "export",
      operation: `enqueue_${input.operation}`,
      businessType: `data_exchange_${input.targetObject}`,
      businessId: job.id,
      status: "mock_success",
      requestJson: {
        templateCode: template.templateCode,
        targetObject: input.targetObject,
        importMode: input.importMode ?? "validate_only"
      },
      responseJson: {
        externalCallSkipped: true,
        jobId: job.id,
        message: "MVP 阶段仅入队导入导出任务，不生成或解析真实 Excel。"
      }
    });

    return { job, sourceFileAsset };
  }

  async runJob(id: string) {
    const existingJob = this.useMysqlDataSource()
      ? await this.integrationsRepository.getJob(id, this.defaultTenantId)
      : this.memoryJobsForTenant(this.defaultTenantId).find((item) => item.id === id);

    if (!existingJob) {
      throw new BadRequestException("任务不存在");
    }

    const result = await this.buildJobRunResult(existingJob);

    if (this.useMysqlDataSource()) {
      const job = await this.integrationsRepository.finishJob(
        id,
        result,
        this.defaultTenantId
      );
      await this.recordJobRunLog(job);
      return job;
    }

    const job = existingJob;
    const now = new Date().toISOString();
    job.status = "success";
    job.attempt += 1;
    job.startedAt ||= now;
    job.finishedAt = now;
    job.result = result;
    job.updatedAt = now;
    await this.recordJobRunLog(job);
    return job;
  }

  async runDueJobs() {
    const now = Date.now();
    const jobs = await this.listJobs();
    const dueJobs = jobs.filter(
      (job) =>
        job.status === "queued" &&
        (!job.scheduledAt || new Date(job.scheduledAt).getTime() <= now)
    );
    const results = [];
    for (const job of dueJobs.slice(0, 10)) {
      results.push(await this.runJob(job.id));
    }
    return {
      ranCount: results.length,
      jobs: results,
      message: "MVP 阶段未启动常驻 worker，本接口用于手动触发到期任务。"
    };
  }

  async listPrintJobs() {
    if (this.useMysqlDataSource()) {
      return this.integrationsRepository.listPrintJobs(this.defaultTenantId);
    }
    return [...this.memoryPrintJobsForTenant(this.defaultTenantId)];
  }

  async createPrintJob(input: CreatePrintJobRequest) {
    validateRequired(input.documentType, "单据类型不能为空");
    validateRequired(input.templateCode, "模板编码不能为空");
    validateRequired(input.businessType, "业务对象类型不能为空");

    const documentNo = `DOC-${formatDateNo(new Date())}-${String(
      (await this.listPrintJobs()).length + 1
    ).padStart(4, "0")}`;
    const file = await this.createFile({
      businessModule: "rental-os",
      businessType: input.businessType,
      businessId: input.businessId,
      fileName: `${documentNo}-${input.documentType}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 0,
      uploadScene: "print_mock",
      uploadedBy: input.operator ?? "营运端",
      metadata: {
        documentType: input.documentType,
        templateCode: input.templateCode
      }
    });

    const printJob = this.useMysqlDataSource()
      ? await this.integrationsRepository.createPrintJob(
          input,
          file.id,
          documentNo,
          this.defaultTenantId
        )
      : this.createMemoryPrintJob(input, file.id, documentNo);

    await this.recordAdapterLog({
      provider: "mock-print-adapter",
      capability: "print",
      operation: "generate_document",
      businessType: input.businessType,
      businessId: input.businessId,
      status: "mock_success",
      requestJson: {
        documentNo,
        documentType: input.documentType,
        templateCode: input.templateCode
      },
      responseJson: {
        externalCallSkipped: true,
        printJobId: printJob.id,
        fileAssetId: file.id
      }
    });

    return printJob;
  }

  async listTBoxDevices() {
    if (this.useMysqlDataSource()) {
      return this.integrationsRepository.listTBoxDevices(this.defaultTenantId);
    }
    return [...this.memoryTBoxDevicesForTenant(this.defaultTenantId)];
  }

  async saveTBoxDevice(input: SaveTBoxDeviceRequest) {
    validateRequired(input.cid, "CID 不能为空");
    validateRequired(input.model, "设备型号不能为空");

    const device = this.useMysqlDataSource()
      ? await this.integrationsRepository.saveTBoxDevice(input, this.defaultTenantId)
      : this.saveMemoryTBoxDevice(input);

    await this.recordAdapterLog({
      provider: "mock-tbox-adapter",
      capability: "tbox",
      operation: input.id ? "update_device" : "register_device",
      businessType: "tbox_device",
      businessId: device.id,
      status: "mock_success",
      requestJson: {
        cid: device.cid,
        model: device.model
      },
      responseJson: {
        externalCallSkipped: true,
        message: "TBox 台账已维护，未调用真实车机平台。"
      }
    });

    return device;
  }

  async bindTBoxDevice(id: string, input: BindTBoxDeviceRequest) {
    const device = this.useMysqlDataSource()
      ? await this.integrationsRepository.bindTBoxDevice(
          id,
          {
            vehicleId: input.vehicleId,
            plateNo: input.plateNo,
            vehicleModel: input.vehicleModel
          },
          this.defaultTenantId
        )
      : this.bindMemoryTBoxDevice(id, input);

    await this.recordAdapterLog({
      provider: "mock-tbox-adapter",
      capability: "tbox",
      operation: input.plateNo ? "bind_vehicle" : "unbind_vehicle",
      businessType: "tbox_device",
      businessId: id,
      status: "mock_success",
      requestJson: {
        cid: device.cid,
        plateNo: input.plateNo,
        operator: input.operator ?? "营运端"
      },
      responseJson: {
        externalCallSkipped: true,
        message: input.plateNo ? "已完成 mock 绑定。" : "已完成 mock 解绑。"
      }
    });

    return device;
  }

  private createMemoryFile(input: CreateFileAssetRequest) {
    const tenantId = this.defaultTenantId;
    const fileId = `file_${shortId()}`;
    const fileExt = input.fileName.includes(".")
      ? input.fileName.split(".").pop()
      : undefined;
    const row: FileAssetSummary = {
      id: fileId,
      businessModule: input.businessModule,
      businessType: input.businessType,
      businessId: input.businessId,
      fileName: input.fileName,
      fileExt,
      mimeType: input.mimeType,
      sizeBytes: Math.max(0, Math.round(input.sizeBytes ?? 0)),
      storageProvider: "local_mock",
      storageKey: `mock/${tenantId}/${fileId}/${input.fileName}`,
      publicUrl: `/api/files/${fileId}/download`,
      uploadScene: input.uploadScene,
      status: "active",
      uploadedBy: input.uploadedBy,
      createdAt: new Date().toISOString()
    };
    this.memoryFilesForTenant(tenantId).unshift(row);
    return row;
  }

  private memoryFilesForTenant(tenantId: string) {
    const existing = this.filesByTenant.get(tenantId);
    if (existing) return existing;
    const seeded = this.files.map((file) => {
      const id = `${file.id}_${tenantId}`;
      return {
        ...file,
        id,
        storageKey: (file.storageKey ?? `mock/${tenantId}/${id}`).replace(/^mock\/[^/]+/u, `mock/${tenantId}`),
        publicUrl: `/api/files/${id}/download`
      };
    });
    this.filesByTenant.set(tenantId, seeded);
    return seeded;
  }

  private createMemoryNotificationLog(input: SendMockNotificationRequest) {
    const tenantId = this.defaultTenantId;
    const now = new Date().toISOString();
    const row: NotificationSendLogSummary = {
      id: `notify_${shortId()}`,
      templateCode: input.templateCode,
      businessType: input.businessType,
      businessId: input.businessId,
      targetType: input.targetType,
      targetName: input.targetName,
      targetMasked: input.targetMasked,
      channels: input.channels,
      provider: "mock-notification-adapter",
      status: "mock_success",
      sentAt: now,
      createdAt: now,
      requestJson: {
        templateCode: input.templateCode,
        variables: input.variables ?? {},
        operator: input.operator ?? "营运端"
      },
      responseJson: {
        externalCallSkipped: true,
        message: "MVP 阶段未调用真实短信、邮件或 APP 推送。"
      }
    };
    this.memoryNotificationLogsForTenant(tenantId).unshift(row);
    return row;
  }

  private createMemoryJob(input: CreateAsyncJobRequest) {
    const tenantId = this.defaultTenantId;
    const now = new Date().toISOString();
    const row: AsyncJobSummary = {
      id: `job_${shortId()}`,
      jobType: input.jobType,
      businessType: input.businessType,
      businessId: input.businessId,
      status: "queued",
      attempt: 0,
      maxAttempts: 3,
      scheduledAt: input.scheduledAt ?? now,
      operator: input.operator,
      payload: input.payload ?? {},
      createdAt: now,
      updatedAt: now
    };
    this.memoryJobsForTenant(tenantId).unshift(row);
    return row;
  }

  private createMemoryPrintJob(
    input: CreatePrintJobRequest,
    fileAssetId: string,
    documentNo: string
  ) {
    const tenantId = this.defaultTenantId;
    const now = new Date().toISOString();
    const row: PrintJobSummary = {
      id: `print_${shortId()}`,
      documentNo,
      documentType: input.documentType,
      templateCode: input.templateCode,
      businessType: input.businessType,
      businessId: input.businessId,
      status: "mock_generated",
      fileAssetId,
      operator: input.operator,
      payload: input.payload ?? {},
      result: {
        externalCallSkipped: true,
        fileAssetId,
        message: "MVP 阶段仅生成 mock 单据记录，不渲染真实 PDF。"
      },
      createdAt: now,
      updatedAt: now
    };
    this.memoryPrintJobsForTenant(tenantId).unshift(row);
    return row;
  }

  private saveMemoryTBoxDevice(input: SaveTBoxDeviceRequest) {
    const devices = this.memoryTBoxDevicesForTenant(this.defaultTenantId);
    const now = new Date().toISOString();
    const existing = input.id
      ? devices.find((item) => item.id === input.id)
      : devices.find((item) => item.cid === input.cid);
    if (input.id && !existing) {
      throw new NotFoundException(`TBox device ${input.id} was not found`);
    }
    const row: TBoxDeviceSummary = {
      id: existing?.id ?? `tbox_${shortId()}`,
      cid: input.cid,
      simNo: input.simNo,
      model: input.model,
      status: input.status ?? existing?.status ?? "unbound",
      boundVehicleId: existing?.boundVehicleId,
      boundPlateNo: existing?.boundPlateNo,
      vehicleModel: existing?.vehicleModel,
      firmwareVersion: input.firmwareVersion,
      appVersion: input.appVersion,
      warrantyExpireAt: input.warrantyExpireAt,
      supportsIButton: Boolean(input.supportsIButton),
      iButtonCode: input.iButtonCode,
      powerOnAt: existing?.powerOnAt,
      lastHeartbeatAt: existing?.lastHeartbeatAt,
      telemetry: existing?.telemetry,
      updatedAt: now
    };
    const index = devices.findIndex((item) => item.id === row.id);
    if (index >= 0) {
      devices[index] = row;
    } else {
      devices.unshift(row);
    }
    return row;
  }

  private bindMemoryTBoxDevice(id: string, input: BindTBoxDeviceRequest) {
    const device = this.memoryTBoxDevicesForTenant(this.defaultTenantId).find((item) => item.id === id);
    if (!device) {
      throw new BadRequestException("TBox 设备不存在");
    }
    device.status = input.plateNo ? "bound" : "unbound";
    device.boundVehicleId = input.vehicleId;
    device.boundPlateNo = input.plateNo;
    device.vehicleModel = input.vehicleModel;
    device.lastHeartbeatAt = input.plateNo ? new Date().toISOString() : device.lastHeartbeatAt;
    device.updatedAt = new Date().toISOString();
    return device;
  }

  private memoryNotificationLogsForTenant(tenantId: string) {
    const existing = this.notificationLogsByTenant.get(tenantId);
    if (existing) return existing;
    const seeded = this.notificationLogs.map((item) => ({
      ...item,
      id: `${item.id}_${tenantId}`
    }));
    this.notificationLogsByTenant.set(tenantId, seeded);
    return seeded;
  }

  private memoryAdapterLogsForTenant(tenantId: string) {
    const existing = this.adapterLogsByTenant.get(tenantId);
    if (existing) return existing;
    const seeded = this.adapterLogs.map((item) => ({
      ...item,
      id: `${item.id}_${tenantId}`
    }));
    this.adapterLogsByTenant.set(tenantId, seeded);
    return seeded;
  }

  private memoryJobsForTenant(tenantId: string) {
    const existing = this.jobsByTenant.get(tenantId);
    if (existing) return existing;
    const seeded = this.jobs.map((item) => ({
      ...item,
      id: `${item.id}_${tenantId}`
    }));
    this.jobsByTenant.set(tenantId, seeded);
    return seeded;
  }

  private memoryPrintJobsForTenant(tenantId: string) {
    const existing = this.printJobsByTenant.get(tenantId);
    if (existing) return existing;
    const seeded = this.printJobs.map((item) => ({
      ...item,
      id: `${item.id}_${tenantId}`,
      fileAssetId: item.fileAssetId ? `${item.fileAssetId}_${tenantId}` : item.fileAssetId
    }));
    this.printJobsByTenant.set(tenantId, seeded);
    return seeded;
  }

  private memoryTBoxDevicesForTenant(tenantId: string) {
    const existing = this.tboxDevicesByTenant.get(tenantId);
    if (existing) return existing;
    const seeded = this.tboxDevices.map((item) => ({
      ...item,
      id: `${item.id}_${tenantId}`
    }));
    this.tboxDevicesByTenant.set(tenantId, seeded);
    return seeded;
  }

  private async recordJobRunLog(job: AsyncJobSummary) {
    await this.recordAdapterLog({
      provider: isDataExchangeJob(job) ? "mock-export-adapter" : "mock-job-runner",
      capability: "export",
      operation: isDataExchangeJob(job)
        ? `run_${String(job.payload.dataExchangeOperation ?? "data_exchange")}`
        : "run_job",
      businessType: job.businessType,
      businessId: job.businessId,
      status: "mock_success",
      requestJson: {
        jobId: job.id,
        jobType: job.jobType
      },
      responseJson: {
        externalCallSkipped: true,
        result: job.result ?? {}
      }
    });
  }

  private findDataExchangeTemplate(input: CreateDataExchangeJobRequest) {
    return this.dataExchangeTemplates.find((template) => {
      if (!template.enabled) {
        return false;
      }
      if (input.templateCode) {
        return template.templateCode === input.templateCode && template.operation === input.operation;
      }
      return (
        template.targetModule === input.targetModule &&
        template.targetObject === input.targetObject &&
        template.operation === input.operation
      );
    });
  }

  private async buildJobRunResult(job: AsyncJobSummary): Promise<Record<string, unknown>> {
    if (!isDataExchangeJob(job)) {
      return {
        externalCallSkipped: true,
        message: "MVP 阶段手动触发异步任务，仅更新任务状态并保留执行结果。",
        finishedBy: "manual_mock_runner"
      };
    }

    const operation = String(job.payload.dataExchangeOperation);
    const targetObject = String(job.payload.targetObject ?? "unknown");
    const templateCode = String(job.payload.templateCode ?? "unknown-template");
    const format = String(job.payload.format ?? "xlsx");
    const fileName = String(job.payload.mockFileName ?? `${targetObject}-${operation}.${format}`);

    if (operation === "export" || operation === "template_download") {
      const file = await this.createFile({
        businessModule: "rental-os",
        businessType:
          operation === "template_download" ? "data_exchange_template" : "data_exchange_export",
        businessId: job.id,
        fileName,
        mimeType: spreadsheetMimeType(format),
        sizeBytes: operation === "template_download" ? 0 : 24_576,
        uploadScene: operation === "template_download" ? "import_template_mock" : "export_mock",
        uploadedBy: job.operator ?? "营运端",
        metadata: {
          jobId: job.id,
          templateCode,
          targetObject,
          externalCallSkipped: true
        }
      });
      return {
        externalCallSkipped: true,
        fileAssetId: file.id,
        downloadUrl: file.publicUrl ?? `/api/files/${file.id}/download-url`,
        rowCount: operation === "export" ? 12 : 0,
        message:
          operation === "template_download"
            ? "MVP 阶段仅生成导入模板文件元数据，不渲染真实 Excel。"
            : "MVP 阶段仅生成导出文件元数据，不查询真实大批量数据。"
      };
    }

    const reportFile = await this.createFile({
      businessModule: "rental-os",
      businessType: "data_exchange_import_report",
      businessId: job.id,
      fileName: `${targetObject}-导入校验报告-${formatDateNo(new Date())}.xlsx`,
      mimeType: spreadsheetMimeType("xlsx"),
      sizeBytes: 8_192,
      uploadScene: "import_validation_report_mock",
      uploadedBy: job.operator ?? "营运端",
      metadata: {
        jobId: job.id,
        templateCode,
        targetObject,
        externalCallSkipped: true
      }
    });

    return {
      externalCallSkipped: true,
      sourceFileAssetId: job.payload.sourceFileAssetId,
      validationReportFileAssetId: reportFile.id,
      passedRows: 12,
      failedRows: 1,
      errors: [
        {
          row: 5,
          field: "示例字段",
          message: "MVP 阶段未解析真实 Excel，此处保留导入校验报告结构。"
        }
      ],
      message: "MVP 阶段仅生成 mock 导入校验报告，不写入业务主数据。"
    };
  }

  private useMysqlDataSource() {
    const value =
      this.configService.get<string>("INFRA_DATA_SOURCE") ??
      this.configService.get<string>("RENTAL_OS_DATA_SOURCE") ??
      "mysql";
    return value.toLowerCase() === "mysql";
  }
}

function defaultNotificationTemplates(): NotificationTemplateSummary[] {
  const now = new Date().toISOString();
  return [
    {
      id: "tpl_order_confirmed",
      code: "order_confirmed",
      name: "订单已确认",
      category: "订单",
      trigger: "订单预授权成功或企业月结创建成功",
      channels: ["APP", "SMS"],
      content: "尊敬的{用户}，您的订单{订单号}已经确认，请按约定时间办理领取。",
      enabled: true,
      updatedAt: now
    },
    {
      id: "tpl_post_charge_notice",
      code: "post_charge_notice",
      name: "完成后追缴通知",
      category: "订单",
      trigger: "订单完成后产生客户自付追缴费用",
      channels: ["APP", "SMS"],
      content: "您的订单{订单号}产生追缴费用{金额}，请及时处理。",
      enabled: true,
      updatedAt: now
    },
    {
      id: "tpl_contract_signature",
      code: "contract_signature",
      name: "租赁合约签署",
      category: "合同",
      trigger: "领取阶段生成租赁合约",
      channels: ["APP"],
      content: "您的租赁合约已生成，请在 APP 内完成签署。",
      enabled: true,
      updatedAt: now
    }
  ];
}

function defaultDataExchangeTemplates(): DataExchangeTemplateSummary[] {
  return [
    {
      templateCode: "fulfillment-locations-import-v1",
      targetModule: "rental-os",
      targetObject: "stations",
      name: "服务站点导入模板",
      operation: "template_download",
      format: "xlsx",
      fields: ["所属履约地点", "地点名称", "服务类型", "车位容量", "营业状态"],
      mockFileName: "服务站点导入模板.xlsx",
      enabled: true,
      nextIntegrationPoint: "接 Excel 模板渲染、字段校验、站点能力校验和导入错误报告。"
    },
    {
      templateCode: "fulfillment-locations-export-v1",
      targetModule: "rental-os",
      targetObject: "stations",
      name: "服务站点导出",
      operation: "export",
      format: "xlsx",
      fields: ["地点编码", "地点名称", "所属履约地点", "服务能力", "车位", "状态"],
      mockFileName: "服务站点导出.xlsx",
      enabled: true,
      nextIntegrationPoint: "接站点 repository 查询、筛选条件快照、导出下载权限和操作审计。"
    },
    {
      templateCode: "vehicles-export-v1",
      targetModule: "rental-os",
      targetObject: "vehicles",
      name: "车辆档案导出",
      operation: "export",
      format: "xlsx",
      fields: ["车牌", "VIN", "车型组", "当前履约地点", "营运状态", "服务类型"],
      mockFileName: "车辆档案导出.xlsx",
      enabled: true,
      nextIntegrationPoint: "接车辆 repository 查询、证照附件引用和批量导入校验。"
    },
    {
      templateCode: "members-export-v1",
      targetModule: "rental-os",
      targetObject: "members",
      name: "个人会员导出",
      operation: "export",
      format: "xlsx",
      fields: ["会员编号", "姓名", "手机号脱敏", "等级", "认证状态", "风控状态"],
      mockFileName: "个人会员导出.xlsx",
      enabled: true,
      nextIntegrationPoint: "接会员 repository 查询、敏感字段脱敏和数据权限过滤。"
    },
    {
      templateCode: "corporates-export-v1",
      targetModule: "rental-os",
      targetObject: "corporates",
      name: "企业客户导出",
      operation: "export",
      format: "xlsx",
      fields: ["企业编号", "企业名称", "结算模式", "授信额度", "账期", "合同状态"],
      mockFileName: "企业客户导出.xlsx",
      enabled: true,
      nextIntegrationPoint: "接企业客户 repository 查询、合同附件关联和账期权限校验。"
    },
    {
      templateCode: "orders-export-v1",
      targetModule: "rental-os",
      targetObject: "orders",
      name: "租赁订单导出",
      operation: "export",
      format: "xlsx",
      fields: ["订单号", "客户", "取件履约地点", "归还履约地点", "主状态", "支付状态", "应收金额"],
      mockFileName: "租赁订单导出.xlsx",
      enabled: true,
      nextIntegrationPoint: "接订单 repository 查询、订单快照、费用汇总和导出任务进度。"
    },
    {
      templateCode: "members-import-validate-v1",
      targetModule: "rental-os",
      targetObject: "members",
      name: "个人会员导入校验",
      operation: "import_validate",
      format: "xlsx",
      fields: ["姓名", "手机号", "证件类型", "证件号", "驾驶证有效期", "标签"],
      mockFileName: "个人会员导入校验报告.xlsx",
      enabled: true,
      nextIntegrationPoint: "接 Excel 解析、证件重复校验、会员风控规则和导入确认写库。"
    }
  ];
}

function buildCapabilityCards(input: {
  adapterLogs: AdapterLogSummary[];
  notificationLogs: NotificationSendLogSummary[];
  printJobs: PrintJobSummary[];
  files: FileAssetSummary[];
}): InfraCapabilityCard[] {
  const specs: Array<Omit<InfraCapabilityCard, "lastCalledAt" | "totalLogs">> = [
    {
      capability: "payment",
      name: "第三方支付",
      provider: "mock-payment-adapter",
      mode: "mock",
      status: "enabled",
      description: "用于客户自付订单的支付、退款和收款预留。",
      nextIntegrationPoint: "替换支付 adapter 的 freeze/capture/refund 实现，并接真实回调验签。"
    },
    {
      capability: "pre_auth",
      name: "预授权",
      provider: "mock-payment-adapter",
      mode: "mock",
      status: "enabled",
      description: "下单预授权、取消扣款、爽约扣款和释放预留。",
      nextIntegrationPoint: "将预授权交易号写入资金记录，接银行/信用卡通道真实状态查询。"
    },
    {
      capability: "sms",
      name: "短信通知",
      provider: "mock-notification-adapter",
      mode: "mock",
      status: "enabled",
      description: "订单确认、追缴、审核结果等短信通知预留。",
      nextIntegrationPoint: "接短信供应商模板 ID、签名、发送回执和失败补发任务。"
    },
    {
      capability: "e_contract",
      name: "电子合同",
      provider: "mock-contract-adapter",
      mode: "reserved",
      status: "enabled",
      description: "取车/还车合约签署通知、状态刷新和纸质合约上传预留。",
      nextIntegrationPoint: "接签署平台模板、签署人身份、回调和已签 PDF 存证。"
    },
    {
      capability: "tbox",
      name: "TBox 车机",
      provider: "mock-tbox-adapter",
      mode: "mock",
      status: "enabled",
      description: "车机入库、绑定、解绑、在线状态和控车指令预留。",
      nextIntegrationPoint: "接车机平台绑定接口、遥测回调、远程开锁/落锁与失败兜底。"
    },
    {
      capability: "ai_dispatch",
      name: "AI 调度分析",
      provider: "mock-ai-dispatch-adapter",
      mode: "mock",
      status: "enabled",
      description: "按 PRD 只做辅助分析和审计，不直接修改订单、车辆或排程。",
      nextIntegrationPoint: "接模型调用、JSON Schema 校验、二次业务校验和 180 天日志清理。"
    },
    {
      capability: "export",
      name: "导入导出",
      provider: "mock-export-adapter",
      mode: "reserved",
      status: "enabled",
      description: "列表导出、模板下载和批量导入预留。",
      nextIntegrationPoint: "接 Excel 生成/解析、导入校验报告和下载链接权限。"
    },
    {
      capability: "print",
      name: "打印单据",
      provider: "mock-print-adapter",
      mode: "mock",
      status: "enabled",
      description: "交车单、还车单、租赁合约和账单打印预留。",
      nextIntegrationPoint: "接模板渲染、PDF 生成、打印队列和历史版本快照。"
    },
    {
      capability: "file",
      name: "文件/附件中心",
      provider: "mock-file-storage-adapter",
      mode: "mock",
      status: "enabled",
      description: "证件、车况照片、企业合同附件和单据文件统一元数据。",
      nextIntegrationPoint: "接对象存储、签名 URL、病毒扫描、访问控制和清理策略。"
    }
  ];

  return specs.map((spec) => {
    const relatedLogs = input.adapterLogs.filter(
      (log) => log.capability === spec.capability || log.provider === spec.provider
    );
    const extraCount =
      spec.capability === "sms"
        ? input.notificationLogs.length
        : spec.capability === "print"
          ? input.printJobs.length
          : spec.capability === "file"
            ? input.files.length
            : 0;
    return {
      ...spec,
      lastCalledAt: relatedLogs[0]?.createdAt,
      totalLogs: relatedLogs.length + extraCount
    };
  });
}

function inferNotificationCapability(
  channels: Array<"APP" | "SMS" | "EMAIL" | string>
): InfraAdapterCapability {
  if (channels.includes("SMS")) {
    return "sms";
  }
  if (channels.includes("EMAIL")) {
    return "email";
  }
  return "app_push";
}

function validateRequired(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(message);
  }
}

function isDataExchangeJob(job: AsyncJobSummary) {
  return (
    job.jobType.startsWith("data_") ||
    typeof job.payload.dataExchangeOperation === "string"
  );
}

function spreadsheetMimeType(format: string) {
  if (format === "csv") {
    return "text/csv";
  }
  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function buildDataExchangeFileName(
  template: DataExchangeTemplateSummary,
  operation: CreateDataExchangeJobRequest["operation"]
) {
  if (operation === "import_validate") {
    return `${template.targetObject}-导入校验报告-${formatDateNo(new Date())}.xlsx`;
  }
  return template.mockFileName;
}

function formatDateNo(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

function shortId() {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}
