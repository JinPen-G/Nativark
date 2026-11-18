/** 原邀请路由供给匿名 API 与平台品牌，表单由公共消息页面呈现。 */
import { AcceptOperatorInvitationPage as PublicAcceptOperatorInvitationPage } from "@rental-os/platform-admin/messaging";
import { operatorInvitationApi } from "@/api/tenantMessaging";
import { ADMIN_BRAND_NAME, ADMIN_DEFAULT_MARK } from "@/app/branding";

export function AcceptOperatorInvitationPage() {
  return <PublicAcceptOperatorInvitationPage api={operatorInvitationApi} brandName={ADMIN_BRAND_NAME} brandMark={ADMIN_DEFAULT_MARK} />;
}
