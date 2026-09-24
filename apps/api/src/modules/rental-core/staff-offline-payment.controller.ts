import { Body, Controller, Get, Param, Post, Query, Req, ForbiddenException } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { getRequestWorkspaceId } from "../../common/request-identity";
import { CreateStaffOfflinePaymentDto } from "./staff-offline-payment.dto";
import { StaffOfflinePaymentService } from "./staff-offline-payment.service";

interface StaffPaymentRequest {
  user: SystemUserRow;
  staffLocationScope?: { mode: "all" | "selected"; locationIds: string[] };
}

@Controller("staff/v1/offline-payments")
export class StaffOfflinePaymentController {
  constructor(private readonly payments: StaffOfflinePaymentService) {}

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
