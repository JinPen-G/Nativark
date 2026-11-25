/** 原员工订阅 HTTP 的薄适配，沿用原宿主订阅实例及包内唯一处理方法。 */
import { Controller, Inject } from "@nestjs/common";
import { StaffSubscriptionController as RentalStaffSubscriptionController } from "@rental-os/rental-core/http-staff-subscription";
import { SubscriptionService } from "./subscription.service";

@Controller("rental/v1/subscription")
export class StaffSubscriptionController extends RentalStaffSubscriptionController {
  constructor(@Inject(SubscriptionService) subscription: SubscriptionService) { super(subscription); }
}
