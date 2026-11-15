/** 原统一期限的纯投影，供订阅服务和Core准入共用；不修改排期、不计费或授予业务权限。 */
import { SubscriptionServiceStatus } from "@rental-os/platform-contracts/subscription";

export interface SubscriptionTermRow {
  revision: number;
  startAt: Date | null;
  endAt: Date | null;
}

export interface SubscriptionSegmentRow {
  id: string;
  status: string;
  startAt: Date | null;
  endAt: Date | null;
}

export function subscriptionReminderDays() {
  const read = (name: string, fallback: number) => {
    const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
    if (!Number.isInteger(value) || value < 1 || value > 365) throw new Error(`${name} must be an integer from 1 to 365`);
    return value;
  };
  const normal = read("SUBSCRIPTION_REMINDER_NORMAL_DAYS", 30), urgent = read("SUBSCRIPTION_REMINDER_URGENT_DAYS", 7);
  if (urgent > normal) throw new Error("SUBSCRIPTION_REMINDER_URGENT_DAYS must not exceed normal days");
  return { normal, urgent };
}

export function deriveSubscriptionStatus(sub: Pick<SubscriptionTermRow, "startAt" | "endAt"> | null,
  now: Date, normalReminderDays: () => number): SubscriptionServiceStatus {
  if (!sub?.startAt || !sub.endAt) return SubscriptionServiceStatus.Unconfigured;
  if (now < sub.startAt) return SubscriptionServiceStatus.PendingActivation;
  if (now >= sub.endAt) return SubscriptionServiceStatus.Expired;
  return sub.endAt.getTime() - now.getTime() <= normalReminderDays() * 86400000
    ? SubscriptionServiceStatus.Expiring : SubscriptionServiceStatus.Active;
}

export function projectSubscriptionState<Current extends SubscriptionTermRow, Segment extends SubscriptionSegmentRow>(
  sub: Current | null, segments: Segment[], now: Date, apply: (segment: Segment, current: Current) => Partial<Current>) {
  const scheduled = segments.filter(segment => segment.status === "SCHEDULED")
    .sort((a, b) => (a.startAt?.getTime() ?? 0) - (b.startAt?.getTime() ?? 0));
  const due = scheduled.filter(segment => segment.startAt && segment.endAt && segment.startAt <= now);
  const latest = due.at(-1);
  return { current: sub && latest ? { ...sub, ...apply(latest, sub), revision: sub.revision + due.length } : sub,
    next: scheduled.find(segment => segment.startAt && segment.startAt > now) ?? null, due };
}
