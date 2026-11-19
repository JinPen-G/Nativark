/** 会员菜单、详情父级和页头共用登记描述，旧宿主按原两套权限映射。 */
import type {
  CorePageDescriptor,
  CorePageLocation,
} from "@rental-os/core-contracts";
import type { RentalMembershipSession } from "./page-context";
export const RENTAL_MEMBERSHIP_CORE_ID = "rental";
const memberGroup = {
  default: "会员与客户",
  translations: { "en-US": "Members & customers" },
};
export const RENTAL_MEMBERSHIP_PAGES = {
  qualificationTypes: {
    id: "qualification-types",
    path: "/qualification-types",
    title: {
      default: "空间证件类型",
      translations: { "en-US": "Workspace qualification types" },
    },
    purpose: "configuration",
    permissions: [{ resource: "qualification-type", action: "manage" }],
    menu: {
      group: {
        default: "经营基础",
        translations: { "en-US": "Operating setup" },
      },
      order: 40,
    },
  },
  reviews: {
    id: "membership-reviews",
    path: "/membership/reviews",
    title: {
      default: "会员审核",
      translations: { "en-US": "Membership reviews" },
    },
    permissions: [{ resource: "member", action: "view" }],
    menu: { group: memberGroup, order: 10 },
  },
  personal: {
    id: "personal-members",
    path: "/membership/personal",
    title: {
      default: "个人会员",
      translations: { "en-US": "Personal members" },
    },
    permissions: [{ resource: "member", action: "view" }],
    menu: { group: memberGroup, order: 20 },
  },
  personalDetail: {
    id: "personal-member-detail",
    path: "/membership/personal/:customerId",
    title: {
      default: "个人会员资料",
      translations: { "en-US": "Personal member profile" },
    },
    parent: "personal-members",
    permissions: [{ resource: "member", action: "view" }],
  },
  corporate: {
    id: "corporate-members",
    path: "/membership/corporate",
    title: {
      default: "企业会员",
      translations: { "en-US": "Corporate members" },
    },
    permissions: [{ resource: "corporate", action: "view" }],
    menu: { group: memberGroup, order: 30 },
  },
  corporateDetail: {
    id: "corporate-member-detail",
    path: "/membership/corporate/:customerId",
    title: {
      default: "企业资料",
      translations: { "en-US": "Corporate profile" },
    },
    parent: "corporate-members",
    permissions: [{ resource: "corporate", action: "view" }],
  },
  plans: {
    id: "membership-plans",
    path: "/membership/plans",
    title: {
      default: "会员方案",
      translations: { "en-US": "Membership plans" },
    },
    permissions: [{ resource: "member", action: "view" }],
    menu: { group: memberGroup, order: 40 },
  },
  rewards: {
    id: "membership-rewards",
    path: "/membership/rewards",
    title: {
      default: "会员激励",
      translations: { "en-US": "Member incentives" },
    },
    permissions: [{ resource: "price", action: "manage" }],
    menu: { group: memberGroup, order: 50 },
  },
} satisfies Record<string, CorePageDescriptor>;
export const RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS: Readonly<
  Record<
    string,
    { scope: "tenant-membership" | "workspace"; permissions: readonly string[] }
  >
> = {
  "qualification-types": {
    scope: "workspace",
    permissions: [
      "rental-os:qualification-type:manage",
      "rental-os:member:manage",
      "rental-os:member:view",
    ],
  },
  "membership-reviews": {
    scope: "tenant-membership",
    permissions: [
      "rental-os:member:view",
      "rental-os:member:review",
      "rental-os:member:qualification-review",
    ],
  },
  "personal-members": {
    scope: "tenant-membership",
    permissions: ["rental-os:member:view", "rental-os:member:manage"],
  },
  "personal-member-detail": {
    scope: "tenant-membership",
    permissions: ["rental-os:member:view", "rental-os:member:manage"],
  },
  "corporate-members": {
    scope: "tenant-membership",
    permissions: [
      "rental-os:corporate:view",
      "rental-os:corporate:manage",
      "rental-os:corporate:employee-manage",
    ],
  },
  "corporate-member-detail": {
    scope: "tenant-membership",
    permissions: [
      "rental-os:corporate:view",
      "rental-os:corporate:manage",
      "rental-os:corporate:employee-manage",
    ],
  },
  "membership-plans": {
    scope: "tenant-membership",
    permissions: [
      "rental-os:member:view",
      "rental-os:member:plan:manage",
      "rental-os:member:plan:publish",
    ],
  },
  "membership-rewards": {
    scope: "workspace",
    permissions: [
      "rental-os:price:manage",
      "rental-os:rules:manage",
      "system:params:manage",
    ],
  },
};
export function rentalMembershipLegacyPageAllowed(
  pageId: string,
  session: RentalMembershipSession,
): boolean {
  const policy = RENTAL_MEMBERSHIP_LEGACY_PAGE_ACCESS[pageId];
  if (
    !policy ||
    !session.sessionVerified ||
    !session.authenticated ||
    session.user?.isSaasAdmin
  )
    return false;
  return policy.scope === "tenant-membership"
    ? policy.permissions.some((permission) =>
        session.hasTenantMembershipPermission(permission),
      )
    : Boolean(session.currentWorkspaceId) &&
        policy.permissions.some((permission) =>
          session.hasPermission(permission),
        );
}
export function rentalPersonalMemberLocation(
  customerId?: string,
): CorePageLocation {
  return customerId
    ? {
        coreId: RENTAL_MEMBERSHIP_CORE_ID,
        pageId: RENTAL_MEMBERSHIP_PAGES.personalDetail.id,
        params: { customerId },
      }
    : {
        coreId: RENTAL_MEMBERSHIP_CORE_ID,
        pageId: RENTAL_MEMBERSHIP_PAGES.personal.id,
      };
}
export function rentalCorporateMemberLocation(
  customerId?: string,
): CorePageLocation {
  return customerId
    ? {
        coreId: RENTAL_MEMBERSHIP_CORE_ID,
        pageId: RENTAL_MEMBERSHIP_PAGES.corporateDetail.id,
        params: { customerId },
      }
    : {
        coreId: RENTAL_MEMBERSHIP_CORE_ID,
        pageId: RENTAL_MEMBERSHIP_PAGES.corporate.id,
      };
}
