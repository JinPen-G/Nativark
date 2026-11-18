/** 原集成数据适配。文件、通知、适配日志及作业消费公共存储，原业务场景由宿主裁定。 */
import { FileStorageRepository, createSimulationFileAsset } from "@rental-os/platform-server/files";
import { JobLedgerRepository } from "@rental-os/platform-server/jobs";
import { NotificationLedgerRepository } from "@rental-os/platform-server/notifications";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
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
  private readonly files: FileStorageRepository;
  private readonly notifications: NotificationLedgerRepository;
  private readonly jobs: JobLedgerRepository;
  constructor(private readonly prisma: PrismaService) {
    this.files = new FileStorageRepository(prisma);
    this.jobs = new JobLedgerRepository(prisma);
    this.notifications = new NotificationLedgerRepository(prisma, {
      defaultTemplates: defaultNotificationTemplates,
      defaultOperator: "营运端"
    });
  }

  async ensureDefaultNotificationTemplates(tenantId = requireRequestTenantId()) {
    return this.notifications.ensureDefaultNotificationTemplates(tenantId);
  }

  async listFiles(tenantId = requireRequestTenantId(), query: FileAssetQuery = {}): Promise<FileAssetSummary[]> {
    return this.files.listFiles(tenantId, query, RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE);
  }

  async createFile(
    input: CreateFileAssetRequest,
    tenantId = requireRequestTenantId()
  ): Promise<FileAssetSummary> {
    if (input.uploadScene?.trim() === RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE) throw new BadRequestException("不能直接登记专用换货影像");
    return createSimulationFileAsset(this.prisma, input, tenantId);
  }

  async listNotificationTemplates(tenantId = requireRequestTenantId()): Promise<NotificationTemplateSummary[]> {
    return this.notifications.listNotificationTemplates(tenantId);
  }

  async listNotificationLogs(tenantId = requireRequestTenantId()): Promise<NotificationSendLogSummary[]> {
    return this.notifications.listNotificationLogs(tenantId);
  }

  async recordNotification(input: SendMockNotificationRequest, tenantId = requireRequestTenantId()): Promise<NotificationSendLogSummary> {
    return this.notifications.recordNotification(input, tenantId);
  }

  async listAdapterLogs(tenantId = requireRequestTenantId()): Promise<AdapterLogSummary[]> {
    return this.notifications.listAdapterLogs(tenantId);
  }

  async recordAdapterLog(input: Omit<AdapterLogSummary, "id" | "createdAt">, tenantId = requireRequestTenantId()): Promise<AdapterLogSummary> {
    return this.notifications.recordAdapterLog(input, tenantId);
  }

  async listJobs(tenantId = requireRequestTenantId()): Promise<AsyncJobSummary[]> {
    return this.jobs.listJobs(tenantId);
  }

  async getJob(
    id: string,
    tenantId = requireRequestTenantId()
  ): Promise<AsyncJobSummary | undefined> {
    return this.jobs.getJob(id, tenantId);
  }

  async createJob(
    input: CreateAsyncJobRequest,
    tenantId = requireRequestTenantId()
  ): Promise<AsyncJobSummary> {
    return this.jobs.createJob(input, tenantId);
  }

  async finishJob(
    id: string,
    result: Record<string, unknown>,
    tenantId = requireRequestTenantId()
  ): Promise<AsyncJobSummary> {
    return this.jobs.finishJob(id, result, tenantId);
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

function defaultNotificationTemplates(tenantId: string): NotificationTemplateSummary[] {
  const now = new Date().toISOString();
  // 新模板按租户派生主键。更新通过 tenantId/code 定位已有模板，避免多个租户初始化时争用全局固定 ID。
  const tenantSuffix = createHash("sha256").update(tenantId).digest("hex");
  return [
    {
      id: `tpl_order_confirmed_${tenantSuffix}`,
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
      id: `tpl_post_charge_notice_${tenantSuffix}`,
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
      id: `tpl_contract_signature_${tenantSuffix}`,
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

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 10);
}
