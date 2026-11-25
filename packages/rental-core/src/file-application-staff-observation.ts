/** 员工上传原键观察，复验可信身份、地点ACL和原文件事实，返回已有操作收据。 */
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import Ajv from "ajv";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { CreateFileUploadSessionRequest } from "@rental-os/platform-contracts/files";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { FileStorageOwner, FileStoragePrimitives } from "@rental-os/platform-server/files";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { RentalFileBusinessAccessService } from "./file-business-access";
import { STAFF_UPLOAD_OBSERVATION_SCHEMAS, type StaffUploadObservationRequest,
  type StaffUploadObservationResponse, type StaffUploadObservedSession } from "./staff-upload-observation";

type JsonRecord = Record<string, unknown>;
const fileFactHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));

const validStaffObservation = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false })
  .compile<StaffUploadObservationRequest>(STAFF_UPLOAD_OBSERVATION_SCHEMAS.StaffUploadObservationRequest);
/** Detach the original body before awaiting authority and validate every supplied owner or selector field. */
export function parseStaffUploadObservation(value: unknown): StaffUploadObservationRequest {
  try {
    const input = structuredClone(value);
    if (Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8') <= 8192 && validStaffObservation(input)) {
      if ('idempotencyKey' in input.reference) {
        // The raw UTF-16 length stays bounded before trimming so a lost create
        // response remains findable by its original upload key.
        const original = input.reference.idempotencyKey;
        if (original.length > 191 || !original.trim()) throw new Error('Invalid original upload key');
        input.reference.idempotencyKey = original.trim();
      }
      return input;
    }
  } catch { /* A malformed descriptor is not an upload observation. */ }
  throw new BadRequestException('原上传会话引用或文件描述无效');
}

interface RentalStaffUploadObservationPorts {
  parseStaffUploadObservation(value: unknown): StaffUploadObservationRequest;
  validateInput: FileStoragePrimitives["validateInput"];
  matchesOwner: FileStoragePrimitives["matchesOwner"];
  matchesUploadRequest(asset: Prisma.FileAssetGetPayload<object>, input: CreateFileUploadSessionRequest, mimeType: string): boolean;
}

export class RentalStaffUploadObservation {
  constructor(private readonly prisma: Pick<PrismaClient, "fileAsset" | "fileUploadSession">,
    private readonly fileAccess: Pick<RentalFileBusinessAccessService, "authorityKey" | "assertRead"> | undefined,
    private readonly ports: RentalStaffUploadObservationPorts) {}

  async observeStaffUpload(tenantId: string, value: StaffUploadObservationRequest,
    valueOwner: FileStorageOwner): Promise<StaffUploadObservationResponse> {
    const input = this.ports.parseStaffUploadObservation(value), owner = structuredClone(valueOwner), access = this.fileAccess;
    const file = { ...input.file, fileName: input.file.fileName.trim(), mimeType: input.file.mimeType.trim().toLowerCase() };
    if (!access || !owner?.workspaceId || !owner.actorUserId || owner.businessType !== file.businessType
      || owner.businessId !== file.businessId || owner.uploadScene !== file.uploadScene
      || (file.uploadScene === 'work-order-evidence') !== (file.businessType === 'rental_work_order')) {
      throw new ForbiddenException('原员工上传观察归属不可用');
    }
    const currentOwner = () => {
      const identity = getRequestIdentity();
      if (!identity || identity.isSaasAdmin || identity.audience !== 'staff' || identity.staffApi !== true
        || identity.tenantId !== tenantId || identity.workspaceId !== owner.workspaceId || identity.userId !== owner.actorUserId) {
        throw new ForbiddenException('原员工上传观察身份已变化');
      }
      return access.authorityKey(tenantId);
    };
    const authority = currentOwner();
    const current = () => { if (currentOwner() !== authority) throw new ForbiddenException('原员工上传观察权限已变化'); };
    const load = async () => {
      current();
      const session = await this.prisma.fileUploadSession.findFirst({ where: 'sessionId' in input.reference
        ? { tenantId, id: input.reference.sessionId } : { tenantId, idempotencyKey: input.reference.idempotencyKey } });
      if (!session) return null;
      const asset = await this.prisma.fileAsset.findFirst({ where: { tenantId, id: session.fileAssetId } });
      const metadata = asset?.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
        ? asset.metadata as JsonRecord : null;
      // A tenant-wide unique-key hit must not disclose another employee's or
      // workspace's upload, even when its business object is otherwise visible.
      if (!asset || !metadata || asset.uploadedBy !== owner.actorUserId || metadata.workspaceId !== owner.workspaceId
        || metadata.source !== 'staff-miniprogram') return null;
      const mimeType = this.ports.validateInput({ ...file, idempotencyKey: session.idempotencyKey ?? '' });
      if (!this.ports.matchesOwner(asset, owner) || !this.ports.matchesUploadRequest(asset, { ...file, idempotencyKey: session.idempotencyKey ?? '' }, mimeType)
        || session.tenantId !== tenantId || asset.tenantId !== tenantId || session.fileAssetId !== asset.id
        || session.provider !== asset.storageProvider || session.storageKey !== asset.storageKey
        || ('sessionId' in input.reference ? session.id !== input.reference.sessionId : session.idempotencyKey !== input.reference.idempotencyKey)) {
        throw new ConflictException('原上传会话与文件描述不一致');
      }
      if (['pickup-evidence', 'return-evidence', 'handover-signature'].includes(file.uploadScene)) {
        const stage = file.uploadScene === 'pickup-evidence' ? 'pickup' : file.uploadScene === 'return-evidence' ? 'return' : file.metadata?.handoverStage;
        if (!stage || !file.metadata?.handoverBatchId || metadata.handoverStage !== stage
          || metadata.handoverBatchId !== file.metadata.handoverBatchId
          || file.metadata.handoverStage !== undefined && file.metadata.handoverStage !== stage) {
          throw new ConflictException('原上传交接阶段或批次不一致');
        }
      }
      // 员工观察沿原只读合同显示待删除，内部排队或unknown不提供重发许可。
      const fileStatus = ['delete_queued', 'delete_in_progress'].includes(asset.status) ? 'delete_pending' : asset.status;
      if (!['pending_upload', 'freeze_pending', 'completed', 'failed'].includes(session.status)
        || !['pending_upload', 'active', 'failed', 'delete_pending', 'deleted'].includes(fileStatus)
        || ['pending_upload', 'freeze_pending'].includes(session.status) && asset.status !== 'pending_upload'
        || session.status === 'completed' && !['active', 'delete_pending', 'deleted'].includes(fileStatus)
        || session.status === 'failed' && !['failed', 'deleted'].includes(asset.status)
        || !(session.expiresAt instanceof Date) || !Number.isFinite(session.expiresAt.getTime())
        || session.completedAt != null && (!(session.completedAt instanceof Date) || !Number.isFinite(session.completedAt.getTime()))) {
        throw new ServiceUnavailableException('原上传状态暂不可核对');
      }
      return { session, asset, fileStatus };
    };
    const before = structuredClone(await load());
    if (before) await access.assertRead(tenantId, before.asset);
    current();
    const after = await load();
    if (fileFactHash(before) !== fileFactHash(after)) throw new ConflictException('原上传观察期间记录已变化');
    if (after) await access.assertRead(tenantId, after.asset);
    current();
    const semantics = { reference: structuredClone(input.reference), descriptionHash: requestFingerprint(file),
      observation: 'stored_metadata_not_transfer_proof' as const, retryable: false as const,
      uploadGrant: 'not_provided' as const, nextAction: 'read_original_upload' as const };
    if (!before) return { ...semantics, state: 'not_observed', session: null };
    return { ...semantics, state: 'observed', session: {
      sessionId: before.session.id, fileAssetId: before.asset.id,
      status: before.session.status as StaffUploadObservedSession['status'],
      fileStatus: before.fileStatus as StaffUploadObservedSession['fileStatus'],
      mode: before.session.provider === 'local_mock' ? 'simulation' : 'provider',
      expiresAt: before.session.expiresAt.toISOString(), completedAt: before.session.completedAt?.toISOString() ?? null,
    } };
  }
}
