import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  findTenantIntegrationProvider,
  TENANT_INTEGRATION_PROVIDERS,
  type SaveTenantIntegrationRequest,
  type SystemUserRow,
  type TenantIntegrationCapability,
  type TenantIntegrationCatalogResponse,
  type TenantIntegrationConfigSummary,
  type TenantIntegrationProvider,
  type TenantIntegrationTestStatus
} from "@rental-os/shared";
import { OperationLogService } from "../../common/operation-log.service";
import { UnsafeOutboundUrlError, validateProviderOutboundUrls } from "../../common/outbound-url";
import { requireRequestTenantId } from "../../common/request-identity";
import { SecretBox } from "../../common/secret-box";
import { PrismaService } from "../database/prisma.service";

type IntegrationRow = Prisma.TenantIntegrationConfigGetPayload<object>;

export interface TenantIntegrationRuntimeConfig {
  id: string;
  capability: TenantIntegrationCapability;
  provider: TenantIntegrationProvider;
  settings: Record<string, unknown>;
  credentials: Record<string, string>;
}

export interface TenantIntegrationRuntimeOptions {
  /**
   * 新的外部业务调用默认要求最近一次配置已经通过 live 连通性测试。
   * 既有事实的查单、回执、上传完成和清理可显式关闭此要求，避免恢复链被测试状态阻断。
   */
  requireLiveTest?: boolean;
  /** 新建外部业务事实时要求该平台仍是租户当前明确选择的默认出口。 */
  requireDefault?: boolean;
}

export interface TenantIntegrationTestConfig extends TenantIntegrationRuntimeConfig {
  tenantId: string;
  missingFields: string[];
  configurationError?: string;
  lastTestAt?: Date;
}

@Injectable()
export class TenantIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBox,
    private readonly operationLog: OperationLogService
  ) {}

  private definition(capability: TenantIntegrationCapability, provider: TenantIntegrationProvider) {
    const value = findTenantIntegrationProvider(capability, provider);
    if (!value) throw new BadRequestException("该能力不支持此平台提供方");
    return value;
  }

  private jsonObject(value: unknown, message: string) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(message);
    return value as Record<string, unknown>;
  }

  private configuredSecrets(row: IntegrationRow | undefined) {
    if (!row?.credentialsEncrypted) return {} as Record<string, string>;
    try {
      return this.secretBox.decrypt(row.credentialsEncrypted);
    } catch {
      return {} as Record<string, string>;
    }
  }

  private summary(row: IntegrationRow): TenantIntegrationConfigSummary {
    const secretFields = Array.isArray(row.secretFields)
      ? row.secretFields.filter((item): item is string => typeof item === "string")
      : [];
    const decrypted = this.configuredSecrets(row);
    return {
      id: row.id,
      capability: row.capability as TenantIntegrationCapability,
      provider: row.provider as TenantIntegrationProvider,
      enabled: row.enabled,
      isDefault: row.isDefault,
      settings: (row.settings ?? {}) as Record<string, unknown>,
      secrets: {
        configured: secretFields.length > 0 && secretFields.every((key) => Boolean(decrypted[key])),
        fields: secretFields
      },
      lastTestStatus: row.lastTestStatus as TenantIntegrationConfigSummary["lastTestStatus"],
      lastTestMode: row.lastTestMode as TenantIntegrationConfigSummary["lastTestMode"],
      lastTestAt: row.lastTestAt?.toISOString(),
      lastTestError: row.lastTestError ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  async catalog(tenantId = requireRequestTenantId()): Promise<TenantIntegrationCatalogResponse> {
    const configs = await this.prisma.tenantIntegrationConfig.findMany({
      where: { tenantId },
      orderBy: [{ capability: "asc" }, { provider: "asc" }]
    });
    return { providers: TENANT_INTEGRATION_PROVIDERS, configs: configs.map((row) => this.summary(row)) };
  }

  /**
   * 仅供服务端 adapter 使用。该方法永远不从 controller 暴露 credentials，
   * 也不把未启用或非默认的配置带入业务运行链。
   */
  async runtimeConfig(
    capability: TenantIntegrationCapability,
    tenantId = requireRequestTenantId(),
    provider?: TenantIntegrationProvider,
    options: TenantIntegrationRuntimeOptions = {}
  ): Promise<TenantIntegrationRuntimeConfig | undefined> {
    const row = await this.prisma.tenantIntegrationConfig.findFirst({
      where: {
        tenantId,
        capability,
        enabled: true,
        ...(provider ? { provider, ...(options.requireDefault ? { isDefault: true } : {}) } : { isDefault: true })
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });
    if (!row) return undefined;
    const definition = this.definition(capability, row.provider as TenantIntegrationProvider);
    const credentials = this.configuredSecrets(row);
    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const missing = definition.fields
      .filter((field) => field.required && !String((field.secret ? credentials[field.key] : settings[field.key]) ?? "").trim())
      .map((field) => field.key);
    if (missing.length > 0) throw new ServiceUnavailableException(`默认${capability}平台配置不完整：${missing.join("、")}`);
    try {
      await validateProviderOutboundUrls(capability, row.provider, settings);
    } catch (error) {
      const message = error instanceof UnsafeOutboundUrlError ? error.message : "第三方平台地址无法安全使用";
      throw new ServiceUnavailableException(message);
    }
    if (options.requireLiveTest !== false && (row.lastTestStatus !== "passed" || row.lastTestMode !== "live")) {
      throw new ServiceUnavailableException(`默认${capability}平台尚未通过真实连接测试，请先完成连接测试`);
    }
    return {
      id: row.id,
      capability,
      provider: row.provider as TenantIntegrationProvider,
      settings,
      credentials
    };
  }

  /**
   * 在创建支付单、上传会话等“进行中事实”前锁住配置行，并重新确认平台仍启用。
   *
   * 运行时配置通常会先在事务外读取，停用配置则在自己的事务里检查进行中事实。
   * 如果两边没有共同的锁点，就会出现“停用检查通过后又插入进行中事实”的竞态。
   * 所有会改变外部平台生命周期的创建事务都必须调用本方法；不存在或已停用时
   * 直接失败，不能使用事务外读到的旧配置继续写入。
   */
  async assertEnabledInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    capability: TenantIntegrationCapability,
    provider: TenantIntegrationProvider,
    options: TenantIntegrationRuntimeOptions = {}
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string; enabled: boolean | number | string; isDefault: boolean | number | string; lastTestStatus: string; lastTestMode: string }>>(Prisma.sql`
      SELECT id, enabled, isDefault, lastTestStatus, lastTestMode
        FROM tenant_integration_configs
       WHERE tenantId = ${tenantId}
         AND capability = ${capability}
         AND provider = ${provider}
         ${options.requireDefault ? Prisma.sql`AND isDefault = 1` : Prisma.empty}
       FOR UPDATE
    `);
    const row = rows[0];
    const enabled = row?.enabled === true || row?.enabled === 1 || row?.enabled === "1";
    if (!row || !enabled) {
      throw new ServiceUnavailableException("该第三方平台已停用或配置不存在，请稍后重试");
    }
    if (options.requireDefault && !(row.isDefault === true || row.isDefault === 1 || row.isDefault === "1")) {
      throw new ServiceUnavailableException("该第三方平台已不再是当前默认平台，请刷新后重试");
    }
    if (options.requireLiveTest !== false && (row.lastTestStatus !== "passed" || row.lastTestMode !== "live")) {
      throw new ServiceUnavailableException("该第三方平台尚未通过真实连接测试，请先完成连接测试");
    }
  }

  /**
   * 第三方回调没有租户路径，不能信任请求体里的 tenantId。
   * 回调适配器只能从已启用的对应提供方配置中匹配商户标识/证书，
   * 这里返回完整配置但绝不经过 controller。
   */
  async runtimeConfigsForCallback(provider: TenantIntegrationProvider): Promise<Array<TenantIntegrationRuntimeConfig & { tenantId: string }>> {
    // 与创建路径同一门槛：只有通过真实连接测试的配置才可能发起过支付，
    // 因此也只有它们的回调值得验签。保存配置会重置测试状态，此后旧支付单的
    // 回调将不再匹配，由查单补偿（requireLiveTest: false）恢复。
    const rows = await this.prisma.tenantIntegrationConfig.findMany({
      where: { capability: "payment", provider, enabled: true, lastTestStatus: "passed", lastTestMode: "live" },
      orderBy: { updatedAt: "desc" }
    });
    const result: Array<TenantIntegrationRuntimeConfig & { tenantId: string }> = [];
    for (const row of rows) {
      const definition = this.definition("payment", provider);
      const credentials = this.configuredSecrets(row);
      const settings = (row.settings ?? {}) as Record<string, unknown>;
      const missing = definition.fields
        .filter((field) => field.required && !String((field.secret ? credentials[field.key] : settings[field.key]) ?? "").trim())
        .map((field) => field.key);
      if (missing.length > 0) continue;
      // 回调路径只需要商户标识和验签材料，不会向 gateway/notifyUrl 发起请求。
      // 不在公开回调上为所有租户逐个做 DNS 解析，避免被伪造回调放大为
      // 大量外部 DNS 查询；真正发起支付请求的 runtimeConfig 仍会做完整出站校验。
      result.push({
        tenantId: row.tenantId,
        id: row.id,
        capability: "payment" as const,
        provider,
        settings,
        credentials
      });
    }
    return result;
  }

  async save(
    capability: TenantIntegrationCapability,
    provider: TenantIntegrationProvider,
    input: SaveTenantIntegrationRequest,
    user?: SystemUserRow
  ) {
    const tenantId = user?.tenantId ?? requireRequestTenantId();
    if (user?.isSaasAdmin) throw new BadRequestException("SaaS 平台账号不能写入租户自有第三方配置");
    const definition = this.definition(capability, provider);
    if (!input.enabled && input.isDefault) throw new BadRequestException("停用的平台不能设为默认平台");
    const settings = this.jsonObject(input.settings, "平台配置参数必须是对象");
    const credentials = input.credentials ? this.jsonObject(input.credentials, "平台密钥必须是对象") : {};
    const settingKeys = new Set(definition.fields.filter((field) => !field.secret).map((field) => field.key));
    const secretKeys = new Set(definition.fields.filter((field) => field.secret).map((field) => field.key));
    for (const key of Object.keys(settings)) {
      if (!settingKeys.has(key)) throw new BadRequestException(`不支持的配置参数：${key}`);
      const value = settings[key];
      if (value !== undefined && value !== null && typeof value !== "string" && typeof value !== "boolean" && typeof value !== "number") {
        throw new BadRequestException(`配置参数 ${key} 的格式无效`);
      }
    }
    for (const [key, value] of Object.entries(credentials)) {
      if (!secretKeys.has(key)) throw new BadRequestException(`不支持的密钥字段：${key}`);
      if (typeof value !== "string") throw new BadRequestException(`密钥字段 ${key} 必须是文本`);
    }

    const existing = await this.prisma.tenantIntegrationConfig.findUnique({
      where: { tenantId_capability_provider: { tenantId, capability, provider } }
    });
    const previousSecrets = this.configuredSecrets(existing ?? undefined);
    const mergedSecrets = { ...previousSecrets, ...(credentials as Record<string, string>) };
    const existingSettings = (existing?.settings ?? {}) as Record<string, unknown>;
    const mergedSettings = { ...existingSettings, ...settings };
    const missing = definition.fields
      .filter((field) => {
        const value = field.secret ? mergedSecrets[field.key] : mergedSettings[field.key];
        return field.required && !String(value ?? "").trim();
      })
      .map((field) => field.key);
    if (input.enabled && missing.length > 0) throw new BadRequestException(`启用前请补齐：${missing.join("、")}`);
    try {
      await validateProviderOutboundUrls(capability, provider, mergedSettings);
    } catch (error) {
      const message = error instanceof UnsafeOutboundUrlError ? error.message : "第三方平台地址无法安全使用";
      throw new BadRequestException(message);
    }

    const secretFieldNames = definition.fields.filter((field) => field.secret && mergedSecrets[field.key]).map((field) => field.key);
    const row = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        // 与运行时创建事务使用同一行锁，避免检查完进行中事实后又被并发创建。
        await tx.$queryRaw(Prisma.sql`
          SELECT id
            FROM tenant_integration_configs
           WHERE tenantId = ${tenantId}
             AND capability = ${capability}
             AND provider = ${provider}
           FOR UPDATE
        `);
        if (existing.enabled && !input.enabled) {
          await this.assertCanDisableProvider(tx, tenantId, capability, provider);
        }
      }
      const saved = await tx.tenantIntegrationConfig.upsert({
        where: { tenantId_capability_provider: { tenantId, capability, provider } },
        create: {
          tenantId,
          capability,
          provider,
          enabled: input.enabled,
          isDefault: input.isDefault,
          settings: mergedSettings as Prisma.InputJsonValue,
          credentialsEncrypted: secretFieldNames.length ? this.secretBox.encrypt(mergedSecrets) : null,
          secretFields: secretFieldNames as Prisma.InputJsonValue,
          lastTestStatus: "not_tested",
          lastTestMode: "none",
          updatedBy: user?.displayName ?? user?.account
        },
        update: {
          enabled: input.enabled,
          isDefault: input.isDefault,
          settings: mergedSettings as Prisma.InputJsonValue,
          credentialsEncrypted: secretFieldNames.length ? this.secretBox.encrypt(mergedSecrets) : null,
          secretFields: secretFieldNames as Prisma.InputJsonValue,
          lastTestStatus: "not_tested",
          lastTestMode: "none",
          lastTestAt: null,
          lastTestError: null,
          updatedBy: user?.displayName ?? user?.account
        }
      });
      if (input.isDefault) {
        await tx.tenantIntegrationConfig.updateMany({
          where: { tenantId, capability, id: { not: saved.id } },
          data: { isDefault: false }
        });
      } else if (existing?.isDefault) {
        // 不能留下“有启用平台但没有默认平台”的半配置状态：运行时只会读取
        // 默认平台，管理员若只是取消勾选，业务就会把已启用的平台误判成未配置。
        // 如果没有其他启用平台，允许停用最后一个默认平台；否则必须先明确把
        // 另一平台设为默认，避免一次保存隐式切换支付/短信/文件出口。
        const otherDefault = await tx.tenantIntegrationConfig.findFirst({
          where: { tenantId, capability, enabled: true, isDefault: true, id: { not: saved.id } },
          select: { id: true }
        });
        if (!otherDefault) {
          if (saved.enabled) throw new BadRequestException("当前默认平台不能取消默认，请先将其他已启用平台设为默认");
          const otherEnabled = await tx.tenantIntegrationConfig.findFirst({
            where: { tenantId, capability, enabled: true, id: { not: saved.id } },
            select: { id: true }
          });
          if (otherEnabled) throw new BadRequestException("当前默认平台不能取消默认，请先将其他已启用平台设为默认");
        }
      } else if (saved.enabled) {
        // 运行时只从默认平台取配置。首个平台若允许“启用但不设默认”，
        // 管理页会显示已启用，但支付/短信/文件链路实际拿不到出口。
        // 在同一事务内阻止这种半配置状态；已有默认平台时，非默认平台可以继续启用。
        const defaultConfig = await tx.tenantIntegrationConfig.findFirst({
          where: { tenantId, capability, enabled: true, isDefault: true },
          select: { id: true }
        });
        if (!defaultConfig) throw new BadRequestException("首个启用的平台必须设为该能力默认平台");
      }
      return saved;
    });
    await this.operationLog.record({
      tenantId,
      user,
      action: "integration.config.update",
      targetType: "tenant-integration",
      targetId: row.id,
      detail: "更新租户第三方平台配置",
      metadata: { capability, provider, enabled: row.enabled, isDefault: row.isDefault, settings, secretFieldsChanged: Object.keys(credentials) }
    });
    return this.summary(row);
  }

  /**
   * 停用 provider 不能把仍在处理中的外部事实变成无法恢复的孤儿：
   * 支付要继续查单/补入账，短信要继续查回执，文件要继续下载或清理。
   * 已完成的历史记录不阻塞切换；未完成记录必须先恢复、迁移或处理完。
   */
  private async assertCanDisableProvider(
    tx: Prisma.TransactionClient,
    tenantId: string,
    capability: TenantIntegrationCapability,
    provider: TenantIntegrationProvider
  ) {
    if (capability === "payment") {
      const [intent, refund] = await Promise.all([
        tx.rentalPaymentIntent.findFirst({
          where: { tenantId, provider, status: { in: ["pending", "verified_pending_funding", "funding_failed"] } },
          select: { id: true }
        }),
        tx.rentalPaymentRefund.findFirst({
          where: { tenantId, provider, status: { in: ["pending", "accepted", "funding_pending"] } },
          select: { id: true }
        })
      ]);
      if (intent || refund) throw new ConflictException("该支付平台仍有未完成的支付或退款事实，请先查单/恢复后再停用");
      return;
    }
    if (capability === "sms") {
      const [pendingBound, pendingUnbound] = await Promise.all([
        tx.rentalNotificationLog.findFirst({
          where: {
            tenantId,
            channel: "sms",
            provider,
            status: { in: ["queued", "sent", "delivery_pending", "delivery_uncertain"] }
          },
          select: { id: true }
        }),
        // 新通知在真正选择服务商前会短暂使用 sms_pending。停用任一短信平台
        // 时必须保护这类队列，避免它在停用检查后才读到旧的默认平台配置。
        tx.rentalNotificationLog.findFirst({
          where: {
            tenantId,
            channel: "sms",
            provider: "sms_pending",
            status: { in: ["queued", "failed"] }
          },
          select: { id: true }
        })
      ]);
      if (pendingBound || pendingUnbound) throw new ConflictException("该短信平台仍有未完成或待核对的通知，请先处理完再停用");
      return;
    }
    const [asset, session] = await Promise.all([
      tx.fileAsset.findFirst({
        where: { tenantId, storageProvider: provider, status: { in: ["active", "pending_upload", "delete_pending", "delete_in_progress"] } },
        select: { id: true }
      }),
      tx.fileUploadSession.findFirst({
        where: { tenantId, provider, status: { in: ["pending_upload", "cleanup_in_progress"] } },
        select: { id: true }
      })
    ]);
    if (asset || session) throw new ConflictException("该文件平台仍有已存文件或待清理上传，请先完成迁移/清理后再停用");
  }

  /**
   * 读取测试所需的配置，但不把密钥返回给 controller。
   * 配置完整性和真实连通性由 connectivity service 分开处理，避免把
   * “字段填了”误报成“第三方平台可用”。
   */
  async testConfig(
    capability: TenantIntegrationCapability,
    provider: TenantIntegrationProvider,
    user?: SystemUserRow
  ): Promise<TenantIntegrationTestConfig> {
    const tenantId = user?.tenantId ?? requireRequestTenantId();
    const definition = this.definition(capability, provider);
    const row = await this.prisma.tenantIntegrationConfig.findUnique({
      where: { tenantId_capability_provider: { tenantId, capability, provider } }
    });
    if (!row) throw new NotFoundException("尚未保存该平台配置");
    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const secrets = this.configuredSecrets(row);
    const missingFields = definition.fields
      .filter((field) => field.required && !String((field.secret ? secrets[field.key] : settings[field.key]) ?? "").trim())
      .map((field) => field.key);
    let configurationError: string | undefined;
    try {
      await validateProviderOutboundUrls(capability, provider, settings);
    } catch (error) {
      configurationError = error instanceof UnsafeOutboundUrlError ? error.message : "第三方平台地址无法安全使用";
    }
    return {
      id: row.id,
      tenantId,
      capability,
      provider,
      settings,
      credentials: secrets,
      missingFields,
      configurationError,
      lastTestAt: row.lastTestAt ?? undefined
    };
  }

  async recordTestResult(input: {
    tenantId: string;
    configId: string;
    status: TenantIntegrationTestStatus;
    mode: "configuration" | "live";
    checkedAt: Date;
    error?: string;
    startedAt?: Date;
  }) {
    const result = await this.prisma.tenantIntegrationConfig.updateMany({
      where: {
        id: input.configId,
        tenantId: input.tenantId,
        ...(input.startedAt ? { lastTestAt: input.startedAt } : {})
      },
      data: {
        lastTestStatus: input.status,
        lastTestMode: input.mode,
        lastTestAt: input.checkedAt,
        lastTestError: input.error ?? null
      }
    });
    return result.count === 1;
  }

  /**
   * 原子占用一次外部测试窗口，避免两个并发点击同时打到第三方平台。
   * lastTestAt 在发起调用前写入；调用完成后再由 recordTestResult 写最终状态。
   */
  async claimLiveTest(input: { tenantId: string; configId: string; startedAt: Date; cooldownMs: number }) {
    const cutoff = new Date(input.startedAt.getTime() - input.cooldownMs);
    const result = await this.prisma.tenantIntegrationConfig.updateMany({
      where: {
        id: input.configId,
        tenantId: input.tenantId,
        OR: [{ lastTestAt: null }, { lastTestAt: { lt: cutoff } }]
      },
      data: {
        lastTestStatus: "not_tested",
        lastTestMode: "live",
        lastTestAt: input.startedAt,
        lastTestError: null
      }
    });
    return result.count === 1;
  }
}
