/** 原Rental附件引用存在性核对。当前业务读取/写入权限由原受控入口及文件ACL分别裁定。 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { RentalFileReferenceStorage } from "./file-access-ports";

export class RentalFileBusinessReferences {
  constructor(private readonly prisma: RentalFileReferenceStorage) {}

  async assertExists(tenantId: string, businessType: string, businessId: string, workspaceId?: string) {
    const id = businessId.trim();
    const type = businessType.trim().toLowerCase();
    let exists: boolean;
    switch (type) {
      case "rental_order":
      case "order":
        exists = Boolean(await this.prisma.rentalOrder.findFirst({ where: { id, tenantId, ...(workspaceId ? { workspaceId } : {}) }, select: { id: true } }));
        break;
      case "rental_quote":
      case "quote":
        exists = Boolean(await this.prisma.rentalQuote.findFirst({ where: { id, tenantId, ...(workspaceId ? { workspaceId } : {}) }, select: { id: true } }));
        break;
      case "rental_item_group":
      case "item_group":
        exists = Boolean(await this.prisma.rentalItemGroup.findFirst({ where: { id, tenantId, ...(workspaceId ? { workspaceId } : {}) }, select: { id: true } }));
        break;
      case "rental_asset":
      case "asset":
        exists = Boolean(await this.prisma.rentalAsset.findFirst({ where: { id, tenantId, ...(workspaceId ? { workspaceId } : {}) }, select: { id: true } }));
        break;
      case "rental_work_order":
      case "work_order":
        exists = Boolean(await this.prisma.rentalWorkOrder.findFirst({ where: { id, tenantId, ...(workspaceId ? { workspaceId } : {}) }, select: { id: true } }));
        break;
      case "customer":
      case "customer_profile":
        // 客户和资质附件属于租户共享主档，不以来源空间或会员状态授权。
        // 客户端的 owner 在入口固定为本人；操作员敏感资料权限仍由 guard 负责。
        exists = Boolean(await this.prisma.customerProfile.findFirst({ where: { id, tenantId }, select: { id: true } }));
        break;
      case "customer_contract":
      case "corporate_contract":
        exists = Boolean(await this.prisma.customerCorporateContract.findFirst({ where: { id, tenantId }, select: { id: true } }));
        break;
      case "customer_invoice_profile":
      case "invoice_profile":
        exists = Boolean(await this.prisma.customerCorporateInvoiceProfile.findFirst({ where: { id, tenantId }, select: { id: true } }));
        break;
      case "customer_credit":
      case "credit":
        exists = Boolean(await this.prisma.customerCorporateCredit.findFirst({ where: { id, tenantId }, select: { id: true } }));
        break;
      case "membership_review": {
        const review = await this.prisma.customerMembershipReview.findFirst({ where: { id, tenantId }, select: { customerId: true, sourceWorkspaceId: true } });
        // 来源空间仅保留审计来源，不限制租户内共享审核资料；但来源与客户不能跨租户。
        exists = Boolean(review
          && await this.prisma.customerProfile.findFirst({ where: { id: review.customerId, tenantId }, select: { id: true } })
          && (!review.sourceWorkspaceId || await this.prisma.businessWorkspace.findFirst({ where: { id: review.sourceWorkspaceId, tenantId }, select: { id: true } })));
        break;
      }
      case "async_job":
        exists = Boolean(await this.prisma.asyncJob.findFirst({ where: { id, tenantId }, select: { id: true } }));
        break;
      case "document_print_job":
        exists = Boolean(await this.prisma.documentPrintJob.findFirst({ where: { id, tenantId }, select: { id: true } }));
        break;
      default:
        throw new BadRequestException(`文件业务类型未登记引用校验规则：${businessType}`);
    }
    if (!exists) throw new NotFoundException("文件关联的业务对象不存在或不属于当前租户");
  }
}
