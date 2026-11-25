/** Rental核心服务的宿主接点。只转交实际业务所需能力，不授予HTTP、数据库或跨租户权限。
 * MySQL事务视图仅供私有运行入口；公共Core清单与领域根出口不依赖这些生成模型。
 * 会员、企业支出和授信仍由所属原服务按调用方的同一事务核验。 */
import type { CreateFileUploadSessionRequest, FileAssetSummary, FileDownloadUrlSummary } from "@rental-os/platform-contracts/files";
import type { RentalMembershipSnapshot, RentalOrder, RentalOrderExtension, RentalOrderExtensionRequest, RentalRuleConfig } from "./contracts";
import type { ApprovedOrderBinding } from "./approved-order-transaction.ports";
import type { ApprovedExtensionBinding, EnterpriseExtensionPrice } from "./approved-extension-ports";
import type { RentalQualificationAction, RentalQualificationCheckWindow } from "./qualification";
import type { RentalCoreConfigurationTransaction } from "./core-configuration-storage";
import type { RentalCoreFactTransaction } from "./core-fact-storage";
import type { RentalSnapshotTransaction } from "./state-storage";
import type { RentalCategoryCreationReader } from "./category-runtime";
import type { RentalQuoteCapabilityTransaction } from "./mysql-quote-capabilities";
import type { RentalFundingTransaction } from "./funding-storage";
import type { RentalServiceCapacityTransaction } from "./service-capacity-storage";

export type RentalCoreRuntimeTransaction = RentalCoreConfigurationTransaction & RentalCoreFactTransaction
  & RentalSnapshotTransaction & RentalFundingTransaction & RentalServiceCapacityTransaction
  & RentalCategoryCreationReader & RentalQuoteCapabilityTransaction;

export interface RentalCoreMemberships<TTransaction> {
  hasOpenRiskForBooking(tenantId: string, workspaceId: string,
    snapshot: Pick<RentalMembershipSnapshot, "personalCustomerId" | "corporateCustomerId">,
    transaction?: TTransaction): Promise<boolean>;
  assertBookingQualificationForAction(tenantId: string, workspaceId: string,
    snapshot: RentalMembershipSnapshot | undefined, rule: RentalRuleConfig["qualification"],
    action: RentalQualificationAction, window: RentalQualificationCheckWindow,
    transaction?: TTransaction, delegatedBinding?: Readonly<ApprovedOrderBinding>): Promise<unknown>;
}

export interface RentalCoreEnterprisePolicies<TTransaction> {
  assertOrderAction(tenantId: string, workspaceId: string, order: RentalOrder,
    transaction: TTransaction | undefined, additionalAmount?: number): Promise<unknown>;
  /** 返回原批准的请求和试算，仅在已核当前政策/审核人及原消费关联后存在。 */
  assertExtensionAction(tenantId: string, workspaceId: string, order: RentalOrder,
    priced: EnterpriseExtensionPrice | RentalOrderExtension, transaction: TTransaction,
    binding?: ApprovedExtensionBinding): Promise<{ request: RentalOrderExtensionRequest; preview: EnterpriseExtensionPrice } | undefined>;
}

export interface RentalCoreCorporateSettlement<TTransaction> {
  allowsExtensionCredit(tenantId: string, orderId: string, transaction?: TTransaction): Promise<boolean>;
  reserveExtensionCredit(tenantId: string, orderId: string, extensionId: string, amount: number,
    transaction: TTransaction, operator?: string): Promise<unknown>;
  releaseReducedOrderCredit(tenantId: string, workspaceId: string, orderId: string,
    source: { kind: "change" | "fee_review" | "extension_refund"; id: string },
    transaction: TTransaction, operator?: string): Promise<unknown>;
}

export interface RentalCoreExtensionPrices<TTransaction> {
  quoteEnterpriseExtension(tenantId: string, order: RentalOrder, previousExtensions: RentalOrderExtension[],
    input: RentalOrderExtensionRequest, settlementMode: "immediate" | "monthly",
    transaction: TTransaction): Promise<EnterpriseExtensionPrice>;
}

/** 只描述原型号图片拥有者，不携带知识ACL或企业身份来扩大文件访问范围。 */
export interface RentalCoreItemGroupFileOwner {
  businessType: "item_group";
  businessId: string;
  uploadScene: "item-group-image";
  workspaceId?: string;
}

export interface RentalCoreFileStorage {
  hasEnabledProvider(tenantId: string): Promise<boolean>;
  uploadBuffer(tenantId: string, input: CreateFileUploadSessionRequest, content: Buffer,
    owner?: RentalCoreItemGroupFileOwner): Promise<Pick<FileAssetSummary, "id">>;
  downloadUrl(tenantId: string, fileAssetId: string,
    owner?: RentalCoreItemGroupFileOwner): Promise<Pick<FileDownloadUrlSummary, "downloadUrl">>;
  deleteFileAsset(tenantId: string, fileAssetId: string, owner?: RentalCoreItemGroupFileOwner): Promise<unknown>;
}
