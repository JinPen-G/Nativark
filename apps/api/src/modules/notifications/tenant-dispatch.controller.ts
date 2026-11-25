/** 原寄件 HTTP 复用公共 Controller，注入原宿主带业务参加者的同一应用。 */
import { Controller, Inject } from "@nestjs/common";
import { TenantDispatchController as PublicTenantDispatchController } from "@rental-os/platform-server/messaging";
import { TenantDispatchService } from "./tenant-dispatch.service";

@Controller("platform/dispatch")
export class TenantDispatchController extends PublicTenantDispatchController {
  constructor(@Inject(TenantDispatchService) dispatch: TenantDispatchService) { super(dispatch); }
}
