/** 七条商业路由保留原价格管理权限，菜单和历史版本面包屑共用正式声明。 */
import { rentalLegacyPermission, rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { CorePageDescriptor } from "@rental-os/core-contracts";

export const RENTAL_COMMERCIAL_CORE_ID = "rental";
export const RENTAL_COMMERCIAL_LEGACY_PERMISSION = rentalLegacyPermission("price", "manage");
export const RENTAL_COMMERCIAL_ACCESS = rentalPagePermissions("pricing");

const commercialGroup = { default: "定价与营销", translations: { "en-US": "Pricing & offers" } };

export const RENTAL_COMMERCIAL_PAGES = {
  pricingGroups: {
    id: "pricing-groups",
    path: "/pricing-groups",
    title: { default: "定价分组", translations: { "en-US": "Rate groups" } },
    permissions: rentalPagePermissions("pricing-groups"),
    menu: { group: commercialGroup, order: 0 },
  },
  pricing: {
    id: "pricing",
    path: "/pricing",
    title: { default: "价格版本与调价", translations: { "en-US": "Rates & revisions" } },
    permissions: rentalPagePermissions("pricing"),
    menu: { group: commercialGroup, order: 10 },
  },
  pricingVersions: {
    id: "pricing-versions",
    path: "/pricing/versions",
    parent: "pricing",
    title: { default: "空间价格版本", translations: { "en-US": "Workspace rate versions" } },
    permissions: rentalPagePermissions("pricing-versions"),
  },
  pricingVersionDetail: {
    id: "pricing-version-detail",
    path: "/pricing/versions/:sequence",
    parent: "pricing-versions",
    title: { default: "价格版本详情", translations: { "en-US": "Rate version details" } },
    permissions: rentalPagePermissions("pricing-version-detail"),
  },
  discounts: {
    id: "discounts",
    path: "/discounts",
    title: { default: "优惠方案", translations: { "en-US": "Discounts" } },
    permissions: rentalPagePermissions("discounts"),
    menu: { group: commercialGroup, order: 20 },
  },
  coupons: {
    id: "coupons",
    path: "/coupons",
    title: { default: "优惠券", translations: { "en-US": "Coupons" } },
    permissions: rentalPagePermissions("coupons"),
    menu: { group: commercialGroup, order: 30 },
  },
  services: {
    id: "services",
    path: "/services",
    title: { default: "增值服务", translations: { "en-US": "Add-ons" } },
    permissions: rentalPagePermissions("services"),
    menu: { group: commercialGroup, order: 40 },
  },
} satisfies Record<string, CorePageDescriptor>;
