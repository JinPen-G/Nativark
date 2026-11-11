/** Dedicated pre-execution image sources and exact original upload observation.
 * No preparation acceptance, customer consent, reservation or exchange execution. */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE, type CreateRentalExchangeInspectionMediaRequest, type CreateRentalExchangeInspectionMediaResult,
  type RentalExchangeInspectionMediaSource, type RentalExchangeInspectionMediaOriginal, type RentalExchangeInspectionRequirementsRequest, type SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { FileStorageRuntimeService, type FileBusinessOwner } from "../integrations/file-storage.runtime.service";
import { RentalExchangeInspectionPreparationService } from "./rental-exchange-inspection-preparation.service";
import { requestFingerprint } from "./rental-idempotency.repository";
import { exchangeInspectionFileKey, readExchangeInspectionMedia, readExchangeInspectionMediaBinding,
  readExchangeInspectionMediaClaim, type ExchangeInspectionMediaBinding, type ExchangeInspectionMediaRow } from "./rental-exchange-inspection-media.read";

type Binding = ExchangeInspectionMediaBinding;
type Row = ExchangeInspectionMediaRow;
const keyPattern = /^[A-Za-z0-9_-]{1,128}$/u;
@Injectable()
export class RentalExchangeInspectionMediaService {
  constructor(private readonly prisma: PrismaService, private readonly inspections: RentalExchangeInspectionPreparationService, private readonly files: FileStorageRuntimeService) {}
  private input(input: CreateRentalExchangeInspectionMediaRequest) {
    if (!input || Object.keys(input).some(key => !["expectedOrderUpdatedAt", "exchange", "operationKey", "requirementsHash", "side", "templateId", "templateVersion", "fieldCode", "fileName", "mimeType", "sizeBytes"].includes(key))
      || !keyPattern.test(input.operationKey) || !/^[a-f0-9]{64}$/u.test(input.requirementsHash) || !["original_return", "replacement_pickup"].includes(input.side)
      || [input.templateId, input.templateVersion, input.fieldCode, input.fileName].some(value => typeof value !== "string" || !value.trim() || value.length > 180)
      || !keyPattern.test(input.fieldCode) || ["__proto__", "constructor", "prototype"].includes(input.fieldCode)
      || !["image/png", "image/jpeg"].includes(input.mimeType) || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > 20 * 1024 * 1024) throw new BadRequestException("专用检查影像声明无效");
    return structuredClone(input);
  }
  private async rows(tx: Prisma.TransactionClient, scope: { tenantId: string; workspaceId: string; userId: string }, key: string) {
    const rows = await tx.$queryRaw<Row[]>`SELECT * FROM rental_exchange_inspection_media WHERE tenantId=${scope.tenantId} AND workspaceId=${scope.workspaceId} AND actorUserId=${scope.userId} AND operationKey=${key}`;
    if (rows.some(row => row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId || row.actorUserId !== scope.userId || row.operationKey !== key)) throw new ConflictException("原影像键与当前受权范围不一致");
    return rows;
  }
  private binding(row: Row, orderId: string): Binding {
    return readExchangeInspectionMediaBinding(row, orderId);
  }
  private owner(row: Row): FileBusinessOwner { return { businessType: "rental_order", businessId: row.orderId, uploadScene: RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE,
    workspaceId: row.workspaceId, actorUserId: row.actorUserId, exchangeInspectionSourceId: row.id }; }
  private claim(row: Row) {
    return readExchangeInspectionMediaClaim(row);
  }
  private async view(row: Row, orderId: string, tx: Prisma.TransactionClient): Promise<RentalExchangeInspectionMediaSource> {
    return readExchangeInspectionMedia(row, orderId, tx);
  }
  private fileKey(actorUserId: string, workspaceId: string, key: string) { return exchangeInspectionFileKey(actorUserId, workspaceId, key); }
  async requirements(authorization: string | undefined, actor: SystemUserRow, orderId: string, input: RentalExchangeInspectionRequirementsRequest) {
    if (!input || Object.keys(input).some(key => !["expectedOrderUpdatedAt", "exchange"].includes(key))) throw new BadRequestException("影像要求请求字段无效");
    return this.prisma.$transaction(tx => this.inspections.mediaRequirementsInTransaction(authorization, actor, orderId, input, tx), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async original(authorization: string | undefined, actor: SystemUserRow, orderId: string, key: string): Promise<RentalExchangeInspectionMediaOriginal> {
    if (!keyPattern.test(key)) throw new BadRequestException("原影像键无效");
    return this.prisma.$transaction(async tx => {
      const { scope } = await this.inspections.mediaOrder(authorization, actor, orderId, tx), row = (await this.rows(tx, scope, key))[0];
      const result: RentalExchangeInspectionMediaOriginal = row ? { state: "observed", source: await this.view(row, orderId, tx), retryable: false } : { state: "not_recorded", retryable: false };
      await this.inspections.mediaScope(authorization, actor); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async create(authorization: string | undefined, actor: SystemUserRow, orderId: string, input: CreateRentalExchangeInspectionMediaRequest): Promise<CreateRentalExchangeInspectionMediaResult> {
    const body = this.input(input), scope = await this.inspections.mediaScope(authorization, actor), hash = requestFingerprint({ orderId, actorUserId: scope.userId, input: body });
    const before = await this.original(authorization, actor, orderId, body.operationKey);
    if (before.state === "observed") {
      if (before.source.requestHash !== hash) throw new ConflictException("原影像键已用于不同声明，不能重发");
      return before;
    }
    const id = randomUUID(), owner: FileBusinessOwner = { businessType: "rental_order", businessId: orderId, uploadScene: RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE,
      workspaceId: scope.workspaceId, actorUserId: scope.userId, exchangeInspectionSourceId: id };
    const plan = await this.files.planExchangeInspectionUpload(scope.tenantId, { businessModule: "rental-core", businessType: "rental_order", businessId: orderId,
      fileName: body.fileName, mimeType: body.mimeType, sizeBytes: body.sizeBytes, uploadScene: RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE, idempotencyKey: this.fileKey(scope.userId, scope.workspaceId, body.operationKey) }, owner);
    const result = await this.prisma.$transaction(async tx => {
      const { scope: current } = await this.inspections.mediaOrder(authorization, actor, orderId, tx), existing = (await this.rows(tx, current, body.operationKey))[0];
      if (existing) {
        if (existing.requestHash !== hash) throw new ConflictException("原影像键已用于不同声明，不能重发");
        return { state: "observed" as const, source: await this.view(existing, orderId, tx), retryable: false as const };
      }
      const requirements = await this.inspections.mediaRequirementsInTransaction(authorization, actor, orderId, body, tx);
      const template = requirements.templates.find(row => row.side === body.side && row.template.id === body.templateId && row.template.version === body.templateVersion);
      if (requirements.requirementsHash !== body.requirementsHash || requestFingerprint(requirements.exchange) !== requestFingerprint(body.exchange)
        || !template || template.template.fields.filter(field => field.code === body.fieldCode && field.type === "photo").length !== 1) throw new ConflictException("影像不属于当前原检查要求和照片字段");
      await this.files.persistExchangeInspectionUpload(tx, current.tenantId, plan);
      const source: RentalExchangeInspectionMediaSource = { ...body, id, orderId, workspaceId: current.workspaceId, actorUserId: current.userId, requestHash: hash,
        sessionId: plan.sessionId, fileAssetId: plan.assetId, createdAt: new Date().toISOString(), expiresAt: plan.expiresAt.toISOString(), state: "pending_upload", preparationUse: "not_connected", retryable: false };
      const binding: Binding = { source, requirements, provider: plan.provider, storageKey: plan.storageKey, configRowHash: plan.configRowHash, storageLocationHash: plan.storageLocationHash };
      await tx.$executeRaw`INSERT INTO rental_exchange_inspection_media (tenantId,workspaceId,actorUserId,orderId,operationKey,id,requestHash,binding,bindingHash) VALUES (${current.tenantId},${current.workspaceId},${current.userId},${orderId},${body.operationKey},${id},${hash},${JSON.stringify(binding)},${requestFingerprint(binding)})`;
      await this.inspections.mediaScope(authorization, actor);
      return { source, uploadUrl: plan.uploadUrl, uploadHeaders: plan.uploadHeaders };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await this.inspections.mediaScope(authorization, actor); return result;
  }
  async complete(authorization: string | undefined, actor: SystemUserRow, orderId: string, key: string): Promise<RentalExchangeInspectionMediaOriginal> {
    if (!keyPattern.test(key)) throw new BadRequestException("原影像键无效");
    const initial = await this.prisma.$transaction(async tx => {
      const { scope, order } = await this.inspections.mediaOrder(authorization, actor, orderId, tx), row = (await this.rows(tx, scope, key))[0];
      if (!row) throw new NotFoundException("原影像上传不存在");
      const source = await this.view(row, orderId, tx);
      if (source.state !== "pending_upload") {
        await this.inspections.mediaScope(authorization, actor); return { row, source, dispatchedClaim: undefined };
      }
      if (order.updatedAt !== source.expectedOrderUpdatedAt) throw new ConflictException("原订单修订已变化，保留原影像待核对");
      const claimId = randomUUID(), claimedAt = new Date();
      const updated = await tx.$executeRaw`UPDATE rental_exchange_inspection_media SET completionClaimId=${claimId}, completionClaimedAt=${claimedAt}
        WHERE tenantId=${scope.tenantId} AND workspaceId=${scope.workspaceId} AND actorUserId=${scope.userId} AND operationKey=${key}
        AND orderId=${orderId} AND bindingHash=${row.bindingHash} AND completion IS NULL AND completionHash IS NULL
        AND completionClaimId IS NULL AND completionClaimedAt IS NULL AND ${new Date(source.expiresAt)} > CURRENT_TIMESTAMP(3)`;
      if (updated !== 1) throw new ConflictException("原影像完成占用需核对，不能再次派发");
      const claimedRow: Row = { ...row, completionClaimId: claimId, completionClaimedAt: claimedAt };
      await this.inspections.mediaScope(authorization, actor);
      return { row: claimedRow, source, dispatchedClaim: this.claim(claimedRow) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    // Only this invocation's acknowledged claim can read staging or PUT once.
    // An existing frozen destination may be observed under the original claim;
    // no TTL, missing acknowledgement or absent target authorizes another write.
    if (initial.source.state === "completed") return { state: "observed", source: initial.source, retryable: false };
    const dispatchedClaim = initial.dispatchedClaim ?? this.claim(initial.row);
    if (!dispatchedClaim) return { state: "observed", source: initial.source, retryable: false };
    await this.inspections.mediaScope(authorization, actor);
    const binding = this.binding(initial.row, orderId);
    const proof = initial.dispatchedClaim
      ? await this.files.inspectExchangeInspectionUpload(initial.row.tenantId, initial.source.fileAssetId, this.owner(initial.row), binding.configRowHash, binding.storageLocationHash)
      : await this.files.reconcileExchangeInspectionUpload(initial.row.tenantId, initial.source.fileAssetId, this.owner(initial.row), binding.configRowHash, binding.storageLocationHash);
    if (!proof) return { state: "observed", source: initial.source, retryable: false };
    await this.inspections.mediaScope(authorization, actor);
    return this.prisma.$transaction(async tx => {
      const { scope, order } = await this.inspections.mediaOrder(authorization, actor, orderId, tx), row = (await this.rows(tx, scope, key))[0];
      const claim = row && this.claim(row);
      if (!row || claim?.id !== dispatchedClaim.id || claim.at !== dispatchedClaim.at
        || row.bindingHash !== initial.row.bindingHash) throw new ConflictException("原影像完成占用在核验期间已变化");
      const source = await this.view(row, orderId, tx);
      if (source.state === "completed") {
        await this.inspections.mediaScope(authorization, actor); return { state: "observed", source, retryable: false };
      }
      // Raw rows contain Dates: compare their stored JSON facts, not Date's empty enumerable keys.
      if (requestFingerprint(JSON.parse(JSON.stringify(row))) !== requestFingerprint(JSON.parse(JSON.stringify(initial.row))))
        throw new ConflictException("原影像绑定在核验期间已变化");
      if (order.updatedAt !== binding.source.expectedOrderUpdatedAt) throw new ConflictException("原订单修订已变化，保留原影像待核对");
      const completion = await this.files.completeExchangeInspectionUpload(tx, scope.tenantId, binding.source.fileAssetId, this.owner(row), proof);
      const updated = await tx.$executeRaw`UPDATE rental_exchange_inspection_media SET completion=${JSON.stringify(completion)}, completionHash=${requestFingerprint(completion)} WHERE tenantId=${scope.tenantId} AND workspaceId=${scope.workspaceId} AND actorUserId=${scope.userId} AND operationKey=${key} AND bindingHash=${row.bindingHash}
        AND completionClaimId=${dispatchedClaim.id} AND completionClaimedAt=${new Date(dispatchedClaim.at)} AND completion IS NULL AND completionHash IS NULL`;
      if (updated !== 1) throw new ConflictException("原影像完成结果需核对");
      const committedSource = await this.view({ ...row, completion, completionHash: requestFingerprint(completion) }, orderId, tx);
      await this.inspections.mediaScope(authorization, actor);
      return { state: "observed", source: committedSource, retryable: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
