/** 原客服邮件 HTTP 复用公共 Controller，注入原宿主同一邮箱应用。 */
import { Controller, Inject } from "@nestjs/common";
import { TenantSupportEmailController as PublicTenantSupportEmailController } from "@rental-os/platform-server/messaging";
import { TenantSupportEmailService } from "./tenant-support-email.service";

@Controller("platform/support/emails")
export class TenantSupportEmailController extends PublicTenantSupportEmailController {
  constructor(@Inject(TenantSupportEmailService) support: TenantSupportEmailService) { super(support); }
}
