import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { SystemUserRow } from "@rental-os/shared";
import { RentalCoreService } from "../rental-core/rental-core.service";
import { PaymentRuntimeService } from "./payment.runtime.service";
import { PaymentReconciliationFileService, type UploadedPaymentStatement } from "./payment-reconciliation-file.service";
import { ReviewPaymentStatementLineDto } from "./payment-reconciliation-file.dto";

interface AuthenticatedRequest { user: SystemUserRow; }

/** 运营端支付/退款主动对账入口；不接受客户端传入 workspaceId。 */
@Controller("rental/v1")
export class PaymentReconciliationController {
  constructor(
    private readonly payments: PaymentRuntimeService,
    private readonly core: RentalCoreService,
    private readonly statements: PaymentReconciliationFileService
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

  @Post("payment-reconciliation/statements")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  importStatement(
    @Req() req: AuthenticatedRequest,
    @Body("provider") provider: string,
    @UploadedFile() file?: UploadedPaymentStatement
  ) {
    if (!file) throw new BadRequestException("请选择要导入的支付对账文件");
    return this.statements.importStatement(
      req.user.tenantId,
      this.core.resolveWorkspaceId(req.user.tenantId),
      provider,
      file,
      req.user.displayName
    );
  }

  @Get("payment-reconciliation/statements")
  listStatements(@Req() req: AuthenticatedRequest, @Query("limit") limit?: string) {
    const parsed = Number(limit ?? 50);
    return this.statements.listBatches(
      req.user.tenantId,
      this.core.resolveWorkspaceId(req.user.tenantId),
      Number.isFinite(parsed) ? parsed : 50
    );
  }

  @Get("payment-reconciliation/statements/:batchId")
  getStatement(@Req() req: AuthenticatedRequest, @Param("batchId") batchId: string) {
    return this.statements.getBatch(
      req.user.tenantId,
      this.core.resolveWorkspaceId(req.user.tenantId),
      batchId
    );
  }

  @Post("payment-reconciliation/statements/:batchId/lines/:lineId/review")
  reviewStatementLine(
    @Req() req: AuthenticatedRequest,
    @Param("batchId") batchId: string,
    @Param("lineId") lineId: string,
    @Body() body: ReviewPaymentStatementLineDto
  ) {
    return this.statements.reviewLine(
      req.user.tenantId,
      this.core.resolveWorkspaceId(req.user.tenantId),
      batchId,
      lineId,
      body,
      req.user.displayName
    );
  }
}
