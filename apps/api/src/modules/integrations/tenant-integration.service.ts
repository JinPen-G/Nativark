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
  type TenantIntegrationTestResult
} from "@rental-os/shared";
import { OperationLogService } from "../../common/operation-log.service";
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
      where: { tenantId, capability, enabled: true, ...(provider ? { provider } : {}) },
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
    return rows.flatMap((row) => {
      const definition = this.definition("payment", provider);
      const credentials = this.configuredSecrets(row);
      const settings = (row.settings ?? {}) as Record<string, unknown>;
      const missing = definition.fields
        .filter((field) => field.required && !String((field.secret ? credentials[field.key] : settings[field.key]) ?? "").trim())
        .map((field) => field.key);
      if (missing.length > 0) return [];
      return [{
        tenantId: row.tenantId,
        id: row.id,
        capability: "payment" as const,
        provider,
        settings,
        credentials
      }];
    });
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
          updatedBy: user?.displayName ?? user?.account
        },
        update: {
          enabled: input.enabled,
          isDefault: input.isDefault,
          settings: mergedSettings as Prisma.InputJsonValue,
          credentialsEncrypted: secretFieldNames.length ? this.secretBox.encrypt(mergedSecrets) : null,
          secretFields: secretFieldNames as Prisma.InputJsonValue,
          lastTestStatus: "not_tested",
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

  async test(capability: TenantIntegrationCapability, provider: TenantIntegrationProvider, user?: SystemUserRow): Promise<TenantIntegrationTestResult> {
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
    const ok = missingFields.length === 0;
    const checkedAt = new Date();
    await this.prisma.tenantIntegrationConfig.update({
      where: { id: row.id },
      data: { lastTestStatus: ok ? "passed" : "failed", lastTestAt: checkedAt, lastTestError: ok ? null : `缺少：${missingFields.join("、")}` }
    });
    return {
      capability,
      provider,
      ok,
      mode: "configuration",
      message: ok ? "配置字段完整；尚未发起真实外部调用。" : "配置不完整，请补齐必填字段。",
      checkedAt: checkedAt.toISOString(),
      missingFields
    };
  }
}
