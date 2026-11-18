/** 员工附件 HTTP 入口，沿原 Guard 的空间与地点核验业务归属，委托原文件和检查权威。 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, HttpCode, Inject, Optional, Param, Post, Req, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { IsObject } from "class-validator";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type {
  CompleteFileUploadRequest, CreateFileUploadSessionRequest, FileAssetSummary, FileDownloadUrlSummary, FileUploadSessionSummary
} from "@rental-os/platform-contracts/files";
import { CompleteFileUploadDto, CreateFileUploadSessionDto } from "@rental-os/platform-server/file-dto";
import type { FileStorageOwner } from "@rental-os/platform-server/files";
import { getRequestWorkspaceId } from "@rental-os/platform-server/request-identity";
import {
  STAFF_UPLOAD_OBSERVATION_HTTP, type StaffUploadObservationRequest, type StaffUploadObservationResponse
} from "./staff-upload-observation";

export const RENTAL_STAFF_UPLOADS_DATABASE = Symbol("RENTAL_STAFF_UPLOADS_DATABASE");
export const RENTAL_STAFF_UPLOADS_STORAGE = Symbol("RENTAL_STAFF_UPLOADS_STORAGE");
export const RENTAL_STAFF_UPLOAD_OBSERVATION_PARSER = Symbol("RENTAL_STAFF_UPLOAD_OBSERVATION_PARSER");
export const RENTAL_STAFF_INSPECTION_EVIDENCE = Symbol("RENTAL_STAFF_INSPECTION_EVIDENCE");

export type RentalStaffUploadsDatabase = Pick<PrismaClient, "fileAsset" | "fileUploadSession" | "rentalOrder" | "rentalWorkOrder">;
export type RentalStaffUploadObservationParser = (value: unknown) => StaffUploadObservationRequest;

export interface RentalStaffUploadsStorage {
  createUploadSession(tenantId: string, input: CreateFileUploadSessionRequest, owner: FileStorageOwner): Promise<FileUploadSessionSummary>;
  completeUpload(tenantId: string, sessionId: string, input: CompleteFileUploadRequest, owner: FileStorageOwner): Promise<FileAssetSummary>;
  observeStaffUpload(tenantId: string, input: StaffUploadObservationRequest, owner: FileStorageOwner): Promise<StaffUploadObservationResponse>;
  downloadUrl(tenantId: string, fileAssetId: string, owner: FileStorageOwner): Promise<FileDownloadUrlSummary>;
}

export interface RentalStaffInspectionEvidence {
  bind(value: unknown): Promise<{ attachmentId: string; attachmentRevision: number }>;
}

export class StaffUploadObservationDto implements StaffUploadObservationRequest {
  @IsObject() reference!: StaffUploadObservationRequest["reference"];
  @IsObject() file!: StaffUploadObservationRequest["file"];
}

interface StaffUploadRequest {
  user: SystemUserRow;
  body?: unknown;
  staffLocationScope?: { mode: "all" | "selected"; locationIds: string[] };
}

interface StaffInspectionTarget {
  orderId: string;
  allocationId: string;
  templateId: string;
  stage: "pickup" | "return";
}

const SCENE_PERMISSION: Record<string, string[]> = {
  "pickup-evidence": ["rental-os:order:pickup"],
  "return-evidence": ["rental-os:order:return"],
  "handover-signature": ["rental-os:order:pickup", "rental-os:order:return"],
  "work-order-evidence": ["rental-core:maintenance:manage"],
  "offline-payment-proof": ["rental-os:order:offline-payment"]
};

@Controller(STAFF_UPLOAD_OBSERVATION_HTTP.basePath)
export class StaffUploadsController {
  constructor(
    @Inject(RENTAL_STAFF_UPLOADS_DATABASE) private readonly prisma: RentalStaffUploadsDatabase,
    @Inject(RENTAL_STAFF_UPLOADS_STORAGE) private readonly storage: RentalStaffUploadsStorage,
    @Inject(RENTAL_STAFF_UPLOAD_OBSERVATION_PARSER) private readonly parseStaffUploadObservation: RentalStaffUploadObservationParser,
    @Optional() @Inject(RENTAL_STAFF_INSPECTION_EVIDENCE) private readonly inspectionEvidence?: RentalStaffInspectionEvidence
  ) {}

  @Post(":fileAssetId/inspection-binding")
  async bindInspectionEvidence(@Req() req: StaffUploadRequest, @Param("fileAssetId") fileAssetId: string, @Body() body: StaffInspectionTarget) {
    const workspaceId = getRequestWorkspaceId();
    if (!workspaceId) throw new ForbiddenException("缺少已验证的经营空间");
    if (!this.inspectionEvidence) throw new ServiceUnavailableException("检查草稿证据绑定未启用");
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId: req.user.tenantId, uploadedBy: req.user.id, status: "active" } });
    if (!asset) throw new ForbiddenException("附件不存在或不属于当前员工");
    this.assertPermission(req.user, this.scenePermission(asset.uploadScene, asset.businessType));
    await this.assertOwnerInScope(req, asset.businessType, asset.businessId ?? "", workspaceId, asset.uploadScene, this.metadataRecord(asset.metadata));
    return this.inspectionEvidence.bind({ ...body, attachmentId: fileAssetId });
  }

  @Post("sessions")
  async createSession(@Req() req: StaffUploadRequest, @Body() body: CreateFileUploadSessionDto) {
    const permission = this.scenePermission(body.uploadScene, body.businessType);
    this.assertPermission(req.user, permission);
    if (body.businessModule !== "rental-core") throw new BadRequestException("员工上传只允许绑定租赁业务数据");
    const workspaceId = getRequestWorkspaceId();
    if (!workspaceId) throw new ForbiddenException("缺少已验证的经营空间");
    const ownerContext = await this.assertOwnerInScope(req, body.businessType, body.businessId, workspaceId, body.uploadScene, body.metadata);
    const metadata = this.evidenceMetadata(body.uploadScene, body.metadata, ownerContext);
    const owner: FileStorageOwner = {
      businessType: body.businessType,
      businessId: body.businessId,
      uploadScene: body.uploadScene,
      workspaceId,
      actorUserId: req.user.id,
      actorName: req.user.displayName
    };
    return this.storage.createUploadSession(req.user.tenantId, { ...body, metadata: { ...(body.metadata ?? {}), ...metadata, source: "staff-miniprogram" } }, owner);
  }

  @Post("sessions/:id/complete")
  async completeSession(@Req() req: StaffUploadRequest, @Param("id") id: string, @Body() body: CompleteFileUploadDto) {
    const workspaceId = getRequestWorkspaceId();
    if (!workspaceId) throw new ForbiddenException("缺少已验证的经营空间");
    const session = await this.prisma.fileUploadSession.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: { fileAsset: true }
    });
    if (!session || session.fileAsset.uploadedBy !== req.user.id) throw new ForbiddenException("上傳會話不存在或不屬於當前員工");
    const asset = session.fileAsset;
    this.assertPermission(req.user, this.scenePermission(asset.uploadScene, asset.businessType));
    await this.assertOwnerInScope(req, asset.businessType, asset.businessId ?? "", workspaceId, asset.uploadScene, this.metadataRecord(asset.metadata));
    return this.storage.completeUpload(req.user.tenantId, id, body, {
      businessType: asset.businessType,
      businessId: asset.businessId ?? "",
      uploadScene: asset.uploadScene,
      workspaceId,
      actorUserId: req.user.id,
      actorName: req.user.displayName
    });
  }

  @Post(STAFF_UPLOAD_OBSERVATION_HTTP.observe)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  async observeSession(@Req() req: StaffUploadRequest, @Body() body: StaffUploadObservationDto) {
    // Inspect the original body as well as the DTO: global whitelist must not
    // erase a caller-supplied owner/selector into a valid closed request.
    const input = this.parseStaffUploadObservation(Object.prototype.hasOwnProperty.call(req, 'body') ? req.body : body);
    const file = input.file, workspaceId = getRequestWorkspaceId();
    if (!workspaceId) throw new ForbiddenException('缺少已验证的经营空间');
    this.assertPermission(req.user, this.scenePermission(file.uploadScene, file.businessType));
    const locations = await this.assertOwnerInScope(req, file.businessType, file.businessId, workspaceId, file.uploadScene, file.metadata);
    this.evidenceMetadata(file.uploadScene, file.metadata, locations);
    const result = await this.storage.observeStaffUpload(req.user.tenantId, input, {
      businessType: file.businessType, businessId: file.businessId, uploadScene: file.uploadScene,
      workspaceId, actorUserId: req.user.id,
    });
    this.assertPermission(req.user, this.scenePermission(file.uploadScene, file.businessType));
    await this.assertOwnerInScope(req, file.businessType, file.businessId, workspaceId, file.uploadScene, file.metadata);
    if (workspaceId !== getRequestWorkspaceId()) throw new ForbiddenException('原上传观察期间经营空间已变化');
    return result;
  }

  @Get(":fileAssetId/download-url")
  async downloadUrl(@Req() req: StaffUploadRequest, @Param("fileAssetId") fileAssetId: string) {
    const workspaceId = getRequestWorkspaceId();
    if (!workspaceId) throw new ForbiddenException("缺少已验证的经营空间");
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileAssetId, tenantId: req.user.tenantId, status: "active" } });
    if (!asset) throw new ForbiddenException("文件不存在或尚未完成上传");
    this.assertPermission(req.user, this.scenePermission(asset.uploadScene, asset.businessType));
    await this.assertOwnerInScope(req, asset.businessType, asset.businessId ?? "", workspaceId, asset.uploadScene, this.metadataRecord(asset.metadata));
    return this.storage.downloadUrl(req.user.tenantId, asset.id, {
      businessType: asset.businessType,
      businessId: asset.businessId ?? "",
      uploadScene: asset.uploadScene,
      workspaceId
    });
  }

  private scenePermission(scene: string, businessType: string) {
    const permissions = SCENE_PERMISSION[scene];
    const expectedType = scene === "work-order-evidence" ? "rental_work_order" : "rental_order";
    if (!permissions || businessType !== expectedType) throw new BadRequestException("员工上传场景与业务对象不匹配");
    return permissions;
  }

  private assertPermission(user: SystemUserRow, permissions: string[]) {
    if (user.isPlatformAdmin || user.permissions.includes("*") || permissions.some((permission) => user.permissions.includes(permission))) return;
    throw new ForbiddenException("当前员工没有该场景的凭证权限");
  }

  private async assertOwnerInScope(req: StaffUploadRequest, businessType: string, businessId: string, workspaceId: string, uploadScene?: string, metadata?: Record<string, unknown>) {
    const scope = req.staffLocationScope;
    const locationIds = scope?.mode === "selected" ? scope.locationIds : undefined;
    if (scope?.mode === "selected" && !locationIds?.length) throw new ForbiddenException("员工地点范围未就绪，已拒绝访问");
    if (businessType === "rental_order") {
      const stage = uploadScene === "pickup-evidence" ? "pickup" : uploadScene === "return-evidence" ? "return" : uploadScene === "handover-signature" ? metadata?.handoverStage : undefined;
      const locationScope = !locationIds ? {} : stage === "pickup"
        ? { fulfillmentLocationId: { in: locationIds } }
        : stage === "return"
          ? { OR: [{ returnLocationId: { in: locationIds } }, { returnLocationId: null, fulfillmentLocationId: { in: locationIds } }] }
          : { OR: [{ fulfillmentLocationId: { in: locationIds } }, { returnLocationId: { in: locationIds } }] };
      const row = await this.prisma.rentalOrder.findFirst({
        where: {
          id: businessId,
          tenantId: req.user.tenantId,
          workspaceId,
          ...locationScope
        }, select: { fulfillmentLocationId: true, returnLocationId: true, fulfillmentLocationName: true, returnLocationName: true }
      });
      if (!row) throw new ForbiddenException("订单不存在或不在当前员工授权地点范围内");
      return {
        fulfillmentLocationId: row.fulfillmentLocationId,
        returnLocationId: row.returnLocationId ?? row.fulfillmentLocationId,
        fulfillmentLocationName: row.fulfillmentLocationName,
        returnLocationName: row.returnLocationName ?? row.fulfillmentLocationName
      };
    }
    if (businessType === "rental_work_order") {
      const row = await this.prisma.rentalWorkOrder.findFirst({
        where: { id: businessId, tenantId: req.user.tenantId, workspaceId, ...(locationIds ? { locationId: { in: locationIds } } : {}) },
        select: { locationId: true }
      });
      if (!row) throw new ForbiddenException("工单不存在或不在当前员工授权地点范围内");
      return { fulfillmentLocationId: row.locationId, returnLocationId: row.locationId };
    }
    throw new BadRequestException("员工附件必须绑定订单或工单");
  }

  private metadataRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  }

  private evidenceMetadata(scene: string, input: Record<string, unknown> | undefined, locations: { fulfillmentLocationId: string; returnLocationId: string; fulfillmentLocationName?: string; returnLocationName?: string }) {
    if (!["pickup-evidence", "return-evidence", "handover-signature"].includes(scene)) return {};
    const handoverStage = input?.handoverStage;
    const expectedStage = scene === "pickup-evidence" ? "pickup" : scene === "return-evidence" ? "return" : handoverStage;
    const handoverBatchId = typeof input?.handoverBatchId === "string" ? input.handoverBatchId.trim() : "";
    if ((expectedStage !== "pickup" && expectedStage !== "return") || !handoverBatchId) {
      throw new BadRequestException("交接照片必须绑定有效阶段和交接批次");
    }
    if (handoverStage !== undefined && handoverStage !== expectedStage) throw new BadRequestException("照片场景与交接阶段不一致");
    return {
      handoverStage: expectedStage,
      handoverBatchId,
      handoverLocationId: expectedStage === "pickup" ? locations.fulfillmentLocationId : locations.returnLocationId,
      handoverLocationName: expectedStage === "pickup" ? locations.fulfillmentLocationName : locations.returnLocationName ?? locations.fulfillmentLocationName
    };
  }
}
