import type { StaffSubscriptionContext, SubscriptionFeatureEntitlement } from "@rental-os/shared";
import { cachedContext, loadContext, type WorkspaceContext } from "./context";
import { ApiError, isApiError } from "./http";
import { can, currentSession, currentWorkspace } from "./session";
import { cachedSubscription, entitlementSourceLabel, featureReleaseLabel, invalidateSubscription, loadSubscription, subscriptionOwner } from "./subscription";

/** Action intent, not HTTP verb or plan name. Do not put existing fulfillment behind a new-business gate. */
export const STAFF_ACTIONS = {
  "order.quote": { intent: "new_business", permissions: ["rental-os:order:create"] },
  "order.create": { intent: "new_business", permissions: ["rental-os:order:create"] },
  "order.extend": { intent: "new_business", permissions: ["rental-os:order:extend"] },
  "order.confirm": { intent: "existing", permissions: ["rental-os:order:operate"] },
  "order.allocate": { intent: "existing", permissions: ["rental-os:order:operate"] },
  "order.pickup": { intent: "existing", permissions: ["rental-os:order:pickup"] },
  "order.return": { intent: "existing", permissions: ["rental-os:order:return"] },
  "order.cancel": { intent: "existing", permissions: ["rental-os:order:cancel"] },
  "order.fee-review": { intent: "existing", permissions: ["rental-os:order:fee-review"] },
  "order.offline-payment": { intent: "existing", permissions: ["rental-os:order:offline-payment"] },
  "order.settle": { intent: "existing", permissions: ["rental-os:order:settle"] },
  "maintenance.manage": { intent: "existing", permissions: ["rental-core:maintenance:manage"] },
  "asset.manage": { intent: "existing", permissions: ["rental-core:asset:manage"] }
} as const;
export type StaffAction = keyof typeof STAFF_ACTIONS;
export interface AccessDecision { allowed: boolean; reason: string; }
const allow = (): AccessDecision => ({ allowed: true, reason: "" });
const deny = (reason: string): AccessDecision => ({ allowed: false, reason });

export function staffActionAccess(action: StaffAction, context = cachedSubscription()): AccessDecision {
  const rule = STAFF_ACTIONS[action];
  if (!rule || !currentSession() || !can(...rule.permissions)) return deny("当前账号无此操作权限，请联系租户管理员");
  if (rule.intent === "existing") return allow();
  if (!context || context.overview.tenantId !== currentSession()?.tenant.tenantId) return deny("版本信息未能刷新，暂不能办理新业务；请联网重试");
  if (context.overview.serviceStatus === "expired") return deny("订阅已到期，暂停新业务；已有订单履约、归还及已授权善后不受影响");
  // Legacy unconfigured basic tenants stay compatible. Pending activation never grants a catalog capability below.
  if (!["active", "expiring", "unconfigured", "pending_activation"].includes(context.overview.serviceStatus)) return deny("服务状态待确认，请刷新后重试");
  return allow();
}

export interface FeatureBinding {
  /** Role permission codes for this operation; an empty list never means public. */
  permissions: readonly string[];
  /** Workspace capability required for this feature (explicit, not a guessed mapping). */
  capability: string;
}
/** Known role/config bindings only; this is not a plan table or a professional module implementation. */
export const STAFF_FEATURE_BINDINGS: Record<string, FeatureBinding> = {
  camera_kit_handover: { permissions: ["rental-os:order:pickup", "rental-os:order:return"], capability: "camera_kit_handover" },
  camping_kit_integrity: { permissions: ["rental-os:order:pickup", "rental-os:order:return"], capability: "camping_kit_integrity" },
  camping_cleaning_turnaround: { permissions: ["rental-core:maintenance:view", "rental-core:maintenance:manage"], capability: "camping_cleaning_turnaround" }
};

/** Same predicate for future menu/page/deep-link/scan/submission entry. Unknown binding fails closed. */
export function staffFeatureAccess(code: string, binding = STAFF_FEATURE_BINDINGS[code], context = cachedSubscription(), workspace = cachedContext()): AccessDecision {
  if (!binding || !binding.permissions.length) return deny("此功能的员工操作入口待接入");
  if (!can(...binding.permissions)) return deny("无此功能的岗位权限，请联系租户管理员");
  if (!context || context.overview.tenantId !== currentSession()?.tenant.tenantId) return deny("版本信息未能刷新，请重试");
  const feature = context.entitlements.find((row) => row.code === code);
  if (!feature) return deny("功能未列入当前已发布权益目录");
  if (!workspace || workspace.workspaceId !== currentWorkspace()?.id) return deny("空间配置未能刷新，请重试");
  if (feature.categories.length && !feature.categories.includes(workspace.categoryCode)) return deny("不适用当前经营品类");
  if (feature.releaseStatus !== "released") return deny(`${featureReleaseLabel(feature.releaseStatus)}，暂无可用作业入口`);
  if (!["active", "expiring"].includes(context.overview.serviceStatus)) return deny(context.overview.serviceStatus === "expired" ? "订阅已到期，暂停新的专业作业" : "服务尚未启用，不能据此开启专业作业");
  if (!feature.available || !["standard_public", "tenant_grant", "pro"].includes(feature.source)) return deny("尚未获得此功能，请联系租户管理员");
  if (feature.needsConfig || !binding.capability || !workspace.capabilities.includes(binding.capability)) return deny("当前空间需先完成配置");
  return allow();
}

async function freshFacts() {
  const owner = subscriptionOwner();
  if (!owner) throw new ApiError("AUTH_REQUIRED", "请先登录");
  // Refresh permissions/category configuration as well as subscription; read cache alone cannot grant writes.
  await loadContext(true);
  if (owner !== subscriptionOwner()) throw new ApiError("STALE_CONTEXT", "经营空间或账号已切换，请重新进入");
  const context = await loadSubscription(true);
  if (owner !== subscriptionOwner() || cachedSubscription() !== context) throw new ApiError("STALE_CONTEXT", "版本事实已变化，请刷新");
  return { owner, context };
}

export async function requireStaffAction(action: StaffAction): Promise<void> {
  if (STAFF_ACTIONS[action]?.intent === "existing") {
    const result = staffActionAccess(action);
    if (!result.allowed) throw new ApiError("FORBIDDEN", result.reason);
    return;
  }
  await freshFacts();
  const result = staffActionAccess(action);
  if (!result.allowed) throw new ApiError("FORBIDDEN", result.reason);
}

export async function requireStaffFeature(code: string, binding?: FeatureBinding): Promise<void> {
  await freshFacts();
  const result = staffFeatureAccess(code, binding);
  if (!result.allowed) throw new ApiError("FORBIDDEN", result.reason);
}

/** Last-mile write guard. Server remains authoritative; rejected authorization clears displayed entrances. */
export async function withStaffAction<T>(action: StaffAction, write: () => Promise<T>): Promise<T> {
  const owner = subscriptionOwner();
  await requireStaffAction(action);
  if (owner !== subscriptionOwner()) throw new ApiError("STALE_CONTEXT", "当前会话已切换，请重新操作");
  const result = staffActionAccess(action);
  if (!result.allowed) throw new ApiError("FORBIDDEN", result.reason);
  try { return await write(); }
  catch (error) {
    if (owner === subscriptionOwner() && (isApiError(error, "FORBIDDEN") || isApiError(error, "CONFLICT"))) {
      invalidateSubscription();
      void loadSubscription(true).catch(() => undefined);
    }
    throw error;
  }
}

function featureRow(feature: SubscriptionFeatureEntitlement, context: StaffSubscriptionContext, workspace?: WorkspaceContext) {
  const binding = STAFF_FEATURE_BINDINGS[feature.code];
  const permission = binding ? can(...binding.permissions) : false;
  return {
    code: feature.code, name: feature.name, value: feature.valueText ?? "",
    source: entitlementSourceLabel(feature.source), release: featureReleaseLabel(feature.releaseStatus),
    category: "适用当前品类", permission: binding ? permission ? "具备岗位权限" : "无此功能岗位权限" : "员工操作权限映射待接入",
    config: feature.needsConfig || (binding && workspace && !workspace.capabilities.includes(binding.capability)) ? "需配置" : !workspace ? "空间配置未能刷新" : binding ? "空间已配置" : "空间配置待确认",
    availability: staffFeatureAccess(feature.code, binding, context, workspace).allowed ? "已获得；员工专业作业入口尚未开放" : staffFeatureAccess(feature.code, binding, context, workspace).reason
  };
}

/** Ordinary employees see only role-relevant, category-applicable rows. No fees/notes or raw catalog objects in setData. */
export function staffFeatureRows(context = cachedSubscription(), workspace = cachedContext()) {
  if (!context) return [];
  const category = currentWorkspace()?.categoryCode;
  return context.entitlements.filter((row) => (!row.categories.length || Boolean(category && row.categories.includes(category))) &&
    (currentSession()?.user.isTenantAdmin || (STAFF_FEATURE_BINDINGS[row.code] && can(...STAFF_FEATURE_BINDINGS[row.code].permissions))))
    .map((row) => featureRow(row, context, workspace));
}
