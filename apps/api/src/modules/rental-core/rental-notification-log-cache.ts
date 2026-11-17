/** 原通知缓存读取适配，供给既有维护策略与删除账的实际读取器。
 * 收据品牌和正文剥离只由Rental同一实现产生；不创建第二份缓存或清理任务。 */
import { readNotificationDraftCacheLog as readCoreCacheLog, type Source, type Cipher } from "@rental-os/rental-core/notification-log-cache";
import type { RentalNotificationSendLogV1 } from "@rental-os/shared";
import { createNotificationDraftBodyRetentionReader, notificationDraftRetentionState, notificationDraftRetentionReceiptId } from "../ai-native/privacy/retention-notification-draft";
export { isVerifiedNotificationDraftCacheLog } from "@rental-os/rental-core/notification-log-cache";
export { isNotificationDraftCacheLog, stripNotificationDraftCacheBody } from "@rental-os/rental-core/notification-snapshot";
export const rentalNotificationDraftRetention = Object.freeze({
  state: notificationDraftRetentionState, receiptId: notificationDraftRetentionReceiptId, createReader: createNotificationDraftBodyRetentionReader
});
export function readNotificationDraftCacheLog(database: Source, cipher: Cipher, owner: { tenantId: string; workspaceId: string }, cached: RentalNotificationSendLogV1) {
  return readCoreCacheLog(database, cipher, owner, cached, rentalNotificationDraftRetention);
}
