import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RentalCategoryTerminology, RentalDocumentRenderResult, RentalDocumentType } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { RentalFundingService } from "./rental-funding.service";
import { RentalCoreService } from "./rental-core.service";
import { renderRentalDocument } from "./rental-document-renderer";

const DOCUMENT_TYPES = new Set<RentalDocumentType>(["quote", "delivery", "return", "settlement"]);

@Injectable()
export class RentalDocumentService {
  constructor(
    private readonly core: RentalCoreService,
    private readonly funding: RentalFundingService,
    @Optional() private readonly prisma?: PrismaService
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
    const rendered = renderRentalDocument({
      documentType: type,
      order,
      inspections,
      templates,
      funding,
      terminology: options.terminology,
      timeZone: this.core.getBusinessSettings(tenantId).calendar.timeZone,
      snapshotAt: new Date().toISOString()
    });

    // 没有 Prisma 的纯内存单元场景仍允许复用渲染器；真实 API 有数据库时，
    // 凭证必须先归档再返回，避免后续订单变更把历史凭证静默改写。
    if (!this.prisma) return rendered;

    const workspaceId = this.core.resolveWorkspaceId(tenantId);
    const where = {
      tenantId,
      workspaceId,
      orderId,
      documentType: type,
      contentHash: rendered.contentHash
    };
    const existing = await this.prisma.rentalOrderDocumentSnapshot.findUnique({
      where: { tenantId_workspaceId_orderId_documentType_contentHash: where }
    });
    if (existing) return this.fromPersisted(existing);

    try {
      const created = await this.prisma.rentalOrderDocumentSnapshot.create({
        data: {
          tenantId,
          workspaceId,
          orderId,
          documentType: rendered.documentType,
          templateCode: rendered.templateCode,
          documentNo: rendered.documentNo,
          sourceOrderUpdatedAt: new Date(rendered.sourceOrderUpdatedAt),
          snapshotAt: new Date(rendered.snapshotAt),
          contentHash: rendered.contentHash,
          snapshot: rendered.snapshot as Prisma.InputJsonValue,
          html: rendered.html
        }
      });
      return this.fromPersisted(created);
    } catch (error) {
      // 两个请求可能同时首次打开同一份凭证；唯一键只允许一个写入，
      // 另一个重新读同一版本，不能向调用方暴露 500 或生成两个历史版本。
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const concurrent = await this.prisma.rentalOrderDocumentSnapshot.findUnique({
        where: { tenantId_workspaceId_orderId_documentType_contentHash: where }
      });
      if (!concurrent) throw error;
      return this.fromPersisted(concurrent);
    }
  }

  private fromPersisted(row: {
    id: string;
    documentType: string;
    templateCode: string;
    documentNo: string;
    sourceOrderUpdatedAt: Date;
    snapshotAt: Date;
    snapshot: unknown;
    html: string;
    contentHash: string;
  }): RentalDocumentRenderResult {
    return {
      snapshotId: row.id,
      documentType: row.documentType as RentalDocumentType,
      templateCode: row.templateCode as `${RentalDocumentType}-v1`,
      title: typeof row.snapshot === "object" && row.snapshot && "title" in row.snapshot
        ? String((row.snapshot as { title?: unknown }).title ?? row.documentType)
        : row.documentType,
      documentNo: row.documentNo,
      sourceOrderUpdatedAt: row.sourceOrderUpdatedAt.toISOString(),
      snapshotAt: row.snapshotAt.toISOString(),
      snapshot: row.snapshot as Record<string, unknown>,
      html: row.html,
      contentHash: row.contentHash
    };
  }
}
