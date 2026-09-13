import type { RentalCategoryTerminology } from "@rental-os/shared";

/**
 * UI-NAV-01：把当前经营空间的品类术语解析成导航文案。
 *
 * 为什么单独成一个**纯模块**（不含 JSX、不引图标）：
 *   1. 导航文案是可断言的业务事实，专项测试要能直接调用它逐品类比对；
 *      放进 `navigation.tsx` 就得连 React 与 antd 图标一起加载，测试只能退化成正则扫源码。
 *   2. 术语解析必须**只依赖 `RentalCategoryTerminology`**。品类事实源已经把
 *      「这个品类把标的叫什么」定义好了，导航层再按 CAMERA/VEHICLE 分支一次，
 *      就等于在第二处维护同一份品类知识——两处迟早不一致，且新增品类必须改导航代码。
 *      因此本文件**不出现任何品类编码**，只做文案组合。
 *
 * 覆盖范围只限带品类名词的租户经营入口。SaaS 平台路由与「租赁交易」「定价与营销」
 * 等跨品类分组不在此解析，保持固定文案。
 */

/** 导航文案覆盖项。缺省（`undefined`）表示沿用 `APP_ROUTES` / `APP_NAVIGATION` 的固定文案。 */
export interface TenantNavigationLabels {
  routes: {
    itemGroups?: string;
    pricingGroups?: string;
    assets?: string;
    locations?: string;
  };
  groups: {
    inventory?: string;
  };
}

/**
 * 资产集合的称呼。
 *
 * 集合名词由**品类事实源**声明（`assetCollectionLabel`），不在这里按
 * `assetLabel` 构词：中文集合名词不是后缀派生（车辆→车队而非「车辆队」），
 * 任何拼接规则都会在下一个品类上出错。未声明即表示该品类没有专门说法，
 * 按通用的「库存」表述。
 */
function assetCollectionLabel(terminology: RentalCategoryTerminology): string {
  return `${terminology.assetLabel}与${terminology.assetCollectionLabel ?? "库存"}`;
}

/**
 * 解析当前品类的导航文案。
 *
 * 传 `undefined`（会话尚未取到品类档案、或 SaaS 平台账号）时返回空覆盖，
 * 由调用方回落到固定文案——**不能**猜一个品类，否则平台账号会看到某个租户的术语。
 */
export function resolveTenantNavigationLabels(terminology?: RentalCategoryTerminology): TenantNavigationLabels {
  if (!terminology) return { routes: {}, groups: {} };
  const configured = terminology.navigationLabels;
  return {
    routes: {
      itemGroups: configured?.itemGroups ?? `${terminology.itemGroupLabel}目录`,
      pricingGroups: configured?.pricingGroups ?? `${terminology.itemLabel}定价分组`,
      assets: configured?.assets ?? assetCollectionLabel(terminology),
      // 履约地点直接用品类自己的说法（门店 / 器材门店 / 装备仓 / 设备仓），
      // 与地点页标题同源，避免菜单叫「履约地点」而页面叫「装备仓」。
      locations: configured?.locations ?? terminology.fulfillmentLabel
    },
    groups: {
      inventory: configured?.inventoryGroup ?? `${terminology.itemGroupLabel}与${terminology.assetLabel}`
    }
  };
}

/** 套用术语时只需要这两个字段；其余路由元数据（权限、能力、图标）原样透传。 */
export interface NavigationSectionShape {
  key: string;
  label: string;
  routes: ReadonlyArray<{ path: string; label: string }>;
}

/**
 * 把术语文案套到导航分组与菜单项上。
 *
 * 与 `resolveTenantNavigationLabels` 分开是为了让**套用**这一步也可被直接断言：
 * 解析函数算对了、但套用时漏了一行，界面照样是固定文案，而只测解析函数发现不了。
 * 这里刻意接收 `routePaths` 而不是自己写死路径——路径属于路由注册表，
 * 让本模块记一份就又多了一处需要同步的事实。
 *
 * 只覆盖 `label`；`path`、`permission`、`capability`、`audience` 一概不动。
 */
export function applyTenantNavigationLabels<S extends NavigationSectionShape>(
  sections: readonly S[],
  terminology: RentalCategoryTerminology | undefined,
  routePaths: { itemGroups: string; pricingGroups: string; assets: string; locations: string }
): S[] {
  const labels = resolveTenantNavigationLabels(terminology);
  const labelByPath = new Map<string, string>();
  if (labels.routes.itemGroups) labelByPath.set(routePaths.itemGroups, labels.routes.itemGroups);
  if (labels.routes.pricingGroups) labelByPath.set(routePaths.pricingGroups, labels.routes.pricingGroups);
  if (labels.routes.assets) labelByPath.set(routePaths.assets, labels.routes.assets);
  if (labels.routes.locations) labelByPath.set(routePaths.locations, labels.routes.locations);
  return sections.map((section) => ({
    ...section,
    label: labels.groups[section.key as keyof TenantNavigationLabels["groups"]] ?? section.label,
    routes: section.routes.map((route) => {
      const label = labelByPath.get(route.path);
      return label ? { ...route, label } : route;
    })
  }));
}
