/** 换货检查的私有MySQL、当前身份和文件参加者。
 * 宿主提供原事务及受权依赖；这里只开放本链所需方法，存储凭据留在文件适配内。
 * 原上传计划按TPlan完整传回同一适配，不由Core复制或重建供应商配置。 */
import type { Sql } from "@prisma/client/runtime/library";
import type { Buffer } from "node:buffer";
import type { CreateFileUploadSessionRequest, SystemUserRow } from "@rental-os/platform-contracts";
import type { OrganizationScopeNode } from "@rental-os/platform-server/organization-location-scope";
import type { RentalOrder, RentalOrderChangePreview, RentalInspectionTemplate } from "./contracts";
import type { RentalExchangeInspectionIntent, RentalExchangeInspectionMediaSource } from "./exchange-inspection-preparation";
import type { RentalBusinessTenantTransaction } from "./mysql-business-fence";
import type { RentalIdempotentActionService } from "./mysql-idempotent-actions";
import type { RentalExchangeInspectionPreparationService } from "./mysql-exchange-inspection-preparation";

/** 只读取原文件与会话关联，不取得上传票据、对象字节或其他业务文件。 */
export interface RentalExchangeInspectionFileAsset {
  id: string;
  tenantId: string;
  businessModule: string;
  businessType: string | null;
  businessId: string | null;
  uploadScene: string | null;
  uploadedBy: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  storageKey: string;
  checksum: string | null;
  metadata: unknown;
  status: string;
  uploadSession: {
    id: string;
    tenantId: string;
    fileAssetId: string;
    provider: string;
    storageKey: string;
    status: string;
    expiresAt: Date;
    idempotencyKey: string | null;
    completedAt: Date | null;
  } | null;
}

export interface RentalExchangeInspectionMediaReader {
  fileAsset: {
    findFirst(input: {
      where: { id: string; tenantId: string };
      include: { uploadSession: true };
    }): PromiseLike<RentalExchangeInspectionFileAsset | null>;
  };
}

/** 原检查表SQL与文件关联读视图，仅用于调用方已经取得的同一事务。 */
export interface RentalExchangeInspectionTransaction extends RentalBusinessTenantTransaction, RentalExchangeInspectionMediaReader {
  $queryRaw<TResult>(query: Sql | TemplateStringsArray, ...values: unknown[]): PromiseLike<TResult>;
  $executeRaw(query: Sql | TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
}

export interface RentalExchangeInspectionStorage<TTransaction> {
  $transaction<TResult>(
    run: (transaction: TTransaction) => Promise<TResult>,
    options: { isolationLevel: "ReadCommitted" }
  ): PromiseLike<TResult>;
}

export interface RentalExchangeInspectionPreparationStorage<TTransaction> extends RentalExchangeInspectionStorage<TTransaction> {
  organizationUnit: {
    findMany(input: {
      where: { tenantId: string };
      select: { id: true; parentId: true; status: true };
    }): PromiseLike<OrganizationScopeNode[]>;
  };
  rentalFulfillmentLocation: {
    findMany(input: {
      where: { tenantId: string; workspaceId: string; organizationId: { in: string[] } };
      select: { id: true };
    }): PromiseLike<Array<{ id: string }>>;
  };
}

export interface RentalExchangeInspectionCore<TTransaction> {
  lockOrderForUpdate(tenantId: string, orderId: string, transaction: TTransaction): PromiseLike<RentalOrder>;
  listInspectionTemplates(
    tenantId: string, stage?: "pickup" | "return", order?: RentalOrder, transaction?: TTransaction
  ): PromiseLike<RentalInspectionTemplate[]>;
}

export interface RentalExchangeInspectionPrices<TTransaction> {
  preview(
    tenantId: string, orderId: string, input: RentalExchangeInspectionIntent, transaction?: TTransaction
  ): PromiseLike<{ preview: RentalOrderChangePreview }>;
}

export interface RentalExchangeInspectionAuthority {
  resolveAccessContext(authorization: string | undefined, options: { audience: "operator" }): PromiseLike<{
    user: SystemUserRow;
    workspaceId?: string;
    workspaceValid: boolean;
  } | undefined>;
}

export type RentalExchangeInspectionIdempotent<TTransaction extends RentalBusinessTenantTransaction> =
  Pick<RentalIdempotentActionService<TTransaction>, "executeInTransaction">;

export type RentalExchangeInspectionConsentIdempotent<TTransaction extends RentalBusinessTenantTransaction> =
  Pick<RentalIdempotentActionService<TTransaction>, "executeInTransaction" | "readReceipt">;

/** 原客户认证给出的必要投影；调用方的完整上下文仍按原对象保留。 */
export interface RentalExchangeInspectionCustomerContext {
  tenantId: string;
  workspaceId: string;
  workspaceCode: string;
  customerId: string;
  customerType: "personal" | "corporate";
  membershipStatus: string;
  sessionId: string;
}

export interface RentalExchangeInspectionCustomerAuthority {
  authenticate(token: string): PromiseLike<RentalExchangeInspectionCustomerContext>;
}

export interface RentalExchangeInspectionPhoto {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg";
  contentHash: string;
  sizeBytes: number;
}

/** 只能读取已接受的原冻结照片，不能读取暂存内容或取得存储凭据。 */
export interface RentalExchangeInspectionEvidenceFiles {
  readFrozenExchangeInspectionEvidence(
    tenantId: string, fileAssetId: string, owner: RentalExchangeInspectionFileOwner, contentHash: string
  ): PromiseLike<RentalExchangeInspectionPhoto>;
}

export type RentalExchangeInspectionPreparation<TTransaction extends RentalExchangeInspectionTransaction> =
  Pick<RentalExchangeInspectionPreparationService<TTransaction>, "mediaScope" | "mediaOrder" | "mediaRequirementsInTransaction">;

export interface RentalExchangeInspectionFileOwner {
  businessType: "rental_order";
  businessId: string;
  uploadScene: string;
  workspaceId: string;
  actorUserId: string;
  exchangeInspectionSourceId: string;
}

/** 文件服务返回的必要计划投影；TPlan保留实现额外需要的私有配置。 */
export interface RentalExchangeInspectionUploadPlan {
  assetId: string;
  sessionId: string;
  expiresAt: Date;
  provider: string;
  storageKey: string;
  configRowHash: string;
  storageLocationHash: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
}

export interface RentalExchangeInspectionFileProof {
  sourceId: string;
  contentHash: string;
  sizeBytes: number;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  assetHash: string;
  sessionHash: string;
  configRowHash: string;
  storageLocationHash: string;
}

export interface RentalExchangeInspectionFiles<TTransaction, TPlan extends RentalExchangeInspectionUploadPlan> {
  planExchangeInspectionUpload(tenantId: string, input: CreateFileUploadSessionRequest, owner: RentalExchangeInspectionFileOwner): PromiseLike<TPlan>;
  persistExchangeInspectionUpload(transaction: TTransaction, tenantId: string, plan: TPlan): PromiseLike<unknown>;
  inspectExchangeInspectionUpload(tenantId: string, fileAssetId: string, owner: RentalExchangeInspectionFileOwner,
    configRowHash: string, storageLocationHash: string): PromiseLike<RentalExchangeInspectionFileProof>;
  reconcileExchangeInspectionUpload(tenantId: string, fileAssetId: string, owner: RentalExchangeInspectionFileOwner,
    configRowHash: string, storageLocationHash: string): PromiseLike<RentalExchangeInspectionFileProof | undefined>;
  completeExchangeInspectionUpload(transaction: TTransaction, tenantId: string, fileAssetId: string,
    owner: RentalExchangeInspectionFileOwner, proof: RentalExchangeInspectionFileProof): PromiseLike<NonNullable<RentalExchangeInspectionMediaSource["completion"]>>;
}
