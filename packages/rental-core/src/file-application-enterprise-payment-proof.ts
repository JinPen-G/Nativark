/** 企业回款文件的原创建、完成及重放绑定参加者。
 * 专用企业入口提供当前客户、空间与订单依据；公共文件编排负责原会话、冻结摘要和事务提交。 */
import { BadRequestException } from "@nestjs/common";
import type { CreateFileUploadSessionRequest } from "@rental-os/platform-contracts/files";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import { ENTERPRISE_PAYMENT_PROOF_SCENE } from "./enterprise-workflows";
import type { RentalEnterpriseEvidenceOwner } from "./http-enterprise-applications";

type JsonRecord = Record<string, unknown>;
interface PaymentProofFile {
  uploadScene: string;
  metadata?: unknown;
}

// 原持久化依据先按 JSON 规范化，再使用公共指纹；保留历史日期值与缺失字段的比较语义。
const fileFactHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));

export class RentalEnterprisePaymentProofFileParticipant {
  prepareUpload(input: CreateFileUploadSessionRequest, owner?: RentalEnterpriseEvidenceOwner): CreateFileUploadSessionRequest {
    if (input.uploadScene?.trim() === ENTERPRISE_PAYMENT_PROOF_SCENE) {
      if (!owner?.enterprisePaymentProof || owner.enterprisePaymentProof.purpose !== "rental_fee" || owner.enterprisePaymentProof.orderId !== input.businessId
        || !owner.workspaceId || !owner.actorUserId || input.businessModule !== "enterprise" || input.businessType !== "rental_order"
        || owner.uploadScene !== ENTERPRISE_PAYMENT_PROOF_SCENE) throw new BadRequestException("费用回款凭证须经原企业订单专用入口上传");
      input.metadata = { ...input.metadata, enterprisePaymentProof: { ...owner.enterprisePaymentProof } };
    }
    return input;
  }

  assertComplete(asset: PaymentProofFile | null | undefined, owner?: RentalEnterpriseEvidenceOwner): void {
    if (asset?.uploadScene === ENTERPRISE_PAYMENT_PROOF_SCENE && (!owner?.enterprisePaymentProof || owner.uploadScene !== ENTERPRISE_PAYMENT_PROOF_SCENE
      || (asset.metadata as JsonRecord | null)?.workspaceId !== owner.workspaceId
      || fileFactHash((asset.metadata as JsonRecord | null)?.enterprisePaymentProof ?? null) !== fileFactHash(owner.enterprisePaymentProof))) {
      throw new BadRequestException("费用回款凭证只能经原企业订单入口核验归档");
    }
  }

  uploadMetadata(owner?: RentalEnterpriseEvidenceOwner): Record<string, unknown> {
    return owner?.enterprisePaymentProof ? { enterprisePaymentProof: { ...owner.enterprisePaymentProof } } : {};
  }

  matchesUploadRequest(asset: PaymentProofFile, input: CreateFileUploadSessionRequest): boolean {
    return asset.uploadScene !== ENTERPRISE_PAYMENT_PROOF_SCENE
      || fileFactHash((asset.metadata as JsonRecord | null)?.enterprisePaymentProof ?? null) === fileFactHash(input.metadata?.enterprisePaymentProof ?? null);
  }
}
