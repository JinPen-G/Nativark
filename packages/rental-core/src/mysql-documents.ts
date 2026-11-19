/** Rental凭证生成、不可变归档和历史读取的唯一应用实现；复用当前订单/空间及财务门禁。
 * 不回读当前价格/商品替换历史，不生成法定PDF；生产归档依赖宿主提供原快照表。 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaClientKnownRequestError, type InputJsonValue } from "@prisma/client/runtime/library";
import type { RentalCategoryTerminology } from "./contracts";
import type { RentalDocumentRenderResult, RentalDocumentSnapshotSummary, RentalDocumentType } from "./document-contracts";
import type { RentalDocumentFacts, RentalDocumentFunding, RentalDocumentStorage } from "./document-storage";
export type { RentalDocumentFacts, RentalDocumentFunding, RentalDocumentStorage } from "./document-storage";
import { renderRentalDocument } from "./document-renderer";
import { lockRentalBusinessTenant } from "./mysql-business-fence";

const DOCUMENT_TYPES = new Set<RentalDocumentType>(["quote", "delivery", "return", "settlement"]);

export class RentalDocumentService {
  constructor(
    private readonly core: RentalDocumentFacts,
    private readonly funding: RentalDocumentFunding,
    private readonly prisma?: RentalDocumentStorage
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
    const type = this.assertDocumentType(documentType);
    const order = await this.core.getOrder(tenantId, orderId);
    const [inspections, templates] = await Promise.all([
      this.core.listInspections(tenantId, orderId),
      this.core.listInspectionTemplates(tenantId, undefined, order)
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
      timeZone: (await this.core.getBusinessSettings(tenantId)).calendar.timeZone,
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
    // GET 归档是原有的可重复派生写入。只把唯一键读取和追加移入同一短事务，
    // 不重算先前读取的订单快照；Core 撤权在追加/重复返回之前裁定。
    return this.prisma.$transaction(async tx => {
    await lockRentalBusinessTenant(tx, tenantId);
    const existing = await tx.rentalOrderDocumentSnapshot.findUnique({
      where: { tenantId_workspaceId_orderId_documentType_contentHash: where }
    });
    if (existing) return this.fromPersisted(existing);

    try {
      const created = await tx.rentalOrderDocumentSnapshot.create({
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
          snapshot: rendered.snapshot as InputJsonValue,
          html: rendered.html
        }
      });
      return this.fromPersisted(created);
    } catch (error) {
      // 两个请求可能同时首次打开同一份凭证；唯一键只允许一个写入，
      // 另一个重新读同一版本，不能向调用方暴露 500 或生成两个历史版本。
      if (!(error instanceof PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const concurrent = await tx.rentalOrderDocumentSnapshot.findUnique({
        where: { tenantId_workspaceId_orderId_documentType_contentHash: where }
      });
      if (!concurrent) throw error;
      return this.fromPersisted(concurrent);
    }
    }, { isolationLevel: "ReadCommitted" });
  }

  /**
   * 返回当前订单/空间下的不可变凭证历史目录。
   *
   * 先读取订单是有意的：它复用现有订单空间边界，避免仅凭 snapshotId
   * 枚举或读取另一空间的历史。列表不返回正文，正文由 readSnapshot 单独读取。
   */
  async listSnapshots(
    tenantId: string,
    orderId: string,
    documentType: string
  ): Promise<RentalDocumentSnapshotSummary[]> {
    const type = this.assertDocumentType(documentType);
    await this.core.getOrder(tenantId, orderId);
    if (!this.prisma) return [];
    const workspaceId = this.core.resolveWorkspaceId(tenantId);
    const rows = await this.prisma.rentalOrderDocumentSnapshot.findMany({
      where: { tenantId, workspaceId, orderId, documentType: type },
      orderBy: [{ snapshotAt: "desc" }, { id: "desc" }]
    });
    return rows.map((row) => this.toSummary(row));
  }

  /**
   * 读取指定历史版本。无财务权限的调用方不能通过 snapshotId 取回曾经由财务
   * 账号生成的含资金明细版本；这道检查必须放在服务端，不能交给页面裁剪。
   */
  async readSnapshot(
    tenantId: string,
    orderId: string,
    documentType: string,
    snapshotId: string,
    options: { includeFinancial: boolean }
  ): Promise<RentalDocumentRenderResult> {
    const type = this.assertDocumentType(documentType);
    await this.core.getOrder(tenantId, orderId);
    if (!this.prisma) throw new NotFoundException("历史凭证不存在");
    const workspaceId = this.core.resolveWorkspaceId(tenantId);
    const row = await this.prisma.rentalOrderDocumentSnapshot.findFirst({
      where: { id: snapshotId, tenantId, workspaceId, orderId, documentType: type }
    });
    if (!row) throw new NotFoundException("历史凭证不存在");
    if (!options.includeFinancial && this.containsVisibleFinancial(row.snapshot)) {
      throw new ForbiddenException("当前账号无权读取含资金明细的历史凭证");
    }
    return this.fromPersisted(row);
  }

  private assertDocumentType(documentType: string): RentalDocumentType {
    if (!DOCUMENT_TYPES.has(documentType as RentalDocumentType)) {
      throw new BadRequestException("不支持的订单凭证类型");
    }
    return documentType as RentalDocumentType;
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

  private toSummary(row: {
    id: string;
    documentType: string;
    templateCode: string;
    documentNo: string;
    sourceOrderUpdatedAt: Date;
    snapshotAt: Date;
    contentHash: string;
  }): RentalDocumentSnapshotSummary {
    return {
      snapshotId: row.id,
      documentType: row.documentType as RentalDocumentType,
      templateCode: row.templateCode as `${RentalDocumentType}-v1`,
      documentNo: row.documentNo,
      sourceOrderUpdatedAt: row.sourceOrderUpdatedAt.toISOString(),
      snapshotAt: row.snapshotAt.toISOString(),
      contentHash: row.contentHash
    };
  }

  private containsVisibleFinancial(snapshot: unknown) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
    const financial = (snapshot as { financial?: unknown }).financial;
    return Boolean(financial && typeof financial === "object" && !Array.isArray(financial) && (financial as { visible?: unknown }).visible === true);
  }
}
