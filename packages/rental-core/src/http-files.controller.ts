/** 原文件 HTTP 兼容入口，实名与承运凭证沿 Rental 的对象和范围核验。
 * 当前身份与细粒度许可沿宿主 Guard，文件 ACL 和回执由原应用参加者裁定。 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { CreateFileAssetRequest, FileAssetQuery } from "@rental-os/platform-contracts/files";
import { CompleteFileUploadDto, CreateFileUploadSessionDto } from "@rental-os/platform-server/file-dto";
import { getRequestIdentity, requireRequestWorkspaceId } from "@rental-os/platform-server/request-identity";
import { CreateCarrierEvidenceUploadDto, CreateCustomerIdentityUploadDto } from "./http-file.dto";
import { RENTAL_FILES_LEDGER, RENTAL_FILES_STORAGE, RENTAL_FILES_DATABASE, RENTAL_FILES_CUSTOMER_AUTHORITY } from "./http-file-applications";
import type {
  RentalFileLedgerHttpApplication, RentalFileStorageHttpApplication, RentalFileHttpDatabase, RentalFileCustomerHttpAuthority
} from "./http-file-applications";

interface AuthenticatedRequest { user: SystemUserRow; }

@Controller("files")
export class FilesController {
  constructor(
    @Inject(RENTAL_FILES_LEDGER) private readonly integrationsService: RentalFileLedgerHttpApplication,
    @Inject(RENTAL_FILES_STORAGE) private readonly storage: RentalFileStorageHttpApplication,
    @Inject(RENTAL_FILES_DATABASE) private readonly prisma: RentalFileHttpDatabase,
    @Inject(RENTAL_FILES_CUSTOMER_AUTHORITY) private readonly customerOperations: RentalFileCustomerHttpAuthority
  ) {}

  private async carrierOrderOwner(req: AuthenticatedRequest, orderId: string) {
    const workspaceId = requireRequestWorkspaceId();
    const order = await this.prisma.rentalOrder.findFirst({
      where: { id: orderId, tenantId: req.user.tenantId, workspaceId },
      select: { id: true, fulfillmentMode: true }
    });
    if (!order) throw new NotFoundException("订单不存在或不属于当前经营空间");
    if (order.fulfillmentMode !== "carrier_shipping") throw new BadRequestException("只有承运寄送订单可以上传承运凭证");
    return {
      businessType: "rental_order",
      businessId: order.id,
      uploadScene: "carrier-shipment-evidence",
      workspaceId,
      actorUserId: req.user.id,
      actorName: req.user.displayName
    } as const;
  }

  private assertIdentityAccess(req: AuthenticatedRequest, customerId: string, manage: boolean) {
    return this.customerOperations.assertIdentityVerificationCustomerAccess(req.user.tenantId, customerId, req.user, manage);
  }

  @Get()
  async files(@Query() query: FileAssetQuery) {
    // 通用列表和集成仪表盘共用服务端原业务 ACL，不在控制器维护另一套场景过滤。
    return this.integrationsService.listFiles(query);
  }

  @Post()
  createFile(@Body() body: CreateFileAssetRequest) {
    return this.integrationsService.createFile(body);
  }

  @Post("upload-sessions")
  createUploadSession(@Req() req: AuthenticatedRequest, @Body() body: CreateFileUploadSessionDto) {
    if (body.businessType === "customer" && body.uploadScene === "identity-verification") {
      throw new ForbiddenException("实名凭证必须通过客户专用上传入口，并先校验客户数据范围");
    }
    const identity = getRequestIdentity();
    const workspaceBoundTypes = new Set(["rental_order", "rental_quote", "rental_item_group", "rental_asset", "rental_work_order"]);
    const workspaceId = workspaceBoundTypes.has(body.businessType) ? requireRequestWorkspaceId() : identity?.workspaceId;
    return this.storage.createUploadSession(req.user.tenantId, body, {
      businessType: body.businessType,
      businessId: body.businessId,
      uploadScene: body.uploadScene,
      workspaceId,
      actorUserId: req.user.id,
      actorName: req.user.displayName
    });
  }

  @Post("customer-identity/:customerId/upload-sessions")
  async createCustomerIdentityUploadSession(
    @Req() req: AuthenticatedRequest,
    @Param("customerId") customerId: string,
    @Body() body: CreateCustomerIdentityUploadDto
  ) {
    await this.assertIdentityAccess(req, customerId, true);
    return this.storage.createUploadSession(req.user.tenantId, {
      businessModule: "membership", businessType: "customer", businessId: customerId,
      fileName: body.fileName, mimeType: body.mimeType, sizeBytes: body.sizeBytes,
      uploadScene: "identity-verification", idempotencyKey: body.idempotencyKey
    }, {
      businessType: "customer", businessId: customerId, uploadScene: "identity-verification",
      actorUserId: req.user.id, actorName: req.user.displayName
    });
  }

  @Post("customer-identity/:customerId/upload-sessions/:id/complete")
  async completeCustomerIdentityUpload(
    @Req() req: AuthenticatedRequest,
    @Param("customerId") customerId: string,
    @Param("id") id: string,
    @Body() body: CompleteFileUploadDto
  ) {
    await this.assertIdentityAccess(req, customerId, true);
    return this.storage.completeUpload(req.user.tenantId, id, body, {
      businessType: "customer", businessId: customerId, uploadScene: "identity-verification",
      actorUserId: req.user.id, actorName: req.user.displayName
    });
  }

  @Get("customer-identity/:customerId/:fileAssetId/download-url")
  async customerIdentityDownloadUrl(
    @Req() req: AuthenticatedRequest,
    @Param("customerId") customerId: string,
    @Param("fileAssetId") fileAssetId: string
  ) {
    await this.assertIdentityAccess(req, customerId, false);
    return this.storage.downloadUrl(req.user.tenantId, fileAssetId, {
      businessType: "customer", businessId: customerId, uploadScene: "identity-verification"
    });
  }

  @Post("rental-orders/:orderId/carrier-evidence/upload-sessions")
  async createCarrierEvidenceUploadSession(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: CreateCarrierEvidenceUploadDto
  ) {
    const owner = await this.carrierOrderOwner(req, orderId);
    return this.storage.createUploadSession(req.user.tenantId, {
      businessModule: "rental-core", businessType: owner.businessType, businessId: owner.businessId,
      fileName: body.fileName, mimeType: body.mimeType, sizeBytes: body.sizeBytes,
      uploadScene: owner.uploadScene, idempotencyKey: body.idempotencyKey
    }, owner);
  }

  @Post("rental-orders/:orderId/carrier-evidence/upload-sessions/:id/complete")
  async completeCarrierEvidenceUpload(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Param("id") id: string,
    @Body() body: CompleteFileUploadDto
  ) {
    const owner = await this.carrierOrderOwner(req, orderId);
    return this.storage.completeUpload(req.user.tenantId, id, body, owner);
  }

  @Get("rental-orders/:orderId/carrier-evidence/:fileAssetId/download-url")
  async carrierEvidenceDownloadUrl(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Param("fileAssetId") fileAssetId: string
  ) {
    const owner = await this.carrierOrderOwner(req, orderId);
    return this.storage.downloadUrl(req.user.tenantId, fileAssetId, owner);
  }

  @Post("upload-sessions/:id/complete")
  completeUpload(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CompleteFileUploadDto) {
    const identity = getRequestIdentity();
    return this.storage.completeUpload(req.user.tenantId, id, body, {
      workspaceId: identity?.workspaceId,
      actorUserId: req.user.id,
      actorName: req.user.displayName
    });
  }

  @Post("upload-sessions/cleanup-expired")
  cleanupExpiredUploads(@Req() req: AuthenticatedRequest, @Query("limit") limit?: string) {
    const parsed = Number(limit ?? 50);
    return this.storage.cleanupExpiredUploadSessions(req.user.tenantId, Number.isFinite(parsed) ? parsed : 50);
  }

  @Get(":id/download-url")
  downloadUrl(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.storage.downloadUrl(req.user.tenantId, id);
  }
}
