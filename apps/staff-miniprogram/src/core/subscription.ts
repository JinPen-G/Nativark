import type { StaffSubscriptionContext } from "@rental-os/shared";
import { getSubscriptionContext } from "../api/subscription";
import { serverNow } from "./clock";
import { Emitter } from "./events";
import { ApiError } from "./http";
import { contextVersion, currentSession, sessionEvents } from "./session";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";
import { formatOffset, todayInZone, zoneOffsetMinutes, zoneSupported, zonedParts } from "./time";

/** A request owns both a session/workspace context and a refresh generation. */
export function subscriptionOwner(): string {
  const session = currentSession();
  return session ? JSON.stringify([session.tenant.tenantId, session.user.id, session.currentWorkspaceId, contextVersion()]) : "";
}
export type SubscriptionLoadStatus = "idle" | "loading" | "ready" | "error";
export const subscriptionEvents = new Emitter<void>();
let generation = 0;
let owner = "";
let status: SubscriptionLoadStatus = "idle";
let cached: StaffSubscriptionContext | undefined;
let inflight: { owner: string; generation: number; promise: Promise<StaffSubscriptionContext> } | undefined;

export function invalidateSubscription(): void {
  generation += 1;
  owner = subscriptionOwner();
  cached = undefined;
  inflight = undefined;
  status = "idle";
  subscriptionEvents.emit();
}

sessionEvents.on((event) => {
  // Token rotation replays the same request; it must not invalidate its own result.
  if (event.type === "refreshed" && inflight?.owner === subscriptionOwner()) return;
  invalidateSubscription();
  if (currentSession()) void loadSubscription(true).catch(() => undefined);
});

export function subscriptionLoadStatus(): SubscriptionLoadStatus {
  return owner === subscriptionOwner() ? status : "idle";
}
export function cachedSubscription(): StaffSubscriptionContext | undefined {
  return owner === subscriptionOwner() && status === "ready" ? cached : undefined;
}

/** Force refresh never reuses old facts; superseded callers reject instead of receiving stale data. */
export function loadSubscription(force = false): Promise<StaffSubscriptionContext> {
  const requestOwner = subscriptionOwner();
  if (!requestOwner) return Promise.reject(new ApiError("AUTH_REQUIRED", "请先登录"));
  if (!force && cachedSubscription()) return Promise.resolve(cached!);
  if (!force && inflight?.owner === requestOwner) return inflight.promise;
  const requestGeneration = ++generation;
  owner = requestOwner;
  cached = undefined;
  status = "loading";
  const owns = () => requestGeneration === generation && requestOwner === subscriptionOwner();
  const stale = () => new ApiError("STALE_CONTEXT", "会话或版本事实已刷新，请重试");
  const promise = getSubscriptionContext().then((context) => {
    if (!owns()) throw stale();
    if (!context?.overview || context.overview.tenantId !== currentSession()?.tenant.tenantId ||
        !["standard", "pro"].includes(context.overview.plan) ||
        !["active", "expiring", "expired", "pending_activation", "unconfigured"].includes(context.overview.serviceStatus) ||
        !Number.isInteger(context.overview.revision) || !Array.isArray(context.entitlements) || !context.reminder) {
      throw new ApiError("INVALID_RESPONSE", "未能读取当前租户的版本事实");
    }
    cached = context;
    status = "ready";
    return context;
  }).catch((error: unknown) => {
    if (!owns()) throw stale();
    cached = undefined;
    status = "error";
    throw error;
  }).finally(() => {
    // Return the finally chain itself: no detached rejected promise, and no clearing a newer flight.
    if (owns()) {
      inflight = undefined;
      subscriptionEvents.emit();
    }
  });
  inflight = { owner: requestOwner, generation: requestGeneration, promise };
  subscriptionEvents.emit();
  return promise;
}

export function subscriptionPlanLabel(plan: string): string {
  return plan === "pro" ? "PRO 版" : plan === "standard" ? "基础版" : "版本待确认";
}
export function subscriptionStatusLabel(value: string): { label: string; tone: string } {
  switch (value) {
    case "active": return { label: "服务中", tone: "success" };
    case "expiring": return { label: "即将到期", tone: "warning" };
    case "expired": return { label: "已到期", tone: "danger" };
    case "pending_activation": return { label: "待启用", tone: "info" };
    case "unconfigured": return { label: "未配置", tone: "neutral" };
    default: return { label: "状态待确认", tone: "neutral" };
  }
}
export function entitlementSourceLabel(source: string): string {
  switch (source) {
    case "standard_public": return "公共权益";
    case "tenant_grant": return "租户专项授权";
    case "pro": return "PRO 权益";
    case "needs_upgrade": return "需升级";
    default: return "来源待确认";
  }
}
export function featureReleaseLabel(value: string): string {
  switch (value) {
    case "released": return "已上线";
    case "pilot": return "受控试点";
    case "planned": return "规划中";
    case "paused": return "已暂停";
    case "retired": return "已下线";
    default: return "上线状态待确认";
  }
}

/** Exact exclusive end, including seconds/milliseconds and offset at that instant (not today's DST). */
export function subscriptionEndText(endAt?: string, timeZone?: string): string {
  if (!endAt || !Number.isFinite(Date.parse(endAt))) return "统一截止时间待平台确认（不代表永久有效）";
  const date = new Date(endAt);
  if (!timeZone || !zoneSupported(timeZone)) {
    return `${date.toISOString()}（UTC；${timeZone ? `设备未能转换服务时区 ${timeZone}` : "服务时区待确认"}，不含此时刻）`;
  }
  const p = zonedParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fraction = date.getUTCMilliseconds() ? `.${String(date.getUTCMilliseconds()).padStart(3, "0")}` : "";
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${fraction} ${timeZone}（${formatOffset(zoneOffsetMinutes(date, timeZone))}，不含此时刻）`;
}

export function subscriptionSummary() {
  const context = cachedSubscription();
  if (!context) return { ready: false, plan: "", service: "", tone: "neutral", end: "", message: subscriptionLoadStatus() === "error" ? "版本信息未能刷新，请重试" : "正在刷新版本信息…" };
  const service = subscriptionStatusLabel(context.overview.serviceStatus);
  return { ready: true, plan: subscriptionPlanLabel(context.overview.plan), service: service.label, tone: service.tone, end: subscriptionEndText(context.overview.endAt, context.overview.timeZone), message: "" };
}

/** Single bounded private-storage map, isolated by account/tenant/revision/stage/service calendar day. */
export function reminderDismissalKey(context: StaffSubscriptionContext, now = new Date(serverNow())): string {
  const session = currentSession();
  if (!session || context.overview.tenantId !== session.tenant.tenantId) return "";
  const reminder = context.reminder;
  const zone = reminder.timeZone ?? context.overview.timeZone ?? "UTC";
  if (!zoneSupported(zone)) return ""; // Do not persist an inaccurate device-calendar dismissal.
  return JSON.stringify([session.user.id, session.tenant.tenantId, reminder.revision ?? context.overview.revision, reminder.stage, zone, todayInZone(zone, now)]);
}

export function subscriptionReminder() {
  const context = cachedSubscription();
  const empty = { visible: false, title: "", message: "", end: "", contact: "", key: "" };
  if (!context || !["normal", "urgent", "expired"].includes(context.reminder.stage)) return empty;
  const key = reminderDismissalKey(context);
  if (key && (readStorage<string[]>(STORAGE_KEYS.subscriptionDismissals) ?? []).includes(key)) return empty;
  return { visible: true, key, title: `${subscriptionPlanLabel(context.overview.plan)} · ${subscriptionStatusLabel(context.overview.serviceStatus).label}`, message: "到期停止新业务；已有订单履约、归还及已授权善后不受影响。", end: subscriptionEndText(context.overview.endAt, context.overview.timeZone), contact: currentSession()?.user.isTenantAdmin ? "查看版本与权益，联系平台" : "查看版本与权益，联系租户管理员" };
}
export function dismissSubscriptionReminder(key: string): void {
  const context = cachedSubscription();
  if (!key || !context || key !== reminderDismissalKey(context)) return;
  const keys = readStorage<string[]>(STORAGE_KEYS.subscriptionDismissals) ?? [];
  writeStorage(STORAGE_KEYS.subscriptionDismissals, [...keys.filter((row) => row !== key), key].slice(-100));
  subscriptionEvents.emit();
}
export function resetSubscriptionForTest(): void { invalidateSubscription(); }
