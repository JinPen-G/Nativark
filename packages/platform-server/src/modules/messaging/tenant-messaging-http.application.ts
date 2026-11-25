/** 消息 HTTP 只消费宿主已有的应用实例，权限、事务与投递恢复由对应应用执行。 */
import type { PlatformTenantOperatorInvitationsService } from "./tenant-operator-invitations.service";
import type { PlatformTenantDispatchService } from "./tenant-dispatch.service";
import type { PlatformTenantSupportEmailService } from "./tenant-support-email.service";

export type TenantOperatorInvitationsHttpApplication = Pick<PlatformTenantOperatorInvitationsService,
  "list" | "checkEmail" | "mailPreview" | "readByKey" | "send" | "revoke" | "assertPublicRate" | "inspect" | "accept">;
export type TenantDispatchHttpApplication = Pick<PlatformTenantDispatchService, "list" | "detail">;
export type TenantSupportEmailHttpApplication = Pick<PlatformTenantSupportEmailService, "list" | "detail" | "sync">;

export interface TenantMessagingHttpApplications {
  invitations: TenantOperatorInvitationsHttpApplication;
  dispatch: TenantDispatchHttpApplication;
  support: TenantSupportEmailHttpApplication;
}

export const TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION = Symbol("platform.messaging.invitations-http-application");
export const TENANT_DISPATCH_HTTP_APPLICATION = Symbol("platform.messaging.dispatch-http-application");
export const TENANT_SUPPORT_EMAIL_HTTP_APPLICATION = Symbol("platform.messaging.support-email-http-application");
