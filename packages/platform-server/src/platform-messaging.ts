/** 公共模块用同一数据库、账号权威、邮件运输与审计装配三项消息应用。
 * 默认邀请只授予租户基础角色；业务范围与Core分配另沿受控业务入口办理。 */
import type { ConfigService } from "@nestjs/config";
import type { PlatformOperationLogService } from "./common/operation-log.service";
import type { TenantEmailRuntimeService } from "./modules/integrations/tenant-email.runtime.service";
import type { TenantIntegrationService } from "./modules/integrations/tenant-integration.service";
import { PlatformTenantOperatorInvitationsService } from "./modules/messaging/tenant-operator-invitations.service";
import { PlatformTenantDispatchService } from "./modules/messaging/tenant-dispatch.service";
import { PlatformTenantSupportEmailService } from "./modules/messaging/tenant-support-email.service";
import type { TenantMessagingHttpApplications } from "./modules/messaging/tenant-messaging-http.application";
import type { TenantInvitationDataStore, TenantInvitationTransaction, TenantDispatchDataStore,
  TenantSupportEmailDataStore, TenantSupportEmailTransaction } from "./modules/messaging/messaging-store";
import { PlatformMemberInvitationAuthority } from "./modules/platform/platform-member-invitation.authority";
import type { PlatformManagementDatabase, PlatformManagementTransaction } from "./modules/platform/platform-management.store";
import { readPlatformSecurityBaseline } from "./modules/platform/platform-security-baseline";

type PublicMessagingTransaction = PlatformManagementTransaction & TenantInvitationTransaction & TenantSupportEmailTransaction;
export type PublicMessagingDatabase = PlatformManagementDatabase & TenantInvitationDataStore<PublicMessagingTransaction>
  & TenantDispatchDataStore & TenantSupportEmailDataStore<PublicMessagingTransaction>;

export function createPublicMessagingApplications(database: PublicMessagingDatabase, config: Pick<ConfigService, "get">,
  integrations: Pick<TenantIntegrationService, "assertEnabledInTransaction">,
  email: Pick<TenantEmailRuntimeService, "configuration" | "send">,
  audit: Pick<PlatformOperationLogService, "record">): TenantMessagingHttpApplications {
  const accounts = new PlatformMemberInvitationAuthority(database);
  return {
    invitations: new PlatformTenantOperatorInvitationsService<PublicMessagingTransaction>(database, config,
      { getSecurityBaseline: () => readPlatformSecurityBaseline(database) }, accounts, integrations, email),
    dispatch: new PlatformTenantDispatchService(database, accounts, audit),
    support: new PlatformTenantSupportEmailService<PublicMessagingTransaction>(database, accounts, email, audit)
  };
}
