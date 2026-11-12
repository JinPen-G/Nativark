import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import {
  findTenantIntegrationProvider,
  paymentProviderSupportsCurrency,
  RENTAL_CURRENCY_CODES,
  TENANT_INTEGRATION_PROVIDERS,
  type RentalCurrency,
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
import { getRequestIdentity, requireRequestTenantId } from "../../common/request-identity";
import { hasEffectivePermission } from "../../common/permission-match";
import { SecretBox } from "../../common/secret-box";
import { PrismaService } from "../database/prisma.service";

type IntegrationRow = Prisma.TenantIntegrationConfigGetPayload<object>;

export interface TenantIntegrationRuntimeConfig {
  id: string;
  capability: TenantIntegrationCapability;
  provider: TenantIntegrationProvider;
  settings: Record<string, unknown>;
  credentials: Record<string, string>;
  /** Private original config CAS for transaction-bound creation; never public. */
  revision?: TenantIntegrationTestRevision;
}

export interface TenantIntegrationRuntimeOptions {
  /**
   * 新的外部业务调用默认要求最近一次配置已经通过 live 连通性测试。
   * 既有事实的查单、回执、上传完成和清理可显式关闭此要求，避免恢复链被测试状态阻断。
   */
  requireLiveTest?: boolean;
  /** 新建外部业务事实时要求该平台仍是租户当前明确选择的默认出口。 */
  requireDefault?: boolean;
  /** The exact config read before entering the business transaction. */
  configRevision?: TenantIntegrationTestRevision;
}

/** Private storage CAS token, never a controller response or a log field. Test
 * bookkeeping does not advance this config version; a config save invalidates it. */
export type TenantIntegrationTestRevision = Pick<IntegrationRow,
  'updatedAt' | 'settings' | 'credentialsEncrypted' | 'secretFields' | 'enabled' | 'isDefault'>;

export interface TenantIntegrationTestConfig extends TenantIntegrationRuntimeConfig {
  tenantId: string;
  revision: TenantIntegrationTestRevision;
  missingFields: string[];
  configurationError?: string;
  lastTestAt?: Date;
}

export interface TenantOpeningIntegrationQuery { limit?: number; after?: string; }
export type TenantOpeningIntegrationState = "not_loaded" | "not_implemented" | "missing_configuration"
  | "configured_unverified" | "mock" | "failed" | "historical_live_success" | "current_live_success";
export interface TenantOpeningIntegrationItem {
  configId: string | null; capability: string; provider: string; registered: boolean; implemented: boolean;
  state: TenantOpeningIntegrationState; enabled: boolean | null; isDefault: boolean | null;
  /** The original config CAS timestamp, not a workspace or aggregate version. */
  configurationUpdatedAt: string | null;
  requiredFields: string[]; missingFields: string[] | null;
  structuralConfigurationComplete: boolean | null; conditionalFieldsValid: boolean | null; credentialMaterialPresent: boolean | null;
  test: { status: "not_tested" | "passed" | "failed" | "unknown";
    mode: "none" | "configuration" | "live" | "mock" | "unknown"; checkedAt: string | null;
    matchesCurrentConfiguration: boolean } | null;
}
export interface TenantOpeningIntegrationObservation {
  tenantId: string; workspaceId: string; observedAt: string; items: TenantOpeningIntegrationItem[];
  hasMore: boolean; nextAfter: string | null; limit: number;
  coverage: "all_persisted_configuration_records" | "configuration_window";
  credentialEvidence: "stored_field_presence_only_not_decrypted";
}

// Closed original SMS, payment and file-storage adapters. A new catalog entry
// must not become an implemented runtime merely by appearing in that catalog.
const openingRuntimeProviders: Readonly<Record<TenantIntegrationProvider, TenantIntegrationCapability>> = {
  aliyun_sms: "sms", tencent_sms: "sms", alipay: "payment", wechat_pay: "payment", stripe: "payment",
  aliyun_oss: "file", tencent_cos: "file", s3_compatible: "file"
};
type OpeningObservationRow = {
  id: string; tenantId: string; capability: string; provider: string; enabled: unknown; isDefault: unknown;
  updatedAt: Date; lastTestStatus: string; lastTestMode: string; lastTestAt: Date | null;
  credentialMaterialPresent: unknown; fieldPresence: unknown; conditionalFieldsValid: unknown;
};

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

  /** Conditional provider fields are validated as pairs; UI `required` flags alone are not a security boundary. */
  private conditionalProviderProblem(provider: TenantIntegrationProvider, settings: Record<string, unknown>, credentials: Record<string, string>) {
    if (provider !== "wechat_pay") return undefined;
    const certificateSerial = String(settings.platformCertificateSerial ?? "").trim();
    const certificate = String(credentials.wechatPlatformCertificate ?? "").trim();
    const publicKeyId = String(settings.platformPublicKeyId ?? "").trim();
    const publicKey = String(credentials.wechatPlatformPublicKey ?? "").trim();
    if (Boolean(certificateSerial) !== Boolean(certificate)) return "平台证书序列号与平台证书必须成对配置";
    if (Boolean(publicKeyId) !== Boolean(publicKey)) return "微信支付公钥 ID 与公钥必须成对配置";
    if (!certificate && !publicKey) return "请配置一组微信平台证书或微信支付公钥验签材料";
    if (publicKey && !/^PUB_KEY_ID_[0-9]+$/u.test(publicKeyId)) return "微信支付公钥 ID 格式无效，应为 PUB_KEY_ID_ 加数字";
    return undefined;
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

  /**
   * 目录按当前租户结算币种过滤支付平台(一租户一币种,境内/境外二选一):
   * 境内 CNY 租户看不到跨境平台、境外租户看不到境内支付宝/微信。短信/文件平台
   * 与币种无关,始终返回。已配置过的平台即使与当前币种不符也保留,以便管理端仍能
   * 渲染并停用它,不会把既有配置变成无法操作的孤儿。
   */
  async catalog(tenantId = requireRequestTenantId()): Promise<TenantIntegrationCatalogResponse> {
    const [configs, currency] = await Promise.all([
      this.prisma.tenantIntegrationConfig.findMany({
        where: { tenantId },
        orderBy: [{ capability: "asc" }, { provider: "asc" }]
      }),
      this.resolveTenantSettlementCurrency(tenantId)
    ]);
    const configured = new Set(configs.map((row) => row.provider));
    const providers = TENANT_INTEGRATION_PROVIDERS.filter(
      (definition) =>
        definition.capability !== "payment" ||
        paymentProviderSupportsCurrency(definition, currency) ||
        configured.has(definition.provider)
    );
    return { providers, configs: configs.map((row) => this.summary(row)) };
  }

  /** Internal R0 observation under the original integration Guard/ALS. SQL
   * returns field-presence scalars, never settings, URLs, ciphertext or errors.
   * Secret markers are not decryption evidence. Original live-test bookkeeping
   * is adopted only for a complete active default config at the same revision;
   * it does not run a test or prove a new external operation will succeed. */
  async observeOpeningConfiguration(query: TenantOpeningIntegrationQuery = {}, clock: () => Date = () => new Date()): Promise<TenantOpeningIntegrationObservation> {
    const identity = structuredClone(getRequestIdentity()), tenantId = requireRequestTenantId();
    if (!identity?.userId || !identity.workspaceId || identity.isSaasAdmin || identity.audience !== "operator"
      || !hasEffectivePermission(identity.permissions ?? [], "system:integration:manage")) throw new ForbiddenException("第三方配置观察缺少当前原读取权限");
    if (!query || typeof query !== "object" || Array.isArray(query) || Object.keys(query).some(key => !["limit", "after"].includes(key)))
      throw new BadRequestException("第三方配置观察窗口无效");
    const limit = query.limit ?? 16, after = query.after;
    const identifier = (value: unknown, max = 191): value is string => typeof value === "string" && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 32 || after !== undefined && !identifier(after)) throw new BadRequestException("第三方配置观察窗口无效");
    const unavailable = () => new ServiceUnavailableException("第三方配置观察来源无效");
    const definitions = structuredClone(TENANT_INTEGRATION_PROVIDERS);
    if (!definitions.length || definitions.length > 16 || new Set(definitions.map(row => `${row.capability}:${row.provider}`)).size !== definitions.length
      || definitions.some(row => row.fields.length > 32 || new Set(row.fields.map(field => field.key)).size !== row.fields.length
        || row.fields.some(field => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field.key)))) throw unavailable();
    const secretMaterial = Prisma.sql`(c.credentialsEncrypted IS NOT NULL AND CHAR_LENGTH(c.credentialsEncrypted) > 0)`;
    const present = (field: { key: string; secret: boolean }) => field.secret
      ? Prisma.sql`COALESCE((${secretMaterial} AND JSON_TYPE(c.secretFields) = 'ARRAY' AND JSON_CONTAINS(c.secretFields, JSON_QUOTE(${field.key}))), 0)`
      : Prisma.sql`COALESCE((JSON_TYPE(JSON_EXTRACT(c.settings, ${`$."${field.key}"`})) IN ('STRING', 'BOOLEAN', 'INTEGER', 'DOUBLE')
          AND CHAR_LENGTH(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(c.settings, ${`$."${field.key}"`})), '^[[:space:]]+|[[:space:]]+$', '')) > 0), 0)`;
    const presenceCases = definitions.map(definition => Prisma.sql`WHEN c.capability = ${definition.capability} AND c.provider = ${definition.provider}
      THEN JSON_OBJECT(${Prisma.join(definition.fields.flatMap(field => [Prisma.sql`${field.key}`, present(field)]))})`);
    const pair = (key: string, secret: boolean) => present({ key, secret });
    const conditional = Prisma.sql`CASE WHEN c.capability = 'payment' AND c.provider = 'wechat_pay' THEN
      (${pair("platformCertificateSerial", false)} = ${pair("wechatPlatformCertificate", true)}
        AND ${pair("platformPublicKeyId", false)} = ${pair("wechatPlatformPublicKey", true)}
        AND (${pair("wechatPlatformCertificate", true)} OR ${pair("wechatPlatformPublicKey", true)})
        AND (NOT ${pair("wechatPlatformPublicKey", true)} OR JSON_UNQUOTE(JSON_EXTRACT(c.settings, '$.platformPublicKeyId')) REGEXP '^PUB_KEY_ID_[0-9]+$'))
      ELSE 1 END`;
    const rows = await this.prisma.$queryRaw<OpeningObservationRow[]>(Prisma.sql`
      SELECT c.id, c.tenantId, c.capability, c.provider, c.enabled, c.isDefault, c.updatedAt,
        c.lastTestStatus, c.lastTestMode, c.lastTestAt, ${secretMaterial} AS credentialMaterialPresent,
        CASE ${Prisma.join(presenceCases, " ")} ELSE NULL END AS fieldPresence,
        ${conditional} AS conditionalFieldsValid
      FROM tenant_integration_configs AS c
      WHERE c.tenantId = ${tenantId} ${after === undefined ? Prisma.empty : Prisma.sql`AND BINARY c.id > BINARY ${after}`}
      ORDER BY BINARY c.id ASC LIMIT ${limit + 1}`);
    if (!isDeepStrictEqual(getRequestIdentity(), identity)) throw new ForbiddenException("第三方配置读取期间身份或范围变化");
    const observed = clock();
    if (!(observed instanceof Date) || !Number.isFinite(observed.getTime()) || !Array.isArray(rows) || rows.length > limit + 1) throw unavailable();
    const boolean = (value: unknown) => {
      if (value === true || value === 1 || value === "1" || value === BigInt(1)) return true;
      if (value === false || value === 0 || value === "0" || value === BigInt(0)) return false;
      throw unavailable();
    };
    const decoded = rows.map((row, index): TenantOpeningIntegrationItem => {
      if (!identifier(row.id) || row.tenantId !== tenantId || !identifier(row.capability, 20) || !identifier(row.provider, 40)
        || index > 0 && rows[index - 1].id >= row.id || after !== undefined && row.id <= after
        || !(row.updatedAt instanceof Date) || !Number.isFinite(row.updatedAt.getTime())
        || row.lastTestAt !== null && (!(row.lastTestAt instanceof Date) || !Number.isFinite(row.lastTestAt.getTime()))
        || typeof row.lastTestStatus !== "string" || row.lastTestStatus.length > 20 || typeof row.lastTestMode !== "string" || row.lastTestMode.length > 20) throw unavailable();
      const enabled = boolean(row.enabled), isDefault = boolean(row.isDefault), credentialMaterialPresent = boolean(row.credentialMaterialPresent);
      const conditionalFieldsValid = boolean(row.conditionalFieldsValid);
      const definition = definitions.find(value => value.capability === row.capability && value.provider === row.provider);
      const implemented = Boolean(definition && openingRuntimeProviders[definition.provider] === definition.capability);
      let missingFields: string[] | null = null, complete: boolean | null = null;
      if (definition) {
        let fields = row.fieldPresence;
        if (typeof fields === "string") { if (fields.length > 4096) throw unavailable(); try { fields = JSON.parse(fields); } catch { throw unavailable(); } }
        if (!fields || typeof fields !== "object" || Array.isArray(fields) || Object.keys(fields).length !== definition.fields.length
          || Object.keys(fields).some(key => !definition.fields.some(field => field.key === key))) throw unavailable();
        const known = fields as Record<string, unknown>;
        for (const field of definition.fields) boolean(known[field.key]);
        missingFields = definition.fields.filter(field => field.required && !boolean(known[field.key])).map(field => field.key);
        complete = missingFields.length === 0 && conditionalFieldsValid;
      } else if (row.fieldPresence !== null) throw unavailable();
      const mock = row.lastTestMode === "mock" || ["mock_success", "mock_failed"].includes(row.lastTestStatus);
      const status = ["not_tested", "passed", "failed"].includes(row.lastTestStatus) ? row.lastTestStatus as "not_tested" | "passed" | "failed" : "unknown";
      const mode = mock ? "mock" : ["none", "configuration", "live"].includes(row.lastTestMode)
        ? row.lastTestMode as "none" | "configuration" | "live" : "unknown";
      // save invalidates test fields and advances this exact config CAS. The
      // recorded test is historical if its original timestamp predates that
      // revision; a live success on a disabled/nondefault config is not ready.
      const matchesCurrentConfiguration = status !== "not_tested" && status !== "unknown" && ["live", "configuration"].includes(mode) && row.lastTestAt !== null
        && row.lastTestAt >= row.updatedAt && row.lastTestAt <= observed;
      const recordedTest = row.lastTestAt !== null && row.lastTestAt <= observed;
      const state: TenantOpeningIntegrationState = mock ? "mock" : !implemented ? "not_implemented" : !complete ? "missing_configuration"
        : status === "failed" && recordedTest ? "failed" : status === "passed" && mode === "live" && recordedTest
          ? matchesCurrentConfiguration && enabled && isDefault ? "current_live_success" : "historical_live_success" : "configured_unverified";
      return { configId: row.id, capability: row.capability, provider: row.provider, registered: Boolean(definition), implemented,
        state, enabled, isDefault, configurationUpdatedAt: row.updatedAt.toISOString(),
        requiredFields: definition?.fields.filter(field => field.required).map(field => field.key) ?? [], missingFields,
        structuralConfigurationComplete: complete, conditionalFieldsValid: definition ? conditionalFieldsValid : null, credentialMaterialPresent,
        test: { status, mode, checkedAt: row.lastTestAt?.toISOString() ?? null, matchesCurrentConfiguration } };
    });
    const hasMore = decoded.length > limit, items = decoded.slice(0, limit), completeWindow = after === undefined && !hasMore;
    for (const definition of definitions) if (!items.some(item => item.capability === definition.capability && item.provider === definition.provider)) {
      items.push({ configId: null, capability: definition.capability, provider: definition.provider, registered: true,
        implemented: openingRuntimeProviders[definition.provider] === definition.capability,
        state: openingRuntimeProviders[definition.provider] !== definition.capability ? "not_implemented" : completeWindow ? "missing_configuration" : "not_loaded",
        enabled: null, isDefault: null, configurationUpdatedAt: null, requiredFields: definition.fields.filter(field => field.required).map(field => field.key),
        missingFields: null, structuralConfigurationComplete: null, conditionalFieldsValid: null, credentialMaterialPresent: null, test: null });
    }
    if (!isDeepStrictEqual(getRequestIdentity(), identity)) throw new ForbiddenException("第三方配置读取期间身份或范围变化");
    return { tenantId, workspaceId: identity.workspaceId, observedAt: observed.toISOString(), items, hasMore,
      nextAfter: hasMore ? decoded[limit - 1].configId : null, limit,
      coverage: completeWindow ? "all_persisted_configuration_records" : "configuration_window",
      credentialEvidence: "stored_field_presence_only_not_decrypted" };
  }

  /**
   * 一租户一币种(境内/境外二选一):取该租户任一经营空间业务设置里的结算币种作为
   * 租户结算币种;尚未建空间时默认 CNY(境内),即只展示境内收单平台。
   */
  private async resolveTenantSettlementCurrency(tenantId: string): Promise<RentalCurrency> {
    const row = await this.prisma.rentalTenantBusinessSettings.findFirst({
      where: { tenantId },
      select: { settings: true },
      orderBy: { updatedAt: "desc" }
    });
    const settings = (row?.settings ?? {}) as { pricing?: { currency?: string } };
    const currency = settings.pricing?.currency;
    return currency && RENTAL_CURRENCY_CODES.includes(currency as RentalCurrency) ? (currency as RentalCurrency) : "CNY";
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
    const conditionalProblem = this.conditionalProviderProblem(row.provider as TenantIntegrationProvider, settings, credentials);
    if (conditionalProblem) throw new ServiceUnavailableException(conditionalProblem);
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
      credentials,
      revision: this.configRevision(row)
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
    const rows = await tx.$queryRaw<Array<IntegrationRow>>(Prisma.sql`
      SELECT id, tenantId, capability, provider, enabled, isDefault, updatedAt, settings, credentialsEncrypted, secretFields, lastTestStatus, lastTestMode
        FROM tenant_integration_configs
       WHERE tenantId = ${tenantId}
         AND capability = ${capability}
         AND provider = ${provider}
         ${options.requireDefault ? Prisma.sql`AND isDefault = 1` : Prisma.empty}
       FOR UPDATE
    `);
    const row = rows[0];
    const truth = (value: unknown) => value === true || value === 1 || value === "1";
    const enabled = truth(row?.enabled);
    if (!row || !enabled) {
      throw new ServiceUnavailableException("该第三方平台已停用或配置不存在，请稍后重试");
    }
    if (options.requireDefault && !truth(row.isDefault)) {
      throw new ServiceUnavailableException("该第三方平台已不再是当前默认平台，请刷新后重试");
    }
    if (options.requireLiveTest !== false && (row.lastTestStatus !== "passed" || row.lastTestMode !== "live")) {
      throw new ServiceUnavailableException("该第三方平台尚未通过真实连接测试，请先完成连接测试");
    }
    if (options.configRevision && !isDeepStrictEqual(this.configRevision(row), options.configRevision)) {
      throw new ConflictException("第三方配置已变化，不能用旧配置创建业务操作");
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
      if (this.conditionalProviderProblem(provider, settings, credentials)) continue;
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
    // 按结算币种守住收单平台:境外租户不能启用境内 CNY-only 的支付宝/微信,反之亦然。
    // 目录已隐藏不匹配的平台,这里是后端强约束——前端隐藏不能替代后端数据权限。
    if (capability === "payment" && input.enabled) {
      const currency = await this.resolveTenantSettlementCurrency(tenantId);
      if (!paymentProviderSupportsCurrency(definition, currency)) {
        throw new BadRequestException(`该收单平台不支持当前结算币种(${currency})，无法启用；请选择支持该币种的收单平台`);
      }
    }
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
    const conditionalProblem = this.conditionalProviderProblem(provider, mergedSettings, mergedSecrets);
    if (input.enabled && conditionalProblem) throw new BadRequestException(conditionalProblem);
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
        const locked = await tx.$queryRaw<Array<IntegrationRow>>(Prisma.sql`
          SELECT id, tenantId, capability, provider, enabled, isDefault, updatedAt, settings, credentialsEncrypted, secretFields
            FROM tenant_integration_configs
           WHERE tenantId = ${tenantId}
             AND capability = ${capability}
             AND provider = ${provider}
           FOR UPDATE
        `);
        const current = locked[0];
        if (!current || current.id !== existing.id || !isDeepStrictEqual(this.configRevision(current), this.configRevision(existing))) {
          throw new ConflictException("平台配置已被其他操作修改，请重新载入后保存");
        }
        await this.assertOriginalProviderIdentity(tx, current, capability, provider, mergedSettings, mergedSecrets);
        if (this.configRevision(current).enabled && !input.enabled) {
          await this.assertCanDisableProvider(tx, tenantId, capability, provider);
        }
      }
      // Millisecond timestamp collisions must still invalidate an older claim.
      const updatedAt = new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1));
      const write = {
        create: {
          tenantId,
          capability,
          provider,
          enabled: input.enabled,
          isDefault: input.isDefault,
          updatedAt,
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
          updatedAt,
          settings: mergedSettings as Prisma.InputJsonValue,
          credentialsEncrypted: secretFieldNames.length ? this.secretBox.encrypt(mergedSecrets) : null,
          secretFields: secretFieldNames as Prisma.InputJsonValue,
          lastTestStatus: "not_tested",
          lastTestMode: "none",
          lastTestAt: null,
          lastTestError: null,
          updatedBy: user?.displayName ?? user?.account
        }
      };
      // A concurrent first save must not turn an originally absent row into an
      // unchecked upsert update after someone has started using its identity.
      const saved = existing
        ? await tx.tenantIntegrationConfig.update({ where: { id: existing.id, tenantId }, data: write.update })
        : await tx.tenantIntegrationConfig.create({ data: write.create });
      if (input.isDefault) {
        await tx.tenantIntegrationConfig.updateMany({
          where: { tenantId, capability, id: { not: saved.id }, isDefault: true },
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
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
      revision: this.configRevision(row),
      lastTestAt: row.lastTestAt ?? undefined
    };
  }

  private configRevision(row: IntegrationRow): TenantIntegrationTestRevision {
    const truth = (value: unknown) => value === true || value === 1 || value === '1';
    return structuredClone({ updatedAt: row.updatedAt, settings: row.settings, credentialsEncrypted: row.credentialsEncrypted,
      secretFields: row.secretFields, enabled: truth(row.enabled), isDefault: truth(row.isDefault) });
  }

  private async assertOriginalProviderIdentity(tx: Prisma.TransactionClient, row: IntegrationRow,
    capability: TenantIntegrationCapability, provider: TenantIntegrationProvider,
    settings: Record<string, unknown>, secrets: Record<string, string>) {
    if (capability === 'sms') return;
    const previousSettings = (row.settings ?? {}) as Record<string, unknown>, previousSecrets = this.configuredSecrets(row);
    const keys = capability === 'file' ? ['endpoint', 'bucket', 'region', 'objectPrefix', 'forcePathStyle']
      : provider === 'alipay' ? ['appId', 'gatewayUrl'] : provider === 'wechat_pay' ? ['mchid', 'appId', 'gatewayUrl'] : [];
    const changed = keys.some(key => !isDeepStrictEqual(previousSettings[key], settings[key]))
      // Stripe's secret identifies an account as well as authorizing it. There is
      // no trusted account-id port here, so a changed key cannot be called a same-account rotation.
      || (provider === 'stripe' && previousSecrets.secretKey !== secrets.secretKey);
    if (!changed) return;
    const dependent = capability === 'file'
      ? await tx.fileAsset.findFirst({ where: { tenantId: row.tenantId, storageProvider: provider, status: { not: 'deleted' } }, select: { id: true } })
        || await tx.fileUploadSession.findFirst({ where: { tenantId: row.tenantId, provider, OR: [
          { status: { in: ['pending_upload', 'cleanup_in_progress'] } }, { cleanupError: { not: null } }
        ] }, select: { id: true } })
      : await tx.rentalPaymentIntent.findFirst({ where: { tenantId: row.tenantId, provider }, select: { id: true } })
        || await tx.rentalPaymentRefund.findFirst({ where: { tenantId: row.tenantId, provider }, select: { id: true } });
    if (dependent) throw new ConflictException(capability === 'file'
      ? '原文件或上传仍依赖当前存储位置，不能原位更换；请先完成受控迁移/清理'
      : '历史支付或退款仍依赖原商户配置，不能原位更换；需保留原商户恢复通路');
  }

  private testRevisionWhere(revision: TenantIntegrationTestRevision): Prisma.TenantIntegrationConfigWhereInput {
    if (!revision || !(revision.updatedAt instanceof Date) || !Number.isFinite(revision.updatedAt.getTime())
      || typeof revision.enabled !== 'boolean' || typeof revision.isDefault !== 'boolean') {
      throw new ConflictException("连接测试缺少原配置版本");
    }
    return { updatedAt: revision.updatedAt, enabled: revision.enabled, isDefault: revision.isDefault,
      settings: { equals: revision.settings ?? Prisma.JsonNull }, credentialsEncrypted: revision.credentialsEncrypted,
      secretFields: { equals: revision.secretFields ?? Prisma.JsonNull } };
  }

  async recordTestResult(input: {
    tenantId: string;
    revision: TenantIntegrationTestRevision;
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
        ...this.testRevisionWhere(input.revision),
        ...(input.startedAt ? { lastTestAt: input.startedAt, lastTestStatus: "not_tested", lastTestMode: "live" } : {})
      },
      data: {
        updatedAt: input.revision.updatedAt,
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
  async claimLiveTest(input: { tenantId: string; configId: string; startedAt: Date; cooldownMs: number;
    revision: TenantIntegrationTestRevision }) {
    const cutoff = new Date(input.startedAt.getTime() - input.cooldownMs);
    const result = await this.prisma.tenantIntegrationConfig.updateMany({
      where: {
        id: input.configId,
        tenantId: input.tenantId,
        ...this.testRevisionWhere(input.revision),
        OR: [{ lastTestAt: null }, { lastTestAt: { lt: cutoff } }]
      },
      data: {
        updatedAt: input.revision.updatedAt,
        lastTestStatus: "not_tested",
        lastTestMode: "live",
        lastTestAt: input.startedAt,
        lastTestError: null
      }
    });
    return result.count === 1;
  }
}
