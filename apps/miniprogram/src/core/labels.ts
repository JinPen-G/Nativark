/**
 * 面向客户的用词（需求 §2.2）。内部枚举一律在这里翻译，页面不直接展示技术词。
 * 未知取值返回原值而不是空串——宁可露出一个英文码，也不能把状态显示成空白。
 */
const CATEGORY_LABELS: Record<string, string> = {
  camera: "摄影器材",
  camping: "露营装备",
  vehicle: "车辆",
  construction: "工程设备"
};

const FULFILLMENT_LABELS: Record<string, string> = {
  store_pickup_return: "门店自取",
  partner_pickup_return: "合作点取还",
  warehouse_pickup_return: "仓库自取",
  locker_pickup_return: "自助柜取还",
  delivery: "配送上门",
  onsite_delivery: "现场交付"
};

const INVENTORY_LABELS: Record<string, string> = {
  serialized: "单件设备",
  quantity: "按件租赁",
  bundle: "套装",
  consumable: "一次性耗材（不需归还）"
};

const PRICING_UNIT_LABELS: Record<string, string> = {
  hour: "小时",
  shift: "班次",
  day_24h: "天",
  calendar_day: "天",
  night: "晚",
  week: "周",
  month: "月",
  usage: "次",
  package: "套餐"
};

const MEMBERSHIP_LABELS: Record<string, string> = {
  active: "会员正常",
  pending_activation: "会员待审核",
  suspended: "会员已暂停",
  restricted: "会员受限",
  exited: "已退出",
  closed: "已关闭"
};

const REVIEW_LABELS: Record<string, string> = {
  pending: "审核中",
  approved: "已通过",
  rejected: "未通过",
  supplement_required: "需要补充材料",
  cancelled: "已取消"
};

const QUALIFICATION_LABELS: Record<string, string> = {
  not_submitted: "未提交",
  pending: "审核中",
  approved: "已通过",
  rejected: "未通过",
  expired: "已过期",
  revoked: "已撤销"
};

const CHARGE_LABELS: Record<string, string> = {
  rental: "租金",
  calendar_adjustment: "日期价格调整",
  fulfillment: "取还/配送费用",
  preauthorization: "预授权额度",
  discount: "优惠",
  coupon: "优惠券",
  service: "增值服务",
  deposit: "押金",
  cancellation: "取消费",
  overdue: "逾期费",
  damage: "损坏费用",
  extension: "续租费用",
  early_return_refund: "提前归还退款",
  order_change: "订单变更差额"
};

const EXTENSION_LABELS: Record<string, string> = {
  pending_payment: "待补款",
  effective: "已生效",
  cancelled: "已取消",
  expired: "已失效"
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  wechat_pay: "微信支付",
  alipay: "支付宝",
  offline_cash: "到店现金付款",
  offline_transfer: "线下转账",
  simulation: "开发模拟"
};

function lookup(table: Record<string, string>, code: string | undefined | null): string {
  if (!code) return "";
  return table[code] ?? code;
}

export const categoryLabel = (code?: string | null) => lookup(CATEGORY_LABELS, code);
export const fulfillmentLabel = (code?: string | null) => lookup(FULFILLMENT_LABELS, code);
export const inventoryLabel = (code?: string | null) => lookup(INVENTORY_LABELS, code);
export const pricingUnitLabel = (code?: string | null) => lookup(PRICING_UNIT_LABELS, code);
export const membershipLabel = (code?: string | null) => lookup(MEMBERSHIP_LABELS, code);
export const reviewLabel = (code?: string | null) => lookup(REVIEW_LABELS, code);
export const qualificationLabel = (code?: string | null) => lookup(QUALIFICATION_LABELS, code);
export const chargeLabel = (code?: string | null) => lookup(CHARGE_LABELS, code);
export const extensionLabel = (code?: string | null) => lookup(EXTENSION_LABELS, code);
export const paymentMethodLabel = (code?: string | null) => lookup(PAYMENT_METHOD_LABELS, code);

export const PICKUP_MODES = ["store_pickup_return", "warehouse_pickup_return", "partner_pickup_return", "locker_pickup_return"] as const;
export const DELIVERY_MODES = ["delivery", "onsite_delivery"] as const;

export function isDeliveryMode(mode: string | undefined): boolean {
  return (DELIVERY_MODES as readonly string[]).includes(mode ?? "");
}

/** 品类对应的线性图标名（ui-icon 组件）。 */
const CATEGORY_IMAGE_PATHS: Record<string, string> = {
  camera: "/assets/category/camera.png",
  camping: "/assets/category/camping.png",
  vehicle: "/assets/category/vehicle.png",
  construction: "/assets/category/construction.png"
};

function normalizedCategoryCode(code?: string | null): string {
  return String(code ?? "").trim().toLowerCase();
}

export function categoryIcon(code?: string | null): string {
  // Prisma 枚举经 API 返回时可能是大写（CAMERA/CAMPING/...），客户端统一按领域小写匹配。
  switch (normalizedCategoryCode(code)) {
    case "camera":
      return "camera";
    case "camping":
      return "tent";
    case "vehicle":
      return "car";
    case "construction":
      return "crane";
    default:
      return "grid";
  }
}

/** 品类对应的透明图片图标：首页分类入口使用，未知品类返回空字符串并保留线性图标回退。 */
export function categoryImage(code?: string | null): string {
  return CATEGORY_IMAGE_PATHS[normalizedCategoryCode(code)] ?? "";
}
