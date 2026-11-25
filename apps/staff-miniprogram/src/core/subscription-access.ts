/** 员工微信业务准入入口。复用同一权限、经营上下文和公共订阅宿主，API 与页面沿原函数消费。 */
import { createRentalStaffSubscriptionAccess } from "@rental-os/rental-core/clients/staff";
import { cachedContext, loadContext } from "./context";
import { ApiError, isApiError } from "./http";
import { can, currentSession, currentWorkspace } from "./session";
import { cachedSubscription, entitlementSourceLabel, featureReleaseLabel, invalidateSubscription, loadSubscription, subscriptionOwner } from "./subscription";

const access = createRentalStaffSubscriptionAccess({
  can,
  currentSession,
  currentWorkspace,
  cachedContext,
  loadContext,
  cachedSubscription,
  loadSubscription,
  subscriptionOwner,
  invalidateSubscription,
  entitlementSourceLabel,
  featureReleaseLabel,
  ApiError,
  isApiError,
});

export const {
  staffActionAccess, staffFeatureAccess, requireStaffAction, requireStaffFeature,
  withStaffAction, staffFeatureRows,
} = access;
export { STAFF_ACTIONS, STAFF_FEATURE_BINDINGS } from "@rental-os/rental-core/clients/staff";
export type { StaffAction, AccessDecision, FeatureBinding } from "@rental-os/rental-core/clients/staff";
