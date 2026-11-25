/** 在调用方原事务读取统一期限，锁租户的调用方负责串行化；不读取行业目录或改变排期。 */
import { NotFoundException } from "@nestjs/common";
import { SubscriptionServiceStatus } from "@rental-os/platform-contracts/subscription";
import type { SubscriptionTermRow, SubscriptionSegmentRow } from "./subscription-state";
import { deriveSubscriptionStatus, projectSubscriptionState, subscriptionReminderDays } from "./subscription-state";

export interface PublicSubscriptionReader {
  tenant: { findUnique(query: { where: { id: string }; select: { subscription: true;
    subscriptionSegments: { where: { status: "SCHEDULED" } } } }): PromiseLike<{
      subscription: SubscriptionTermRow | null;
      subscriptionSegments: SubscriptionSegmentRow[];
    } | null> };
}

export async function readPublicSubscriptionTerm(transaction: PublicSubscriptionReader, tenantId: string, now = new Date()) {
  const row = await transaction.tenant.findUnique({ where: { id: tenantId }, select: { subscription: true,
    subscriptionSegments: { where: { status: "SCHEDULED" } } } });
  if (!row) throw new NotFoundException("租户不存在");
  const state = projectSubscriptionState(row.subscription, row.subscriptionSegments, now,
    segment => ({ startAt: segment.startAt, endAt: segment.endAt }));
  const serviceStatus = deriveSubscriptionStatus(state.current, now, () => subscriptionReminderDays().normal);
  return { serviceStatus, revision: state.current?.revision ?? 0,
    // 原存量未配置/待确认保持兼容；只停止已明确到期的新业务，不解释为永久期限。
    newBusinessAllowed: serviceStatus !== SubscriptionServiceStatus.Expired,
    startAt: state.current?.startAt?.toISOString(), endAt: state.current?.endAt?.toISOString() };
}
