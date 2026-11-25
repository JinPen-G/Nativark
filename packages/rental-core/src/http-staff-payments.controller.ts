/** 所选Rental宿主的员工收款HTTP入口。已验证空间/地点沿原Guard，登记和确认委托唯一资金服务。 */
import { Body, Controller, Get, Inject, Param, Post, Query, Req, ForbiddenException } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { getRequestWorkspaceId } from "@rental-os/platform-server/request-identity";
import { CreateStaffOfflinePaymentDto } from "./http-staff-payment.dto";
import { RENTAL_STAFF_PAYMENTS_APPLICATION, type RentalStaffPaymentsHttpApplication } from "./http-service-ports";

interface StaffPaymentRequest {
  user: SystemUserRow;
  staffLocationScope?: { mode: "all" | "selected"; locationIds: string[] };
}

@Controller("staff/v1/offline-payments")
export class StaffOfflinePaymentController {
  constructor(@Inject(RENTAL_STAFF_PAYMENTS_APPLICATION) private readonly payments: RentalStaffPaymentsHttpApplication) {}

  @Get()
  list(@Req() req: StaffPaymentRequest, @Query("orderId") orderId?: string) {
    const workspaceId = getRequestWorkspaceId();
    if (!workspaceId || !orderId) throw new ForbiddenException("缺少已驗證的经营空间或订单编号");
    return this.payments.list(req.user.tenantId, workspaceId, orderId, this.scope(req));
  }

  @Post()
  register(@Req() req: StaffPaymentRequest, @Body() body: CreateStaffOfflinePaymentDto) {
    const workspaceId = getRequestWorkspaceId();
    if (!workspaceId) throw new ForbiddenException("缺少已驗證的经营空间");
    return this.payments.register(req.user.tenantId, workspaceId, req.user.id, req.user.displayName, body, this.scope(req));
  }

  @Post(":id/confirm")
  confirm(@Req() req: StaffPaymentRequest, @Param("id") id: string) {
    const workspaceId = getRequestWorkspaceId();
    if (!workspaceId) throw new ForbiddenException("缺少已驗證的经营空间");
    return this.payments.confirm(req.user.tenantId, workspaceId, req.user.id, req.user.displayName, id, this.scope(req));
  }

  private scope(req: StaffPaymentRequest) {
    return req.staffLocationScope ?? { mode: "selected" as const, locationIds: [] };
  }
}
