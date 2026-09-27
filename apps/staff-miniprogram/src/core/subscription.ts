import type { StaffSubscriptionContext } from "@rental-os/shared";
import { getSubscriptionContext } from "../api/subscription";
import { contextVersion, sessionEvents } from "./session";

/**
 * SUB-MP-01：员工端只读订阅上下文的加载与缓存。
 * 缓存按租户 / 会话 / 空间隔离——登录、退出、切换空间都清空并重新拉取（沿用 core/context 同款会话事件）。
 * 迟到响应用 contextVersion 守卫：切租户 / 空间后才到达的旧响应直接丢弃，绝不串租户。
 */
let cached: StaffSubscriptionContext | undefined;
let inflight: Promise<StaffSubscriptionContext> | undefined;

sessionEvents.on((event) => {
  if (event.type === "signed-out" || event.type === "workspace-changed" || event.type === "signed-in") {
    cached = undefined;
    inflight = undefined;
  }
});

export function cachedSubscription(): StaffSubscriptionContext | undefined {
  return cached;
}

/** 加载（或复用）当前租户的只读订阅上下文。force=true 重新拉取。 */
export function loadSubscription(force = false): Promise<StaffSubscriptionContext> {
  if (cached && !force) return Promise.resolve(cached);
  if (inflight && !force) return inflight;
  const startVersion = contextVersion();
  inflight = getSubscriptionContext().then((context) => {
    if (contextVersion() === startVersion) cached = context;
    return context;
  });
  inflight.finally(() => {
    inflight = undefined;
  });
  return inflight;
}

/** SUB-MP 展示口径：版本 / 服务状态 / 权益来源 / 上线状态的员工端文案。金额一律不展示（§SUB-MP-02）。 */
export function subscriptionPlanLabel(plan: string): string {
  return plan === "pro" ? "PRO 版" : "基础版";
}
export function subscriptionStatusLabel(status: string): { label: string; tone: string } {
  switch (status) {
    case "active": return { label: "服务中", tone: "success" };
    case "expiring": return { label: "即将到期", tone: "warning" };
    case "expired": return { label: "已到期", tone: "danger" };
    case "pending_activation": return { label: "待启用", tone: "info" };
    default: return { label: "未配置", tone: "neutral" };
  }
}
export function entitlementSourceLabel(source: string): string {
  switch (source) {
    case "standard_public": return "基础版包含";
    case "tenant_grant": return "专项授权";
    case "pro": return "PRO 权益";
    case "needs_upgrade": return "需升级";
    default: return "";
  }
}
export function featureReleaseLabel(status: string): string {
  switch (status) {
    case "released": return "已上线";
    case "pilot": return "试点中";
    case "planned": return "规划中";
    case "paused": return "已暂停";
    case "retired": return "已下线";
    default: return status;
  }
}

/** 仅供测试。 */
export function resetSubscriptionForTest(): void {
  cached = undefined;
  inflight = undefined;
}
