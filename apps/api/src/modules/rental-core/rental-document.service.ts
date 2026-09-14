import { BadRequestException, Injectable } from "@nestjs/common";
import type { RentalCategoryTerminology, RentalDocumentRenderResult, RentalDocumentType } from "@rental-os/shared";
import { RentalFundingService } from "./rental-funding.service";
import { RentalCoreService } from "./rental-core.service";
import { renderRentalDocument } from "./rental-document-renderer";

const DOCUMENT_TYPES = new Set<RentalDocumentType>(["quote", "delivery", "return", "settlement"]);

@Injectable()
export class RentalDocumentService {
  constructor(
    private readonly core: RentalCoreService,
    private readonly funding: RentalFundingService
  ) {}

  /**
   * DOC-PRINT-01：从当前会话空间的订单事实生成客户可读凭证。
   *
   * 订单、检查记录和资金明细均由各自已有的空间边界查询取得；这里不接受客户端
   * 传入 workspaceId，也不回读会变化的商品、价格、规则或会员主档。正式 PDF/文件
   * 归档仍由后续 provider/渲染器切片承接，本方法先把所有客户端共用的快照口径收口。
   */
  async render(
    tenantId: string,
    orderId: string,
    documentType: string,
    options: { includeFinancial: boolean; terminology?: RentalCategoryTerminology }
  ): Promise<RentalDocumentRenderResult> {
    if (!DOCUMENT_TYPES.has(documentType as RentalDocumentType)) {
      throw new BadRequestException("不支持的订单凭证类型");
    }
    const type = documentType as RentalDocumentType;
    const order = await this.core.getOrder(tenantId, orderId);
    const [inspections, templates] = await Promise.all([
      this.core.listInspections(tenantId, orderId),
      Promise.resolve(this.core.listInspectionTemplates(tenantId))
    ]);
    const funding = type === "settlement" && options.includeFinancial
      ? await this.funding.listEvents(tenantId, this.core.resolveWorkspaceId(tenantId), orderId)
      : undefined;
    return renderRentalDocument({
      documentType: type,
      order,
      inspections,
      templates,
      funding,
      terminology: options.terminology,
      timeZone: this.core.getBusinessSettings(tenantId).calendar.timeZone,
      snapshotAt: new Date().toISOString()
    });
  }
}
