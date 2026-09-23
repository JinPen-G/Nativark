import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AdminLocale = "zh-CN" | "en-US";

const STORAGE_KEY = "rental_admin_locale";

/**
 * 管理后台的第一阶段双语词典。
 *
 * 路由、权限码和服务端枚举仍然使用原始值；这里只负责把已经存在的界面
 * 文案翻译成英文，避免把展示语言混进业务事实。未登记的动态文案会回落
 * 到中文，保证新增页面在补齐翻译前仍然可用。
 */
const ENGLISH: Record<string, string> = {
  "概览": "Overview",
  "运营概览": "Operations Overview",
  "经营报表": "Operations Report",
  "租赁交易": "Rental Transactions",
  "新建订单": "New Order",
  "订单管理": "Orders",
  "订单详情": "Order Details",
  "商品与资产": "Products & Assets",
  "商品目录": "Product Catalog",
  "定价分组": "Pricing Groups",
  "养护工单": "Maintenance Work Orders",
  "履约地点": "Fulfillment Locations",
  "定价与营销": "Pricing & Marketing",
  "价格版本与调价": "Price Versions & Adjustments",
  "优惠方案": "Discount Plans",
  "优惠券": "Coupons",
  "增值服务": "Value-added Services",
  "会员与客户": "Members & Customers",
  "会员审核": "Membership Review",
  "个人会员": "Individual Members",
  "个人会员管理": "Individual Members",
  "企业会员": "Corporate Members",
  "会员方案": "Membership Plans",
  "会员激励": "Member Rewards",
  "经营设置": "Operations Settings",
  "开业配置": "Opening Setup",
  "品类与业务规则": "Category & Business Rules",
  "空间证件类型": "Workspace Qualification Types",
  "经营空间能力": "Workspace Capabilities",
  "运营账号": "Operations Accounts",
  "角色权限": "Roles & Permissions",
  "第三方服务": "Third-party Services",
  "客户端渠道": "Client Channels",
  "支付对账": "Payment Reconciliation",
  "平台管理": "Platform Management",
  "SaaS 租户": "SaaS Tenants",
  "公共官方日历": "Official Calendars",
  "组织与权限": "Organizations & Permissions",
  "平台参数": "Platform Parameters",
  "平台运维": "Platform Operations",
  "平台工具与治理": "Platform Tools & Governance",

  // 品类导航术语。它们来自当前经营空间的 terminology，不应从中文字符串中构词。
  "摄影器材": "Camera Equipment",
  "器材型号": "Equipment Models",
  "器材型号目录": "Equipment Model Catalog",
  "器材定价分组": "Equipment Pricing Groups",
  "器材资产与库存": "Equipment Assets & Inventory",
  "器材门店": "Equipment Locations",
  "户外装备": "Outdoor Gear",
  "装备型号": "Gear Models",
  "装备型号目录": "Gear Model Catalog",
  "装备定价分组": "Gear Pricing Groups",
  "装备资产与库存": "Gear Assets & Inventory",
  "装备仓库": "Gear Warehouses",
  "车辆型号与车队": "Vehicle Models & Fleet",
  "厂牌车型管理": "Vehicle Models",
  "车型组目录": "Vehicle Model Catalog",
  "车型定价分组": "Vehicle Pricing Groups",
  "车辆定价分组": "Vehicle Pricing Groups",
  "车辆与车队": "Vehicles & Fleet",
  "车辆管理": "Vehicles",
  "车辆门店": "Vehicle Locations",
  "门店管理": "Stores",
  "工程设备": "Construction Equipment",
  "设备型号": "Equipment Models",
  "设备型号目录": "Equipment Model Catalog",
  "设备定价分组": "Equipment Pricing Groups",
  "设备台账与库存": "Equipment Assets & Inventory",
  "设备资产与库存": "Equipment Assets & Inventory",
  "设备仓库": "Equipment Warehouses",
  "门店": "Stores",
  "仓库": "Warehouses",

  // 系统预置经营空间名称；租户自定义名称未登记时保留原名称。
  "摄影设备经营空间": "Camera Equipment Workspace",
  "露营装备经营空间": "Camping Gear Workspace",
  "车辆载具经营空间": "Vehicle Rental Workspace",
  "工程设备经营空间": "Construction Equipment Workspace",
  "摄影设备租赁": "Camera Equipment Rental",
  "露营装备租赁": "Camping Gear Rental",
  "车辆载具租赁": "Vehicle Rental",
  "工程设备租赁": "Construction Equipment Rental",

  // 左侧壳层、主题与语言切换。
  "展开导航": "Expand navigation",
  "收起导航": "Collapse navigation",
  "打开导航": "Open navigation",
  "通知": "Notifications",
  "通知中心尚未接入": "Notifications are not connected yet",
  "页面说明": "Page information",
  "工作台": "Workbench",
  "租赁运营台": "Rental operations",
  "运营用户": "Operations user",
  "退出登录": "Log out",
  "未选择经营空间": "No workspace selected",
  "尚无经营空间": "No workspace",
  "平台管理面": "Platform administration",
  "已切换经营空间": "Workspace switched",
  "切换经营空间失败": "Failed to switch workspace",
  "请稍后重试": "Please try again later",
  "明亮": "Light",
  "暗色": "Dark",
  "紧凑": "Compact",
  "Ant Design 默认浅色主题": "Ant Design default light theme",
  "使用官方 darkAlgorithm": "Use the official darkAlgorithm",
  "使用官方 compactAlgorithm": "Use the official compactAlgorithm",
  "明亮主题": "Light theme",
  "暗色主题": "Dark theme",
  "切换外观主题": "Toggle appearance",
  "切换语言": "Switch language",
  "中文": "中文",
  "英文": "English",
  "中文（简体）": "Chinese",
  "English": "English",

  // 常见页面标题与操作，供 PageHeader 和后续页面逐步接入。
  "订单": "Orders",
  "租赁订单": "Rental Orders",
  "商品目录管理": "Product Catalog",
  "资产与库存管理": "Assets & Inventory",
  "维护工单": "Maintenance Work Orders",
  "会员审核管理": "Membership Review",
  "企业会员管理": "Corporate Members",
  "会员方案管理": "Membership Plans",
  "优惠方案管理": "Discount Plans",
  "增值服务管理": "Value-added Services",
  "保存": "Save",
  "取消": "Cancel",
  "关闭": "Close",
  "新增": "Add",
  "编辑": "Edit",
  "删除": "Delete",
  "查询": "Search",
  "重置": "Reset",
  "刷新": "Refresh",
  "确定": "Confirm",
  "提交": "Submit",
  "返回": "Back",
  "详情": "Details",
  "启用": "Enabled",
  "停用": "Disabled",
  "状态": "Status",
  "名称": "Name",
  "说明": "Description",
  "操作": "Actions",
  "暂无数据": "No data",
  "无权访问": "Access denied",
  "暂无可访问页面": "No accessible pages",
  "登录": "Sign in",
  "密码": "Password",
  "账号": "Account",
  "租户": "Tenant",
  "经营空间": "Workspace",
  "待线下收款确认": "Pending offline payment confirmation",
  "今日": "Today",
  "本周": "This week",
  "本月": "This month",
  "刷新经营概览": "Refresh overview",
  "核对支付与退款": "Reconcile payments and refunds",
  "期间订单": "Orders in period",
  "起租": "rental starts",
  "非草稿": "Non-draft",
  "履约中": "In fulfillment",
  "已预订至待结算": "Reserved through settlement",
  "实时": "Live",
  "应收金额": "Receivable",
  "单已关闭": "orders closed",
  "调账后应收": "Receivable after adjustments",
  "租赁收入": "Rental revenue",
  "只含租金": "Rental only",
  "不含服务与押金": "Excludes services and deposits",
  "可租库存": "Available inventory",
  "独立资产 + 数量库存": "Serialized assets + quantity stock",
  "当前快照": "Current snapshot",
  "当前账号仅可查看工作台待办": "This account can only view workbench tasks",
  "订单、库存和金额指标需要报表查看权限及相应的数据查看权限。": "Order, inventory, and amount metrics require report and corresponding data-view permissions.",
  "运营待办": "Operations tasks",
  "刷新待办": "Refresh tasks",
  "当前空间没有需要处理的待办": "There are no pending tasks in this workspace",
  "事项": "Item",
  "金额": "Amount",
  "项": "items",
  "处理": "Handle",
  "无详情权限": "No detail permission",
  "还有": "There are",
  "项，请从订单或工单页面继续处理。": " more items. Continue from Orders or Work Orders.",
  "订单状态": "Order status",
  "查看订单": "View orders",
  "阶段": "Stage",
  "订单数": "Orders",
  "占比": "Share",
  "暂无订单": "No orders",
  "库存状态（当前快照）": "Inventory status (current snapshot)",
  "资产与库存": "Assets & Inventory",
  "这一节是读取瞬间的快照，不是区间利用率": "This section is a point-in-time snapshot, not interval utilization",
  "独立资产": "Serialized assets",
  "数量库存": "Quantity stock",
  "可租 / 在库（已占用": "Available / on hand (reserved",
  "维修": "maintenance",
  "尚未建立资产或数量库存。": "No assets or quantity stock have been created yet.",
  "草稿": "Draft",
  "已预订": "Reserved",
  "待领取": "Ready for pickup",
  "租赁中": "Renting",
  "待归还检查": "Return inspection pending",
  "待结算": "Settlement pending",
  "已关闭": "Closed",
  "已取消": "Cancelled",
  "已爽约": "No-show",
  "待支付超时": "Payment timeout",
  "待通知爽约": "No-show notification pending",
  "待确认爽约": "No-show confirmation pending",
  "逾时未归还": "Return overdue",
  "待裁定费用": "Fee decision pending",
  "待办理退款": "Refund pending",
  "通知失败": "Notification failed",
  "取消/爽约待退款": "Cancellation/no-show refund pending",

  // 常见系统提示。
  "当前账号权限或租户经营品类能力不支持此功能；前端菜单隐藏不能替代后端数据权限。": "The current account or workspace capability does not allow this feature. Hiding a menu item cannot replace server-side data permissions.",
  "请联系租户管理员授予业务或会员管理权限。": "Ask the tenant administrator to grant business or membership permissions.",
  "页面操作": "Page actions"
};

function readInitialLocale(): AdminLocale {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "en-US" ? "en-US" : "zh-CN";
}

interface LocaleContextValue {
  locale: AdminLocale;
  setLocale: (locale: AdminLocale) => void;
  t: (value: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AdminLocale>(readInitialLocale);

  const setLocale = useCallback((next: AdminLocale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback((value: string) => locale === "en-US" ? ENGLISH[value] ?? value : value, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}
