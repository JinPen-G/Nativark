/** 原员工上传接入公共文件应用的真实参加者。仅接五组固定业务场景，沿原Auth主体锁、ALS、地点/阶段与文件ACL复验。
 * 原StaffController继续裁定路由、观察原键和检查绑定；其他普通/历史文件由原兼容入口处理。 */
import { BadRequestException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { CompleteFileUploadRequest } from "@rental-os/platform-contracts/files";
import { frozenFileContentHash } from "@rental-os/platform-contracts/file-content-binding";
import { FileStorageApplication, type FileStorageApplicationParticipants, type FileStorageAuthority, type FileStorageBinding, type FileStorageOwner, type FileUploadAuthorityContext, type FileAssetAuthorityContext } from "@rental-os/platform-server/files";
import { PlatformOperationLogService, type OperationLogInput } from "@rental-os/platform-server/operation-log";
import { getRequestIdentity, runWithRequestIdentity, type RequestIdentity } from "@rental-os/platform-server/request-identity";
import { resolveUserBusinessLocationScope } from "./business-location-scope";
import type { RentalFileBusinessAccessService } from "./file-business-access";
import { assertRentalBusinessTenantAccessAfterLock, hasRentalBusinessTenantFence } from "./mysql-business-fence";

/** 宿主为同一事务提供原会话的主体锁和复验。 */
export interface RentalFileWorkspaceAuthority {
  lockRequestWorkspaceAccess(tx: Prisma.TransactionClient): Promise<{
    user: SystemUserRow;
    revalidate(): Promise<SystemUserRow>;
  }>;
}

const STAFF_FILE_SCENES = [
  { scene: "pickup-evidence", type: "rental_order", permissions: ["rental-os:order:pickup"] },
  { scene: "return-evidence", type: "rental_order", permissions: ["rental-os:order:return"] },
  { scene: "handover-signature", type: "rental_order", permissions: ["rental-os:order:pickup", "rental-os:order:return"] },
  { scene: "offline-payment-proof", type: "rental_order", permissions: ["rental-os:order:offline-payment"] },
  { scene: "work-order-evidence", type: "rental_work_order", permissions: ["rental-core:maintenance:manage"] }
] as const;

type StaffIdentity = RequestIdentity & { audience: "staff"; staffApi: true; workspaceId: string;
  permissions: readonly string[]; locationScope: { mode: "all" | "selected"; locationIds: string[] } };

/** 只作固定接线选择。执行权仍由下方原主体与实际领域对象核验。 */
export function isRentalStaffFileBinding(tenantId: string, binding: FileStorageBinding): boolean {
  const actor = getRequestIdentity();
  return actor?.audience === "staff" && actor.staffApi === true && actor.tenantId === tenantId
    && binding.businessModule === "rental-core"
    && STAFF_FILE_SCENES.some(row => row.type === binding.businessType && row.scene === binding.uploadScene);
}

export class RentalFileApplicationParticipant {
  private readonly activeTransactions = new WeakMap<Prisma.TransactionClient, StaffIdentity>();
  readonly authorities: readonly FileStorageAuthority<FileStorageOwner, Prisma.TransactionClient>[];

  constructor(private readonly prisma: Pick<PrismaClient, "$transaction">,
    private readonly auth: RentalFileWorkspaceAuthority,
    private readonly fileAccess: Pick<RentalFileBusinessAccessService, "assertRead">) {
    this.authorities = STAFF_FILE_SCENES.map(row => ({
      binding: { businessModule: "rental-core", businessType: row.type, uploadScene: row.scene },
      authorityKey: tenantId => this.authorityKey(this.staffIdentity(tenantId)),
      isTenantSharedBinding: () => false,
      assertUpload: (context, tx) => this.assertUpload(context, tx),
      assertAsset: (context, tx) => this.assertAsset(context, tx)
    }));
  }

  private staffIdentity(tenantId?: string): StaffIdentity {
    const actor = getRequestIdentity();
    if (!actor?.tenantId || tenantId && actor.tenantId !== tenantId || actor.audience !== "staff" || actor.staffApi !== true
      || actor.isSaasAdmin !== false || !actor.userId || !actor.workspaceId || !actor.dataScope || !Array.isArray(actor.permissions)
      || !actor.accessSession?.sessionId || !Number.isSafeInteger(actor.accessSession.expiresAt)
      || actor.accessSession.expiresAt <= Math.floor(Date.now() / 1000)
      || !actor.locationScope || !["all", "selected"].includes(actor.locationScope.mode) || !Array.isArray(actor.locationScope.locationIds)
      || actor.locationScope.mode === "selected" && !actor.locationScope.locationIds.length)
      throw new ForbiddenException("员工文件当前会话、空间或地点授权未就绪");
    return structuredClone(actor) as StaffIdentity;
  }

  private authorityKey(actor: StaffIdentity): string {
    return requestFingerprint({ tenantId: actor.tenantId, userId: actor.userId, workspaceId: actor.workspaceId,
      audience: actor.audience, staffApi: actor.staffApi, accessSession: actor.accessSession,
      isSaasAdmin: actor.isSaasAdmin, isPlatformAdmin: Boolean(actor.isPlatformAdmin),
      permissions: [...actor.permissions].sort(), dataScope: actor.dataScope, organizationId: actor.organizationId,
      locationScope: { mode: actor.locationScope.mode, locationIds: [...actor.locationScope.locationIds].sort() } });
  }

  private async currentIdentity(user: SystemUserRow, tx: Prisma.TransactionClient, original: StaffIdentity): Promise<StaffIdentity> {
    if (!user.isActive || user.mustChangePassword || user.isSaasAdmin || user.id !== original.userId || user.tenantId !== original.tenantId)
      throw new ForbiddenException("当前员工账号或空间授权已变化");
    // 缺省配置沿Guard已核定的范围作为上限，不能在内部凭空补all或扩大原请求。
    const locationScope = await resolveUserBusinessLocationScope(user, original.workspaceId,
      user.locationScope ?? original.locationScope, tx);
    const current: StaffIdentity = { ...original, permissions: [...user.permissions], isPlatformAdmin: user.isPlatformAdmin,
      dataScope: user.dataScope, organizationId: user.organizationId, locationScope, staffLocationScope: locationScope };
    if (this.authorityKey(current) !== this.authorityKey(original)) throw new ForbiddenException("员工文件授权已变化，请刷新后核对原操作");
    return current;
  }

  /** 每个公共应用事务先锁当前主体，再让应用锁文件配置及业务事实，保持原锁序。 */
  async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, resultOnly = false): Promise<T> {
    const original = this.staffIdentity();
    if (!this.auth?.lockRequestWorkspaceAccess || !this.fileAccess?.assertRead)
      throw new ServiceUnavailableException("员工文件原认证或文件ACL参加者未配置");
    return this.prisma.$transaction(async tx => {
      const lease = await this.auth.lockRequestWorkspaceAccess(tx);
      if (!resultOnly) await assertRentalBusinessTenantAccessAfterLock(tx, original.tenantId);
      const current = await this.currentIdentity(lease.user, tx, original);
      this.activeTransactions.set(tx, current);
      try {
        const consume = async () => {
          const result = await work(tx);
          await this.currentIdentity(await lease.revalidate(), tx, original);
          this.staffIdentity(original.tenantId);
          return result;
        };
        // selected 请求绑定的是原 Guard ALS 实例；相同授权投影也不能替换其身份对象。
        return await (hasRentalBusinessTenantFence() ? consume() : runWithRequestIdentity(current, consume));
      } finally { this.activeTransactions.delete(tx); }
    });
  }

  private async withStaff<T>(tenantId: string, tx: Prisma.TransactionClient | undefined,
    work: (database: Prisma.TransactionClient, actor: StaffIdentity) => Promise<T>, resultOnly = false): Promise<T> {
    if (!tx) return this.transaction(current => this.withStaff(tenantId, current, work), resultOnly);
    const actor = this.activeTransactions.get(tx);
    if (!actor || this.authorityKey(this.staffIdentity(tenantId)) !== this.authorityKey(actor))
      throw new ForbiddenException("员工文件操作缺少原同事务主体授权");
    return work(tx, actor);
  }

  private assertOwner(actor: StaffIdentity, binding: FileStorageBinding & { businessId?: string | null }, owner: FileStorageOwner | undefined,
    requireUploader: boolean) {
    if (!isRentalStaffFileBinding(actor.tenantId, binding) || !owner || owner.workspaceId !== actor.workspaceId
      || owner.businessType !== binding.businessType || owner.businessId !== binding.businessId || owner.uploadScene !== binding.uploadScene
      || requireUploader && owner.actorUserId !== actor.userId)
      throw new ForbiddenException("员工文件业务对象或上传者不属于当前授权");
    const scene = STAFF_FILE_SCENES.find(row => row.type === binding.businessType && row.scene === binding.uploadScene)!;
    if (!actor.isPlatformAdmin && !actor.permissions.includes("*") && !scene.permissions.some(permission => actor.permissions.includes(permission)))
      throw new ForbiddenException("当前员工没有该场景的凭证权限");
  }

  private assertUpload(context: FileUploadAuthorityContext<FileStorageOwner>, tx?: Prisma.TransactionClient): Promise<void> {
    return this.withStaff(context.tenantId, tx, async (database, actor) => {
      this.assertOwner(actor, context.request, context.owner, true);
      // 原主体租约已取 Tenant X，不能在其后重新取 S 再升级。
      await assertRentalBusinessTenantAccessAfterLock(database, actor.tenantId);
      const evidence = await this.uploadMetadata(database, actor, context);
      await this.assertBusinessScope(database, actor, context.request.businessType, context.request.businessId,
        context.request.uploadScene, evidence.metadata, !evidence.original);
    });
  }

  private async uploadMetadata(tx: Prisma.TransactionClient, actor: StaffIdentity, context: FileUploadAuthorityContext<FileStorageOwner>) {
    // 原回执的阶段/批次从同一原键绑定读取，不拿本次payload改写历史证据。
    const session = await tx.fileUploadSession.findFirst({ where: { tenantId: actor.tenantId,
      idempotencyKey: context.request.idempotencyKey.trim() } });
    const asset = session && await tx.fileAsset.findFirst({ where: { id: session.fileAssetId, tenantId: actor.tenantId } });
    if (!asset) return { metadata: context.request.metadata, original: false };
    const request = context.request;
    const metadata = this.metadataRecord(asset.metadata);
    if (asset.businessModule !== request.businessModule.trim() || asset.businessType !== request.businessType.trim() || asset.businessId !== request.businessId.trim()
      || asset.uploadScene !== request.uploadScene.trim() || asset.fileName !== request.fileName.trim() || asset.mimeType !== request.mimeType.trim().toLowerCase()
      || asset.sizeBytes !== request.sizeBytes || asset.uploadedBy !== actor.userId
      || metadata?.workspaceId && metadata.workspaceId !== actor.workspaceId)
      throw new ForbiddenException("员工原上传的文件描述、上传者或空间绑定已变化");
    return { metadata, original: true };
  }

  private assertAsset(context: FileAssetAuthorityContext<FileStorageOwner>, tx?: Prisma.TransactionClient): Promise<void> {
    const resultOnly = context.operation === "complete"
      && (context.asset.status === "active" || Boolean(frozenFileContentHash(context.asset)));
    return this.withStaff(context.tenantId, tx, async (database, actor) => {
      this.assertOwner(actor, context.asset, context.owner, context.operation !== "download");
      const metadata = this.metadataRecord(context.asset.metadata);
      if (context.asset.tenantId !== actor.tenantId || metadata?.workspaceId && metadata.workspaceId !== actor.workspaceId
        || context.operation !== "download" && context.asset.uploadedBy !== actor.userId)
        throw new ForbiddenException("员工文件不属于当前员工或经营空间");
      // 原冻结/完成回执仅归档已派发结果；新占用及读取凭据仍复核当前 Core。
      if (!resultOnly) await assertRentalBusinessTenantAccessAfterLock(database, actor.tenantId);
      await this.assertBusinessScope(database, actor, context.asset.businessType, context.asset.businessId ?? "",
        context.asset.uploadScene, metadata);
      if (context.operation === "download") await this.fileAccess.assertRead(context.tenantId, context.asset, false, database);
    }, resultOnly);
  }

  /** 同一原主体租约内核 Core 与原 ACL 后写成功审计；不把根连接日志算作事务证据。 */
  async recordAudit(input: OperationLogInput) {
    return this.transaction(async tx => {
      const actor = this.staffIdentity(input.tenantId);
      await assertRentalBusinessTenantAccessAfterLock(tx, actor.tenantId);
      if (input.action === "file.download-url.issue") {
        const asset = await tx.fileAsset.findFirst({ where: { id: input.targetId, tenantId: actor.tenantId, status: "active" } });
        if (!asset || !isRentalStaffFileBinding(actor.tenantId, asset)) throw new ForbiddenException("员工文件原读取绑定已变化");
        await this.assertBusinessScope(tx, actor, asset.businessType, asset.businessId ?? "", asset.uploadScene, this.metadataRecord(asset.metadata));
        await this.fileAccess.assertRead(actor.tenantId, asset, false, tx);
      }
      await new PlatformOperationLogService(tx).record(input);
    });
  }

  async assertDispatch() {
    await this.transaction(tx => assertRentalBusinessTenantAccessAfterLock(tx, this.staffIdentity().tenantId));
  }

  private metadataRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  }

  private async assertBusinessScope(tx: Prisma.TransactionClient, actor: StaffIdentity, businessType: string,
    businessId: string, scene: string, metadata: Record<string, unknown> | undefined, validateNewEvidence = false) {
    const locationIds = actor.locationScope.mode === "selected" ? actor.locationScope.locationIds : undefined;
    if (businessType === "rental_work_order") {
      const row = await tx.rentalWorkOrder.findFirst({ where: { id: businessId, tenantId: actor.tenantId,
        workspaceId: actor.workspaceId, ...(locationIds ? { locationId: { in: locationIds } } : {}) }, select: { id: true } });
      if (!row) throw new ForbiddenException("工单不存在或不在当前员工授权地点范围内");
      return;
    }
    const stage = scene === "pickup-evidence" ? "pickup" : scene === "return-evidence" ? "return"
      : scene === "handover-signature" ? metadata?.handoverStage : undefined;
    const locationScope = !locationIds ? {} : stage === "pickup" ? { fulfillmentLocationId: { in: locationIds } }
      : stage === "return" ? { OR: [{ returnLocationId: { in: locationIds } }, { returnLocationId: null, fulfillmentLocationId: { in: locationIds } }] }
      : { OR: [{ fulfillmentLocationId: { in: locationIds } }, { returnLocationId: { in: locationIds } }] };
    const row = await tx.rentalOrder.findFirst({ where: { id: businessId, tenantId: actor.tenantId, workspaceId: actor.workspaceId,
      ...locationScope }, select: { fulfillmentLocationId: true, returnLocationId: true } });
    if (!row) throw new ForbiddenException("订单不存在或不在当前员工授权地点范围内");
    if (validateNewEvidence && ["pickup-evidence", "return-evidence", "handover-signature"].includes(scene)) {
      const batchId = typeof metadata?.handoverBatchId === "string" ? metadata.handoverBatchId.trim() : "";
      if (!batchId || stage !== "pickup" && stage !== "return" || metadata?.handoverStage !== undefined && metadata.handoverStage !== stage)
        throw new BadRequestException("交接照片必须绑定有效阶段和交接批次");
      const locationId = stage === "pickup" ? row.fulfillmentLocationId : row.returnLocationId ?? row.fulfillmentLocationId;
      if (metadata?.handoverLocationId !== locationId) throw new ForbiddenException("交接凭证的原阶段地点已变化，请核对原操作");
    }
  }
}

/** 仅为原员工文件的外部 PUT 接运输前检查；公共冻结算法及其原结果恢复保持单源。 */
export class RentalStaffFileStorageApplication<Owner extends FileStorageOwner>
  extends FileStorageApplication<Owner, Prisma.TransactionClient> {
  private readonly completions: AsyncLocalStorage<{ resultOnly: boolean }>;
  constructor(participants: FileStorageApplicationParticipants<Prisma.TransactionClient>,
    private readonly rental: RentalFileApplicationParticipant) {
    const completions = new AsyncLocalStorage<{ resultOnly: boolean }>();
    super({ ...participants, transaction: work => rental.transaction(work, completions.getStore()?.resultOnly === true) }, rental.authorities);
    this.completions = completions;
    this.readSession = (tenantId, sessionId) => participants.store.fileUploadSession.findFirst({ where: { id: sessionId, tenantId } });
  }

  private readonly readSession: (tenantId: string, sessionId: string) => PromiseLike<{ status: string } | null>;

  override async completeUpload(tenantId: string, sessionId: string, request: CompleteFileUploadRequest, owner?: Owner) {
    const session = await this.readSession(tenantId, sessionId);
    return this.completions.run({ resultOnly: session?.status === "freeze_pending" || session?.status === "completed" },
      () => super.completeUpload(tenantId, sessionId, request, owner));
  }

  protected override async objectRequest(url: string, init: RequestInit) {
    if (init.method === "PUT") {
      await this.rental.assertDispatch();
      // 唯一PUT开始后，公共完成事务只收口原冻结结果；失应答也不会另派发。
      const completion = this.completions.getStore();
      if (completion) completion.resultOnly = true;
    }
    return super.objectRequest(url, init);
  }
}
