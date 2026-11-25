/** 订单客户凭证与历史目录的 HTTP 字段。复用正式凭证类型和原归档投影，快照正文保留历史结构。 */
import type { RentalDocumentRenderResult, RentalDocumentSnapshotSummary, RentalDocumentType } from "./document-contracts";
import { objectOf, objectSchema, ref, stringSchema, type SchemaObject } from "./http-openapi-contract";

export const RENTAL_ORDER_DOCUMENT_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  RentalDocumentType: {
    type: "string",
    enum: ["quote", "delivery", "return", "settlement"] satisfies RentalDocumentType[],
    description: "原订单凭证类型，分别为报价单、交付清单、归还检查单和结算对账单。"
  },
  RentalDocumentRenderResult: {
    ...objectOf({
      snapshotId: { type: "string", description: "已归档的不可变版本 ID。原纯内存调用可省略，客户端沿原归档状态决定预览、下载和打印。" },
      documentType: ref("RentalDocumentType"),
      templateCode: { type: "string", description: "原渲染或归档的模板标识，历史读取保留原版本值。" },
      title: { type: "string", description: "原凭证标题，历史读取从原快照恢复，缺失时沿原文档类型回落。" },
      documentNo: stringSchema,
      sourceOrderUpdatedAt: stringSchema,
      snapshotAt: { type: "string", description: "原快照时间。同内容重复渲染复用原归档时间。" },
      snapshot: { ...objectSchema, description: "原客户可读快照，保留历史字段和版本结构。结算资金投影沿当前财务权限释放，含资金明细的历史版本由原服务核验读取权限。" },
      html: { type: "string", description: "原服务生成或归档的 HTML 正文，作为 JSON 字段返回。客户端沿原安全预览和打印入口消费。" },
      contentHash: { type: "string", description: "新生成快照的规范化内容采用 SHA-256。历史读取保留原归档摘要。" }
    } satisfies Record<keyof RentalDocumentRenderResult, SchemaObject>, [
      "documentType", "templateCode", "title", "documentNo", "sourceOrderUpdatedAt", "snapshotAt", "snapshot", "html", "contentHash"
    ], false),
    description: "原客户凭证结果。渲染 GET 在原租户、空间、订单、类型和内容摘要唯一键下复用或追加不可变版本。指定版本读取返回原快照、HTML、模板及时间。",
    example: {
      snapshotId: "snapshot_example",
      documentType: "quote",
      templateCode: "quote-v1",
      title: "历史报价单",
      documentNo: "RO-EXAMPLE-quote",
      sourceOrderUpdatedAt: "2026-01-01T01:00:00.000Z",
      snapshotAt: "2026-01-01T01:01:00.000Z",
      snapshot: { title: "历史报价单", summary: { currency: "CNY", finalPayableAmount: 100 } },
      html: "<p>历史报价单</p>",
      contentHash: "cebc7f0710bf5fc1b8f4c1dbce0f182beb8c1108930f4b1558335d4d4e8a3b7a"
    }
  },
  RentalDocumentSnapshotSummary: {
    ...objectOf({
      snapshotId: stringSchema,
      documentType: ref("RentalDocumentType"),
      templateCode: { type: "string", description: "原归档模板标识，保留存量版本。" },
      documentNo: stringSchema,
      sourceOrderUpdatedAt: stringSchema,
      snapshotAt: stringSchema,
      contentHash: stringSchema
    } satisfies Record<keyof RentalDocumentSnapshotSummary, SchemaObject>, [
      "snapshotId", "documentType", "templateCode", "documentNo", "sourceOrderUpdatedAt", "snapshotAt", "contentHash"
    ], false),
    description: "当前订单和空间内的不可变凭证目录项，仅含版本定位与校验字段。列表按快照时间和版本 ID 倒序返回，原无存储场景返回空数组。",
    example: {
      snapshotId: "snapshot_example",
      documentType: "quote",
      templateCode: "quote-v1",
      documentNo: "RO-EXAMPLE-quote",
      sourceOrderUpdatedAt: "2026-01-01T01:00:00.000Z",
      snapshotAt: "2026-01-01T01:01:00.000Z",
      contentHash: "cebc7f0710bf5fc1b8f4c1dbce0f182beb8c1108930f4b1558335d4d4e8a3b7a"
    }
  }
};
