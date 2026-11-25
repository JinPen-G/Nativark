import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UploadedFile, UseInterceptors, Inject } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { RENTAL_HTTP_CORE, type RentalHttpApplications } from "./http-applications";
import { RENTAL_PAYMENT_HTTP, type RentalPaymentHttpApplication } from "./http-payment-applications";
import type { UploadedPaymentStatement } from "./mysql-payment-reconciliation-file";
import type { RentalPaymentStatementHttpApplication } from "./http-payment-applications";
import { ReviewPaymentStatementLineDto } from "./http-payment-reconciliation-file.dto";

interface AuthenticatedRequest { user: SystemUserRow; }

/** 运营端支付/退款主动对账入口；不接受客户端传入 workspaceId。 */
@Controller("rental/v1")
export class PaymentReconciliationController {
  constructor(
    @Inject(RENTAL_PAYMENT_HTTP.runtime) private readonly payments: RentalPaymentHttpApplication,
    @Inject(RENTAL_HTTP_CORE) private readonly core: Pick<RentalHttpApplications["core"], "resolveWorkspaceId">,
    @Inject(RENTAL_PAYMENT_HTTP.statements) private readonly statements: RentalPaymentStatementHttpApplication
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
    if (!provider?.trim()) throw new BadRequestException("请选择支付平台");
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
