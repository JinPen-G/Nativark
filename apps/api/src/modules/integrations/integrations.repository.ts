import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE } from "@rental-os/shared";
import { Prisma } from "@prisma/client";
import type {
  AdapterLogSummary,
  AsyncJobSummary,
  CreateAsyncJobRequest,
  CreateFileAssetRequest,
  CreatePrintJobRequest,
  FileAssetQuery,
  FileAssetSummary,
  NotificationSendLogSummary,
  NotificationTemplateSummary,
  PrintJobSummary,
  SaveTBoxDeviceRequest,
  SendMockNotificationRequest,
  TBoxDeviceSummary
} from "@rental-os/shared";
import { requireRequestTenantId } from "../../common/request-identity";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class IntegrationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaultNotificationTemplates(tenantId = requireRequestTenantId()) {
    const templates = defaultNotificationTemplates();
    await Promise.all(
      templates.map((template) =>
        this.prisma.notificationTemplate.upsert({
          where: {
            tenantId_code: {
              tenantId,
              code: template.code
            }
          },
          update: {
            name: template.name,
            category: template.category,
            trigger: template.trigger,
            channels: template.channels as Prisma.InputJsonValue,
            content: template.content,
            enabled: template.enabled
          },
          create: {
            id: template.id,
            tenantId,
            code: template.code,
            name: template.name,
            category: template.category,
            trigger: template.trigger,
            channels: template.channels as Prisma.InputJsonValue,
            content: template.content,
            enabled: template.enabled
          }
        })
      )
    );
  }

  async listFiles(
    tenantId = requireRequestTenantId(),
    query: FileAssetQuery = {}
  ): Promise<FileAssetSummary[]> {
    const where: Prisma.FileAssetWhereInput = {
      tenantId,
      businessModule: query.businessModule,
      businessType: query.businessType,
      businessId: query.businessId,
      uploadScene: query.uploadScene,
      status: query.status,
      NOT: { uploadScene: RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE }
    };
    const limit = Math.min(Math.max(Number(query.limit ?? 80), 1), 200);
    const rows = await this.prisma.fileAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return rows.map(toFileAssetSummary);
  }

  async createFile(
    input: CreateFileAssetRequest,
    tenantId = requireRequestTenantId()
  ): Promise<FileAssetSummary> {
    if (input.uploadScene?.trim() === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new BadRequestException("不能直接登记专用换货影像");
    const fileId = `file_${cryptoRandomId()}`;
    const fileExt = input.fileName.includes(".")
      ? input.fileName.split(".").pop()
      : undefined;
    const row = await this.prisma.fileAsset.create({
      data: {
        id: fileId,
        tenantId,
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
        checksum: `mock-sha256-${cryptoRandomId()}`,
        uploadScene: input.uploadScene,
        uploadedBy: input.uploadedBy,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
    return toFileAssetSummary(row);
  }

  async listNotificationTemplates(
    tenantId = requireRequestTenantId()
  ): Promise<NotificationTemplateSummary[]> {
    await this.ensureDefaultNotificationTemplates(tenantId);
    const rows = await this.prisma.notificationTemplate.findMany({
      where: { tenantId },
      orderBy: [{ category: "asc" }, { code: "asc" }]
    });
    return rows.map(toNotificationTemplateSummary);
  }

  async listNotificationLogs(
    tenantId = requireRequestTenantId()
  ): Promise<NotificationSendLogSummary[]> {
    const rows = await this.prisma.notificationSendLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 80
    });
    return rows.map(toNotificationLogSummary);
  }

  async recordNotification(
    input: SendMockNotificationRequest,
    tenantId = requireRequestTenantId()
  ): Promise<NotificationSendLogSummary> {
    const now = new Date();
    const row = await this.prisma.notificationSendLog.create({
      data: {
        id: `notify_${cryptoRandomId()}`,
        tenantId,
        templateCode: input.templateCode,
        businessType: input.businessType,
        businessId: input.businessId,
        targetType: input.targetType,
        targetName: input.targetName,
        targetMasked: input.targetMasked,
        channels: input.channels as Prisma.InputJsonValue,
        provider: "mock-notification-adapter",
        status: "mock_success",
        requestJson: {
          templateCode: input.templateCode,
          variables: input.variables ?? {},
          operator: input.operator ?? "营运端"
        },
        responseJson: {
          externalCallSkipped: true,
          message: "MVP 阶段未调用真实短信、邮件或 APP 推送。"
        },
        sentAt: now
      }
    });
    return toNotificationLogSummary(row);
  }

  async listAdapterLogs(
    tenantId = requireRequestTenantId()
  ): Promise<AdapterLogSummary[]> {
    const rows = await this.prisma.externalAdapterLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 120
    });
    return rows.map(toAdapterLogSummary);
  }

  async recordAdapterLog(
    input: Omit<AdapterLogSummary, "id" | "createdAt">,
    tenantId = requireRequestTenantId()
  ): Promise<AdapterLogSummary> {
    const row = await this.prisma.externalAdapterLog.create({
      data: {
        id: `adapter_${cryptoRandomId()}`,
        tenantId,
        provider: input.provider,
        capability: input.capability,
        operation: input.operation,
        businessType: input.businessType,
        businessId: input.businessId,
        status: input.status,
        requestJson: input.requestJson as Prisma.InputJsonValue,
        responseJson: input.responseJson as Prisma.InputJsonValue | undefined,
        errorMessage: input.errorMessage
      }
    });
    return toAdapterLogSummary(row);
  }

  async listJobs(tenantId = requireRequestTenantId()): Promise<AsyncJobSummary[]> {
    const rows = await this.prisma.asyncJob.findMany({
      where: { tenantId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 80
    });
    return rows.map(toAsyncJobSummary);
  }

  async getJob(
    id: string,
    tenantId = requireRequestTenantId()
  ): Promise<AsyncJobSummary | undefined> {
    const row = await this.prisma.asyncJob.findFirst({ where: { id, tenantId } });
    return row ? toAsyncJobSummary(row) : undefined;
  }

  async createJob(
    input: CreateAsyncJobRequest,
    tenantId = requireRequestTenantId()
  ): Promise<AsyncJobSummary> {
    const row = await this.prisma.asyncJob.create({
      data: {
        id: `job_${cryptoRandomId()}`,
        tenantId,
        jobType: input.jobType,
        businessType: input.businessType,
        businessId: input.businessId,
        status: "queued",
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : new Date(),
        operator: input.operator,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue
      }
    });
    return toAsyncJobSummary(row);
  }

  async finishJob(
    id: string,
    result: Record<string, unknown>,
    tenantId = requireRequestTenantId()
  ): Promise<AsyncJobSummary> {
    const existing = await this.prisma.asyncJob.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException(`Job ${id} was not found`);
    }
    const now = new Date();
    const row = await this.prisma.asyncJob.update({
      where: { id },
      data: {
        status: "success",
        attempt: { increment: 1 },
        startedAt: existing.startedAt ?? now,
        finishedAt: now,
        result: result as Prisma.InputJsonValue
      }
    });
    return toAsyncJobSummary(row);
  }

  async listPrintJobs(tenantId = requireRequestTenantId()): Promise<PrintJobSummary[]> {
    const rows = await this.prisma.documentPrintJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 80
    });
    return rows.map(toPrintJobSummary);
  }

  async createPrintJob(
    input: CreatePrintJobRequest,
    fileAssetId: string | undefined,
    documentNo: string,
    tenantId = requireRequestTenantId()
  ): Promise<PrintJobSummary> {
    const row = await this.prisma.documentPrintJob.create({
      data: {
        id: `print_${cryptoRandomId()}`,
        tenantId,
        documentNo,
        documentType: input.documentType,
        templateCode: input.templateCode,
        businessType: input.businessType,
        businessId: input.businessId,
        status: "mock_generated",
        fileAssetId,
        operator: input.operator,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        result: {
          externalCallSkipped: true,
          fileAssetId,
          message: "MVP 阶段仅生成 mock 单据记录，不渲染真实 PDF。"
        }
      }
    });
    return toPrintJobSummary(row);
  }

  async listTBoxDevices(
    tenantId = requireRequestTenantId()
  ): Promise<TBoxDeviceSummary[]> {
    const rows = await this.prisma.tBoxDevice.findMany({
      where: { tenantId },
      orderBy: [{ status: "asc" }, { cid: "asc" }]
    });
    return rows.map(toTBoxDeviceSummary);
  }

  async saveTBoxDevice(
    input: SaveTBoxDeviceRequest,
    tenantId = requireRequestTenantId()
  ): Promise<TBoxDeviceSummary> {
    const id = input.id ?? `tbox_${cryptoRandomId()}`;
    if (input.id) {
      const existing = await this.prisma.tBoxDevice.findFirst({ where: { id, tenantId } });
      if (!existing) {
        throw new NotFoundException(`TBox device ${id} was not found`);
      }
    }
    const data = {
      cid: input.cid,
      simNo: input.simNo,
      model: input.model,
      status: input.status ?? "unbound",
      firmwareVersion: input.firmwareVersion,
      appVersion: input.appVersion,
      warrantyExpireAt: input.warrantyExpireAt ? new Date(input.warrantyExpireAt) : undefined,
      supportsIButton: Boolean(input.supportsIButton),
      iButtonCode: input.iButtonCode
    };
    const row = input.id
      ? await this.prisma.tBoxDevice.update({ where: { id }, data })
      : await this.prisma.tBoxDevice.create({
          data: {
            id,
            tenantId,
            ...data,
            telemetry: {}
          }
        });
    return toTBoxDeviceSummary(row);
  }

  async bindTBoxDevice(
    id: string,
    input: { vehicleId?: string; plateNo?: string; vehicleModel?: string },
    tenantId = requireRequestTenantId()
  ): Promise<TBoxDeviceSummary> {
    const existing = await this.prisma.tBoxDevice.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException(`TBox device ${id} was not found`);
    }
    const row = await this.prisma.tBoxDevice.update({
      where: { id },
      data: {
        status: input.plateNo ? "bound" : "unbound",
        boundVehicleId: input.vehicleId,
        boundPlateNo: input.plateNo,
        vehicleModel: input.vehicleModel,
        lastHeartbeatAt: input.plateNo ? new Date() : existing.lastHeartbeatAt
      }
    });
    return toTBoxDeviceSummary(row);
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

function toFileAssetSummary(
  row: Prisma.FileAssetGetPayload<Record<string, never>>
): FileAssetSummary {
  return {
    id: row.id,
    businessModule: row.businessModule,
    businessType: row.businessType,
    businessId: row.businessId ?? undefined,
    fileName: row.fileName,
    fileExt: row.fileExt ?? undefined,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storageProvider: row.storageProvider,
    uploadScene: row.uploadScene,
    status: row.status,
    uploadedBy: row.uploadedBy ?? undefined,
    createdAt: row.createdAt.toISOString()
  };
}

function toNotificationTemplateSummary(
  row: Prisma.NotificationTemplateGetPayload<Record<string, never>>
): NotificationTemplateSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    trigger: row.trigger,
    channels: stringArray(row.channels),
    content: row.content,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString()
  };
}

function toNotificationLogSummary(
  row: Prisma.NotificationSendLogGetPayload<Record<string, never>>
): NotificationSendLogSummary {
  return {
    id: row.id,
    templateCode: row.templateCode ?? undefined,
    businessType: row.businessType,
    businessId: row.businessId ?? undefined,
    targetType: row.targetType,
    targetName: row.targetName ?? undefined,
    targetMasked: row.targetMasked ?? undefined,
    channels: stringArray(row.channels),
    provider: row.provider,
    status: row.status,
    sentAt: row.sentAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    requestJson: recordValue(row.requestJson),
    responseJson: row.responseJson ? recordValue(row.responseJson) : undefined
  };
}

function toAdapterLogSummary(
  row: Prisma.ExternalAdapterLogGetPayload<Record<string, never>>
): AdapterLogSummary {
  return {
    id: row.id,
    provider: row.provider,
    capability: row.capability,
    operation: row.operation,
    businessType: row.businessType ?? undefined,
    businessId: row.businessId ?? undefined,
    status: row.status,
    requestJson: recordValue(row.requestJson),
    responseJson: row.responseJson ? recordValue(row.responseJson) : undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt.toISOString()
  };
}

function toAsyncJobSummary(
  row: Prisma.AsyncJobGetPayload<Record<string, never>>
): AsyncJobSummary {
  return {
    id: row.id,
    jobType: row.jobType,
    businessType: row.businessType ?? undefined,
    businessId: row.businessId ?? undefined,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    scheduledAt: row.scheduledAt?.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    operator: row.operator ?? undefined,
    payload: recordValue(row.payload),
    result: row.result ? recordValue(row.result) : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toPrintJobSummary(
  row: Prisma.DocumentPrintJobGetPayload<Record<string, never>>
): PrintJobSummary {
  return {
    id: row.id,
    documentNo: row.documentNo,
    documentType: row.documentType,
    templateCode: row.templateCode,
    businessType: row.businessType,
    businessId: row.businessId ?? undefined,
    status: row.status,
    fileAssetId: row.fileAssetId ?? undefined,
    operator: row.operator ?? undefined,
    payload: recordValue(row.payload),
    result: row.result ? recordValue(row.result) : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toTBoxDeviceSummary(
  row: Prisma.TBoxDeviceGetPayload<Record<string, never>>
): TBoxDeviceSummary {
  return {
    id: row.id,
    cid: row.cid,
    simNo: row.simNo ?? undefined,
    model: row.model,
    status: row.status,
    boundVehicleId: row.boundVehicleId ?? undefined,
    boundPlateNo: row.boundPlateNo ?? undefined,
    vehicleModel: row.vehicleModel ?? undefined,
    firmwareVersion: row.firmwareVersion ?? undefined,
    appVersion: row.appVersion ?? undefined,
    warrantyExpireAt: row.warrantyExpireAt?.toISOString().slice(0, 10),
    supportsIButton: row.supportsIButton,
    iButtonCode: row.iButtonCode ?? undefined,
    powerOnAt: row.powerOnAt?.toISOString(),
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString(),
    telemetry: row.telemetry ? recordValue(row.telemetry) : undefined,
    updatedAt: row.updatedAt.toISOString()
  };
}

function recordValue(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 10);
}
