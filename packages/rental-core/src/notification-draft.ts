/** 未发送通知草稿与原正文保留读取接点。
 * 草稿不授予发送权限；清理策略、删除账与校验仍由宿主的原维护服务裁定。
 * MySQL行类型仅供此私有适配使用，缺原读取器不能补造正文或删除收据。 */
import type { Prisma } from "@prisma/client";
import type { RentalNotificationTemplateV1 } from "./contracts";

export interface RentalNotificationDraftInput {
  customerId: string; templateId: string; templateVersion: string;
  variables: Record<string, string | number | boolean | null>;
}
export interface RentalNotificationDraftOriginal { key: string; actorId: string }
export interface NotificationDraftBodyErasure {
  version: "notification-draft-body-erasure-1"; retention: "erased";
  receiptId: string; policyVersion: string; erasedAt: string; erasedRevision: 2;
}
export interface NotificationDraftBodyRetention {
  state: "erased"; receiptId: string; policyVersion: string; erasedAt: string; erasedRevision: 2;
}
/** 原维护者只按稳定收据ID读取删除账；Rental不持有AI表的写入或迁移权。 */
export interface RentalNotificationErasureReceipt {
  id: string; tenantId: string; workspaceId: string; kind: string; resourceId: string;
  policyVersion: string; targetHash: string; state: string; revision: number; erasedAt: Date | null;
}
export interface RentalNotificationDraftErasureSource {
  /** 没有装配AI维护账时，涉及原AI草稿的读取保持不可用。 */
  readonly aiDataErasure?: {
    findUnique(input: { where: { id: string } }): PromiseLike<RentalNotificationErasureReceipt | null>;
  };
}
export type RentalNotificationDraftObservation = {
  version: "rental-notification-draft-1"; id: string; key: string; actorId: string;
  scope: { tenantId: string; workspaceId: string }; customerId: string; customerVersion: string;
  templateId: string; templateVersion: string; eventCode: string; channel: RentalNotificationTemplateV1["channel"];
  commandHash: string; inputHash: string; templateHash: string; configurationHash: string; contentHash: string;
  provider: "not_dispatched"; attempts: 0;
} & (
  | { recipient: string; renderedTitle: string; renderedBody: string;
      variables: Record<string, string | number | boolean | null>;
      status: "prepared" | "draft"; createdAt: string | null; bodyRetention?: never }
  | { recipient: null; renderedTitle: null; renderedBody: null; variables: null;
      status: "draft"; createdAt: string; bodyRetention: NotificationDraftBodyRetention }
);
export class RentalNotificationDraftUnknownError extends Error {
  readonly code = "NOTIFICATION_DRAFT_RESULT_UNKNOWN"; readonly retryable = false;
  readonly nextAction = "read_original_notification_draft";
  constructor() { super("NOTIFICATION_DRAFT_RESULT_UNKNOWN"); }
}
export type NotificationDraftMetadata = Pick<RentalNotificationDraftObservation, "version" | "id" | "key" | "actorId" | "scope"
  | "customerId" | "customerVersion" | "templateId" | "templateVersion" | "eventCode" | "channel"
  | "commandHash" | "inputHash" | "templateHash" | "configurationHash" | "contentHash"> & { previewHash: string; createdAt: string };
export type RentalNotificationDraftRow = Prisma.RentalNotificationLogGetPayload<object>;
export interface RentalNotificationDraftRetention {
  state(row: RentalNotificationDraftRow): {
    metadata: NotificationDraftMetadata;
    erasure?: NotificationDraftBodyErasure;
    preview?: Record<string, "[已加密保留]" | "" | null>;
  };
  receiptId(owner: { tenantId: string; workspaceId: string }, draftId: string): string;
  createReader(database: RentalNotificationDraftErasureSource): {
    readErasure(row: RentalNotificationDraftRow): Promise<NotificationDraftBodyErasure | null>;
  };
}
