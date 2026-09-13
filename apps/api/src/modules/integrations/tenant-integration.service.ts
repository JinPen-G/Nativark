import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
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
    provider?: TenantIntegrationProvider
  ): Promise<TenantIntegrationRuntimeConfig | undefined> {
    const row = await this.prisma.tenantIntegrationConfig.findFirst({
      where: { tenantId, capability, enabled: true, ...(provider ? { provider } : { isDefault: true }) },
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
    return {
      id: row.id,
      capability,
      provider: row.provider as TenantIntegrationProvider,
      settings,
      credentials
    };
  }

  /**
   * 第三方回调没有租户路径，不能信任请求体里的 tenantId。
   * 回调适配器只能从已启用的对应提供方配置中匹配商户标识/证书，
   * 这里返回完整配置但绝不经过 controller。
   */
  async runtimeConfigsForCallback(provider: TenantIntegrationProvider): Promise<Array<TenantIntegrationRuntimeConfig & { tenantId: string }>> {
    const rows = await this.prisma.tenantIntegrationConfig.findMany({
      where: { capability: "payment", provider, enabled: true },
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
