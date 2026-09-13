import { Controller, Post, Query, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { RentalCoreService } from "../rental-core/rental-core.service";
import { PaymentRuntimeService } from "./payment.runtime.service";

interface AuthenticatedRequest { user: SystemUserRow; }

/** 运营端支付/退款主动对账入口；不接受客户端传入 workspaceId。 */
@Controller("rental/v1")
export class PaymentReconciliationController {
  constructor(
    private readonly payments: PaymentRuntimeService,
    private readonly core: RentalCoreService
  ) {}

  @Post("payment-reconciliation")
  reconcile(@Req() req: AuthenticatedRequest, @Query("limit") limit?: string) {
    const parsed = Number(limit ?? 50);
    return this.payments.reconcileCurrentWorkspace(
      req.user.tenantId,
      this.core.resolveWorkspaceId(req.user.tenantId),
      Number.isFinite(parsed) ? parsed : 50
    );
  }
}
