/** 公共通知目录、模拟通知和适配日志台账。当前租户沿公共ALS读取，默认内容与操作者标签由宿主提供。 */
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  AdapterLogSummary,
  NotificationSendLogSummary,
  NotificationTemplateSummary,
  SendMockNotificationRequest
} from "@rental-os/platform-contracts/notifications";
import { requireRequestTenantId } from "../../common/request-identity";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";

type AdapterLogInput = Omit<AdapterLogSummary, "id" | "createdAt">;
type NotificationJsonObject = { [key: string]: PlatformJsonValue | undefined };

export interface NotificationLedgerStorage {
  listNotificationTemplates(tenantId: string): PromiseLike<NotificationTemplateSummary[]>;
  listNotificationLogs(tenantId: string): PromiseLike<NotificationSendLogSummary[]>;
  recordNotification(
    input: SendMockNotificationRequest,
    tenantId: string
  ): PromiseLike<NotificationSendLogSummary>;
  listAdapterLogs(tenantId: string): PromiseLike<AdapterLogSummary[]>;
  recordAdapterLog(input: AdapterLogInput, tenantId: string): PromiseLike<AdapterLogSummary>;
}

export interface NotificationLedgerParticipants {
  storage: NotificationLedgerStorage;
  usePersistentStorage(): boolean;
  defaultOperator: string;
  initialTemplates?: readonly NotificationTemplateSummary[];
  initialNotificationLogs?: readonly NotificationSendLogSummary[];
  initialAdapterLogs?: readonly AdapterLogSummary[];
  notificationLogsByTenant?: Map<string, NotificationSendLogSummary[]>;
  adapterLogsByTenant?: Map<string, AdapterLogSummary[]>;
}

interface StoredNotificationTemplate {
  id: string;
  code: string;
  name: string;
  category: string;
  trigger: string;
  channels: PlatformJsonValue;
  content: string;
  enabled: boolean;
  updatedAt: Date;
}

interface StoredNotificationLog {
  id: string;
  templateCode: string | null;
  businessType: string;
  businessId: string | null;
  targetType: string;
  targetName: string | null;
  targetMasked: string | null;
  channels: PlatformJsonValue;
  provider: string;
  status: string;
  sentAt: Date | null;
  createdAt: Date;
  requestJson: PlatformJsonValue;
  responseJson: PlatformJsonValue;
}

interface StoredAdapterLog {
  id: string;
  provider: string;
  capability: string;
  operation: string;
  businessType: string | null;
  businessId: string | null;
  status: string;
  requestJson: PlatformJsonValue;
  responseJson: PlatformJsonValue;
  errorMessage: string | null;
  createdAt: Date;
}

interface NotificationTemplateData {
  name: string;
  category: string;
  trigger: string;
  channels: string[];
  content: string;
  enabled: boolean;
}

export interface NotificationLedgerDataStore {
  notificationTemplate: {
    upsert(query: {
      where: { tenantId_code: { tenantId: string; code: string } };
      update: NotificationTemplateData;
      create: NotificationTemplateData & { id: string; tenantId: string; code: string };
    }): PromiseLike<StoredNotificationTemplate>;
    findMany(query: {
      where: { tenantId: string };
      orderBy: Array<{ category: "asc" } | { code: "asc" }>;
    }): PromiseLike<StoredNotificationTemplate[]>;
  };
  notificationSendLog: {
    findMany(query: {
      where: { tenantId: string };
      orderBy: { createdAt: "desc" };
      take: number;
    }): PromiseLike<StoredNotificationLog[]>;
    create(query: {
      data: {
        id: string;
        tenantId: string;
        templateCode?: string;
        businessType: string;
        businessId?: string;
        targetType: string;
        targetName?: string;
        targetMasked?: string;
        channels: string[];
        provider: string;
        status: string;
        requestJson: NotificationJsonObject;
        responseJson: NotificationJsonObject;
        sentAt: Date;
      };
    }): PromiseLike<StoredNotificationLog>;
  };
  externalAdapterLog: {
    findMany(query: {
      where: { tenantId: string };
      orderBy: { createdAt: "desc" };
      take: number;
    }): PromiseLike<StoredAdapterLog[]>;
    create(query: {
      data: {
        id: string;
        tenantId: string;
        provider: string;
        capability: string;
        operation: string;
        businessType?: string;
        businessId?: string;
        status: string;
        requestJson: NotificationJsonObject;
        responseJson?: NotificationJsonObject;
        errorMessage?: string;
      };
    }): PromiseLike<StoredAdapterLog>;
  };
}

export interface NotificationLedgerRepositoryOptions {
  defaultTemplates(tenantId: string): readonly NotificationTemplateSummary[];
  defaultOperator: string;
}

const MOCK_NOTIFICATION_MESSAGE = "MVP 阶段未调用真实短信、邮件或 APP 推送。";

export class NotificationLedgerApplication {
  private readonly notificationLogsByTenant: Map<string, NotificationSendLogSummary[]>;
  private readonly adapterLogsByTenant: Map<string, AdapterLogSummary[]>;

  constructor(private readonly participants: NotificationLedgerParticipants) {
    this.notificationLogsByTenant =
      participants.notificationLogsByTenant ?? new Map<string, NotificationSendLogSummary[]>();
    this.adapterLogsByTenant =
      participants.adapterLogsByTenant ?? new Map<string, AdapterLogSummary[]>();
  }

  async listNotificationTemplates() {
    if (this.participants.usePersistentStorage()) {
      return this.participants.storage.listNotificationTemplates(requireRequestTenantId());
    }
    return [...(this.participants.initialTemplates ?? [])];
  }

  async listNotificationLogs() {
    if (this.participants.usePersistentStorage()) {
      return this.participants.storage.listNotificationLogs(requireRequestTenantId());
    }
    return [...this.memoryNotificationLogsForTenant(requireRequestTenantId())];
  }

  async sendMockNotification(input: SendMockNotificationRequest) {
    if (!input.channels?.length) {
      throw new BadRequestException("至少选择一个通知渠道");
    }
    if (
      process.env.NODE_ENV === "production" &&
      input.channels.some((channel) => String(channel).toUpperCase() === "SMS")
    ) {
      throw new ServiceUnavailableException(
        "生产环境禁止通过模拟入口记录短信发送，请使用已验证的租户短信平台"
      );
    }
    if (typeof input.businessType !== "string" || !input.businessType.trim()) {
      throw new BadRequestException("业务对象类型不能为空");
    }

    const log = this.participants.usePersistentStorage()
      ? await this.participants.storage.recordNotification(input, requireRequestTenantId())
      : this.createMemoryNotificationLog(input);

    // 原通知登记与适配日志分步写入，日志失败继续传播，已登记的通知事实仍在原台账中。
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
        message: MOCK_NOTIFICATION_MESSAGE
      }
    });
    return log;
  }

  async listAdapterLogs() {
    if (this.participants.usePersistentStorage()) {
      return this.participants.storage.listAdapterLogs(requireRequestTenantId());
    }
    return [...this.memoryAdapterLogsForTenant(requireRequestTenantId())];
  }

  async recordAdapterLog(input: AdapterLogInput) {
    if (this.participants.usePersistentStorage()) {
      return this.participants.storage.recordAdapterLog(input, requireRequestTenantId());
    }
    const row: AdapterLogSummary = {
      id: `adapter_${shortId()}`,
      createdAt: new Date().toISOString(),
      ...input
    };
    this.memoryAdapterLogsForTenant(requireRequestTenantId()).unshift(row);
    return row;
  }

  private createMemoryNotificationLog(input: SendMockNotificationRequest) {
    const tenantId = requireRequestTenantId();
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
      requestJson: notificationRequestJson(input, this.participants.defaultOperator),
      responseJson: { externalCallSkipped: true, message: MOCK_NOTIFICATION_MESSAGE }
    };
    this.memoryNotificationLogsForTenant(tenantId).unshift(row);
    return row;
  }

  private memoryNotificationLogsForTenant(tenantId: string) {
    const existing = this.notificationLogsByTenant.get(tenantId);
    if (existing) return existing;
    const seeded = (this.participants.initialNotificationLogs ?? []).map((item) => ({
      ...item,
      id: `${item.id}_${tenantId}`
    }));
    this.notificationLogsByTenant.set(tenantId, seeded);
    return seeded;
  }

  private memoryAdapterLogsForTenant(tenantId: string) {
    const existing = this.adapterLogsByTenant.get(tenantId);
    if (existing) return existing;
    const seeded = (this.participants.initialAdapterLogs ?? []).map((item) => ({
      ...item,
      id: `${item.id}_${tenantId}`
    }));
    this.adapterLogsByTenant.set(tenantId, seeded);
    return seeded;
  }
}

/** 原通知与适配日志字段、排序及JSON投影的持久实现，默认模板由所属宿主按当前租户供给。 */
export class NotificationLedgerRepository {
  constructor(
    private readonly database: NotificationLedgerDataStore,
    private readonly options: NotificationLedgerRepositoryOptions
  ) {}

  async ensureDefaultNotificationTemplates(tenantId: string) {
    requireLedgerTenant(tenantId);
    const templates = this.options.defaultTemplates(tenantId);
    await Promise.all(
      templates.map((template) =>
        this.database.notificationTemplate.upsert({
          where: { tenantId_code: { tenantId, code: template.code } },
          update: {
            name: template.name,
            category: template.category,
            trigger: template.trigger,
            channels: template.channels,
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
            channels: template.channels,
            content: template.content,
            enabled: template.enabled
          }
        })
      )
    );
  }

  async listNotificationTemplates(tenantId: string): Promise<NotificationTemplateSummary[]> {
    await this.ensureDefaultNotificationTemplates(tenantId);
    const rows = await this.database.notificationTemplate.findMany({
      where: { tenantId },
      orderBy: [{ category: "asc" }, { code: "asc" }]
    });
    return rows.map(toNotificationTemplateSummary);
  }

  async listNotificationLogs(tenantId: string): Promise<NotificationSendLogSummary[]> {
    requireLedgerTenant(tenantId);
    const rows = await this.database.notificationSendLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 80
    });
    return rows.map(toNotificationLogSummary);
  }

  async recordNotification(
    input: SendMockNotificationRequest,
    tenantId: string
  ): Promise<NotificationSendLogSummary> {
    requireLedgerTenant(tenantId);
    const now = new Date();
    const row = await this.database.notificationSendLog.create({
      data: {
        id: `notify_${cryptoRandomId()}`,
        tenantId,
        templateCode: input.templateCode,
        businessType: input.businessType,
        businessId: input.businessId,
        targetType: input.targetType,
        targetName: input.targetName,
        targetMasked: input.targetMasked,
        channels: input.channels,
        provider: "mock-notification-adapter",
        status: "mock_success",
        requestJson: notificationRequestJson(input, this.options.defaultOperator),
        responseJson: { externalCallSkipped: true, message: MOCK_NOTIFICATION_MESSAGE },
        sentAt: now
      }
    });
    return toNotificationLogSummary(row);
  }

  async listAdapterLogs(tenantId: string): Promise<AdapterLogSummary[]> {
    requireLedgerTenant(tenantId);
    const rows = await this.database.externalAdapterLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 120
    });
    return rows.map(toAdapterLogSummary);
  }

  async recordAdapterLog(input: AdapterLogInput, tenantId: string): Promise<AdapterLogSummary> {
    requireLedgerTenant(tenantId);
    const row = await this.database.externalAdapterLog.create({
      data: {
        id: `adapter_${cryptoRandomId()}`,
        tenantId,
        provider: input.provider,
        capability: input.capability,
        operation: input.operation,
        businessType: input.businessType,
        businessId: input.businessId,
        status: input.status,
        requestJson: input.requestJson as NotificationJsonObject,
        responseJson: input.responseJson as NotificationJsonObject | undefined,
        errorMessage: input.errorMessage
      }
    });
    return toAdapterLogSummary(row);
  }
}

function notificationRequestJson(
  input: SendMockNotificationRequest,
  defaultOperator: string
): NotificationJsonObject {
  return {
    templateCode: input.templateCode,
    variables: input.variables ?? {},
    operator: input.operator ?? defaultOperator
  };
}

function toNotificationTemplateSummary(
  row: StoredNotificationTemplate
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

function toNotificationLogSummary(row: StoredNotificationLog): NotificationSendLogSummary {
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

function toAdapterLogSummary(row: StoredAdapterLog): AdapterLogSummary {
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

function recordValue(value: PlatformJsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: PlatformJsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function inferNotificationCapability(channels: SendMockNotificationRequest["channels"]): string {
  if (channels.includes("SMS")) {
    return "sms";
  }
  if (channels.includes("EMAIL")) {
    return "email";
  }
  return "app_push";
}

function shortId() {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 10);
}

function requireLedgerTenant(tenantId: string) {
  if (!tenantId) throw new BadRequestException("通知台账缺少当前租户");
}
