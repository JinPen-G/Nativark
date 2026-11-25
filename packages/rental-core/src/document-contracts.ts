/** Rental客户凭证与不可变历史目录的唯一公开合同；业务/财务释放仍由原服务端裁定。 */
/**
 * DOC-PRINT-01：订单客户凭证的服务端渲染类型。
 *
 * 这四类凭证只允许读取订单已经固化的业务事实；它们不是发票、电子签章或法定票据。
 * 服务端先统一输出这个结果，管理端和后续 APP 可以复用同一份脱敏快照，避免各端
 * 各自重新拼接订单字段后出现口径漂移。
 */
export type RentalDocumentType = "quote" | "delivery" | "return" | "settlement";

export interface RentalDocumentRenderResult {
  /** 已落库的不可变凭证快照 ID；无数据库的纯内存调用可为空。 */
  snapshotId?: string;
  documentType: RentalDocumentType;
  templateCode: `${RentalDocumentType}-v1`;
  title: string;
  documentNo: string;
  sourceOrderUpdatedAt: string;
  snapshotAt: string;
  /** 不包含规则、成本、权限、证件或完整资金流水的客户可读快照。 */
  snapshot: Record<string, unknown>;
  /** HTML 仅供预览/打印，不代表正式 PDF 或法定票据。 */
  html: string;
  /** 对 snapshot 做规范化 JSON 后的 SHA-256，便于客户端确认同一订单事实的重生成结果。 */
  contentHash: string;
}

/**
 * DOC-PRINT-01：不可变凭证历史的目录项。
 *
 * 历史列表只返回版本定位和校验信息，不把 HTML 或快照正文混在列表响应里；
 * 读取正文必须再按当前订单、空间和权限读取指定 snapshotId。
 */
export interface RentalDocumentSnapshotSummary {
  snapshotId: string;
  documentType: RentalDocumentType;
  templateCode: `${RentalDocumentType}-v1`;
  documentNo: string;
  sourceOrderUpdatedAt: string;
  snapshotAt: string;
  contentHash: string;
}
