/** 公共第三方配置与适配日志的私有存储。原行锁与配置CAS沿同一宿主事务，业务依赖由宿主核验。 */
import type { TenantIntegrationCapability, TenantIntegrationProvider } from "@rental-os/platform-contracts/tenant-integrations";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";
import type { SubscriptionSqlQuery } from "../subscription/subscription-store";

export interface StoredTenantIntegration {
  id: string;
  tenantId: string;
  capability: string;
  provider: string;
  enabled: boolean;
  isDefault: boolean;
  settings: PlatformJsonValue;
  credentialsEncrypted: string | null;
  secretFields: PlatformJsonValue;
  lastTestStatus: string;
  lastTestMode: string;
  lastTestAt: Date | null;
  lastTestError: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantIntegrationWhere {
  id?: string | { not: string };
  tenantId?: string;
  capability?: string;
  provider?: string;
  enabled?: boolean;
  isDefault?: boolean;
  updatedAt?: Date;
  credentialsEncrypted?: string | null;
  lastTestStatus?: string;
  lastTestMode?: string;
  lastTestAt?: Date | null | { lt: Date };
  OR?: TenantIntegrationWhere[];
}

type IntegrationOrder = { capability?: "asc"; provider?: "asc"; isDefault?: "desc"; updatedAt?: "desc" };
type IntegrationRead = { where: TenantIntegrationWhere; orderBy?: IntegrationOrder | IntegrationOrder[] };
type IntegrationUnique = { tenantId_capability_provider: { tenantId: string; capability: string; provider: string } };
type IntegrationWrite = {
  tenantId?: string;
  capability?: string;
  provider?: string;
  enabled?: boolean;
  isDefault?: boolean;
  settings?: Exclude<PlatformJsonValue, null>;
  credentialsEncrypted?: string | null;
  secretFields?: Exclude<PlatformJsonValue, null>;
  lastTestStatus?: string;
  lastTestMode?: string;
  lastTestAt?: Date | null;
  lastTestError?: string | null;
  updatedBy?: string;
  updatedAt?: Date;
};

/** 测试账必须匹配原配置的全部CAS字段。JSON null由生成客户端所属宿主映射，不能携带其他schema的空值类型。 */
export interface IntegrationTestUpdate {
  where: TenantIntegrationWhere & {
    id: string;
    tenantId: string;
    updatedAt: Date;
    enabled: boolean;
    isDefault: boolean;
    settings: { equals: PlatformJsonValue };
    credentialsEncrypted: string | null;
    secretFields: { equals: PlatformJsonValue };
  };
  data: Pick<IntegrationWrite, "updatedAt" | "lastTestStatus" | "lastTestMode" | "lastTestAt" | "lastTestError">;
}

/** 原JSON等值条件逐字段保留，只把JSON null映射为调用方客户端的空值单例。 */
export function integrationTestWhere<JsonNull extends object>(where: IntegrationTestUpdate["where"], jsonNull: JsonNull) {
  return {
    ...where,
    settings: { equals: where.settings.equals ?? jsonNull },
    secretFields: { equals: where.secretFields.equals ?? jsonNull }
  };
}

export interface TenantIntegrationTransaction {
  tenantIntegrationConfig: {
    findUnique(query: { where: IntegrationUnique }): PromiseLike<StoredTenantIntegration | null>;
    findFirst(query: IntegrationRead & { select: { id: true } }): PromiseLike<{ id: string } | null>;
    findMany(query: IntegrationRead): PromiseLike<StoredTenantIntegration[]>;
    create(query: { data: IntegrationWrite & { tenantId: string; capability: string; provider: string;
      settings: Exclude<PlatformJsonValue, null>; secretFields: Exclude<PlatformJsonValue, null> } }): PromiseLike<StoredTenantIntegration>;
    update(query: { where: { id: string; tenantId: string }; data: IntegrationWrite }): PromiseLike<StoredTenantIntegration>;
    updateMany(query: { where: TenantIntegrationWhere; data: IntegrationWrite }): PromiseLike<{ count: number }>;
  };
  $queryRaw<T = unknown>(query: TemplateStringsArray | SubscriptionSqlQuery, ...values: unknown[]): PromiseLike<T>;
}

export interface TenantIntegrationDataStore extends Omit<TenantIntegrationTransaction, "tenantIntegrationConfig"> {
  tenantIntegrationConfig: Omit<TenantIntegrationTransaction["tenantIntegrationConfig"], "findFirst"> & {
    findFirst(query: IntegrationRead): PromiseLike<StoredTenantIntegration | null>;
  };
  externalAdapterLog: {
    create(query: { data: { tenantId: string; provider: string; capability: string; operation: string; status: string;
      requestJson: Exclude<PlatformJsonValue, null>; responseJson?: Exclude<PlatformJsonValue, null>; errorMessage?: string } }): PromiseLike<unknown>;
  };
  updateTestConfiguration(input: IntegrationTestUpdate): PromiseLike<{ count: number }>;
  $transaction<T>(work: (transaction: TenantIntegrationTransaction) => Promise<T>,
    options?: { isolationLevel: "ReadCommitted" }): Promise<T>;
}

/** 短信运行只检查默认配置ID与写适配日志，配置和凭据从同一应用服务读取。 */
export type TenantSmsDataStore = Pick<TenantIntegrationDataStore, "externalAdapterLog"> & {
  tenantIntegrationConfig: Pick<TenantIntegrationTransaction["tenantIntegrationConfig"], "findFirst">;
};

/** 业务结算与原外部事实由各宿主提供。参加者只接收原事务，不取得额外租户或Core权限。 */
export interface TenantIntegrationBusinessParticipant {
  settlementCurrency(tenantId: string): Promise<string | undefined>;
  assertCanDisableProvider(transaction: TenantIntegrationTransaction, tenantId: string,
    capability: TenantIntegrationCapability, provider: TenantIntegrationProvider): Promise<void>;
  assertProviderIdentityChange(transaction: TenantIntegrationTransaction, tenantId: string,
    capability: "payment" | "file", provider: TenantIntegrationProvider): Promise<void>;
}

export type IntegrationRuntimeProviders = Readonly<Partial<Record<TenantIntegrationProvider, TenantIntegrationCapability>>>;
export const PUBLIC_INTEGRATION_RUNTIME_PROVIDERS: IntegrationRuntimeProviders = Object.freeze({
  aliyun_sms: "sms", tencent_sms: "sms", smtp: "email", aliyun_oss: "file", tencent_cos: "file", s3_compatible: "file"
});

export const INTEGRATION_DATA_STORE = Symbol("platform.integration-data-store");
export const INTEGRATION_BUSINESS_PARTICIPANT = Symbol("platform.integration-business-participant");
export const INTEGRATION_RUNTIME_PROVIDERS = Symbol("platform.integration-runtime-providers");
export const TENANT_INTEGRATION_APPLICATION = Symbol("platform.tenant-integration-application");
export const TENANT_INTEGRATION_CONNECTIVITY = Symbol("platform.tenant-integration-connectivity");
