/** 公共消息应用的窄存储与宿主权威。邀请授权、业务寄件来源和审计沿原宿主及原事务供给。 */
import type { InviteTenantOperatorRequest, TenantDispatchChannel, TenantDispatchSource } from "@rental-os/platform-contracts/tenant-messaging";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";
import type { SubscriptionSqlQuery } from "../subscription/subscription-store";

export interface TenantMessagingSqlTransaction {
  $queryRaw<T = unknown>(query: TemplateStringsArray | SubscriptionSqlQuery, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray | SubscriptionSqlQuery, ...values: unknown[]): Promise<number>;
}

export interface TenantManagementAuthority<Transaction = never> {
  assertTenantManagementPermission(tenantId: string, userId: string, permission: string, transaction?: Transaction): Promise<unknown>;
}

export type TenantInvitationAccess = Pick<InviteTenantOperatorRequest, "organizationId" | "roleIds" | "workspaceAccesses">;

export interface TenantInvitationAuthority<Transaction> extends TenantManagementAuthority<Transaction> {
  validateOperatorInvitationAccess(transaction: Transaction, tenantId: string, userId: string,
    input: TenantInvitationAccess): Promise<{ actorName: string; roleNames: string[]; workspaceNames: string[] }>;
  acceptOperatorInvitationInTransaction(transaction: Transaction, tenantId: string, userId: string,
    input: TenantInvitationAccess & { account: string; displayName: string; isActive: boolean }, passwordHash: string): Promise<string>;
}

export interface TenantInvitationTransaction extends TenantMessagingSqlTransaction {
  user: {
    findFirst(query: { where: { tenantId: string; account: string }; select: { id: true } }): PromiseLike<{ id: string } | null>;
  };
  notificationSendLog: {
    create(query: { data: {
      id: string; tenantId: string; templateCode: string; businessType: string; businessId: string;
      targetType: string; targetName: string; targetMasked: string; channels: string[]; provider: string;
      status: string; requestJson: Exclude<PlatformJsonValue, null>; createdAt: Date;
    } }): PromiseLike<unknown>;
    updateMany(query: { where: { id: string; tenantId: string; status?: string }; data: {
      status: string; responseJson?: Exclude<PlatformJsonValue, null>; sentAt?: Date;
    } }): PromiseLike<{ count: number }>;
  };
}

export interface TenantInvitationDataStore<Transaction extends TenantInvitationTransaction> extends TenantInvitationTransaction {
  tenant: {
    findUnique(query: { where: { id: string }; select: { code: true; name: true; status: true } }): PromiseLike<{
      code: string; name: string; status: string;
    } | null>;
  };
  notificationSendLog: TenantInvitationTransaction["notificationSendLog"] & {
    findFirst(query: { where: { id: string; tenantId: string }; select: { status: true } }): PromiseLike<{ status: string } | null>;
  };
  $transaction<Result>(work: (transaction: Transaction) => Promise<Result>,
    options?: { isolationLevel: "Serializable" }): Promise<Result>;
}

export interface TenantInvitationSecurity {
  getSecurityBaseline(): Promise<{ passwordPolicy: { minLength: number } }>;
}

export interface StoredTenantDispatchRow {
  id: string; source: TenantDispatchSource; channel: TenantDispatchChannel; recipient: string | null;
  subject: string | null; status: string; provider: string; workspaceName: string | null;
  businessType: string | null; businessId: string | null; createdAt: Date; sentAt: Date | null;
}

export interface StoredTenantDispatchBusinessDetail extends StoredTenantDispatchRow {
  renderedText: string;
  templateVersion?: string;
  providerMessageId?: string;
  errorMessage?: string;
  attempts: number;
}

/** 业务查询与公共查询进入同一 SQL UNION，排序、分页和总数由公共应用统一执行。 */
export interface TenantDispatchBusinessParticipant {
  query(tenantId: string): SubscriptionSqlQuery;
  detail(tenantId: string, id: string, channel: TenantDispatchChannel): PromiseLike<StoredTenantDispatchBusinessDetail | null>;
}

interface StoredPlatformDispatch {
  id: string; targetMasked: string | null; templateCode: string | null; channels: PlatformJsonValue;
  status: string; provider: string; businessType: string; businessId: string | null;
  requestJson: PlatformJsonValue; responseJson: PlatformJsonValue; createdAt: Date; sentAt: Date | null;
}

interface StoredVerificationDispatch {
  id: string; status: string; provider: string; requestJson: PlatformJsonValue;
  responseJson: PlatformJsonValue; errorMessage: string | null; createdAt: Date;
}

export interface TenantDispatchDataStore extends Pick<TenantMessagingSqlTransaction, "$queryRaw"> {
  notificationSendLog: {
    findFirst(query: { where: { id: string; tenantId: string } }): PromiseLike<StoredPlatformDispatch | null>;
  };
  externalAdapterLog: {
    findFirst(query: { where: {
      id: string; tenantId: string; capability: "sms"; operation: "send_verification_sms";
    } }): PromiseLike<StoredVerificationDispatch | null>;
  };
}

export interface TenantSupportEmailTransaction extends TenantMessagingSqlTransaction {
  tenantIntegrationConfig: {
    findFirst(query: { where: { id: string; tenantId: string; enabled: true; isDefault: true };
      select: { updatedAt: true; settings: true } }): PromiseLike<{ updatedAt: Date; settings: PlatformJsonValue } | null>;
  };
}

export interface TenantSupportEmailDataStore<Transaction extends TenantSupportEmailTransaction> extends TenantMessagingSqlTransaction {
  tenantIntegrationConfig: {
    findFirst(query: { where: { tenantId: string; capability: "email"; provider: "smtp"; enabled: true; isDefault: true };
      select: { settings: true; lastTestStatus: true; lastTestMode: true } }): PromiseLike<{
      settings: PlatformJsonValue; lastTestStatus: string; lastTestMode: string;
    } | null>;
  };
  $transaction<Result>(work: (transaction: Transaction) => Promise<Result>): Promise<Result>;
}
