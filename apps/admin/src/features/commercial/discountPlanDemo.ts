/**
 * 负责：优惠方案多规则展示所需的视图结构与写死的演示数据。
 * 不负责：报价匹配、保存、发布或版本落库；这里的内容都不是服务端事实。
 * 后端接入时用接口结果替换 DISCOUNT_PLAN_DEMO_ROWS，并将 DISCOUNT_PLAN_DEMO 改为 false 或移除旧列表分支。
 */
export const DISCOUNT_PLAN_DEMO: boolean = true;

export type DiscountPlanStatus = "draft" | "enabled" | "disabled";
export type DiscountRulePricing =
  | { mode: "discount"; rate: number; maximumDiscount?: number }
  | { mode: "minus"; amount: number }
  | { mode: "fixed"; dailyPrice: number }
  | { mode: "split"; weekdayRate: number; holidayRate: number; statutoryRate?: number; maximumDiscount?: number };

export interface DiscountPlanRule {
  id: string;
  name: string;
  orderWindow?: string;
  useWindow?: string;
  advanceDays?: number;
  modelGroups: string[];
  rentalDays?: { minimum?: number; maximum?: number };
  pickupLocations: string[];
  returnLocations: string[];
  membership: string[];
  pricing: DiscountRulePricing;
}

export interface DiscountPlanVersion {
  version: string;
  savedBy: string;
  savedAt: string;
  note: string;
  current?: boolean;
}

export interface DiscountPlanRow {
  id: string;
  code: string;
  name: string;
  displayName: string;
  status: DiscountPlanStatus;
  priority: number;
  validFrom: string;
  validTo: string;
  businessLines: string[];
  customerGroups: string[];
  cardSchemes: string[];
  onsiteVerification?: { qualification: string; proof: string };
  rules: DiscountPlanRule[];
  versions: DiscountPlanVersion[];
}

const anyLocation: string[] = [];

export const DISCOUNT_PLAN_DEMO_ROWS: DiscountPlanRow[] = [
  {
    id: "plan-winter", code: "PLAN-2026-WINTER", name: "2026 冬季出行季", displayName: "冬季特惠", status: "enabled", priority: 90,
    validFrom: "2026-11-01", validTo: "2027-02-28", businessLines: ["标准门市", "24h 自助"], customerGroups: ["全部会员"], cardSchemes: ["Visa", "Mastercard"],
    rules: [
      { id: "winter-1", name: "早鸟预订", advanceDays: 14, modelGroups: ["全部型号组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "discount", rate: 85, maximumDiscount: 600 } },
      { id: "winter-2", name: "连租 7 天起", rentalDays: { minimum: 7 }, modelGroups: ["旗舰机身组", "镜头组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "discount", rate: 80 } },
      { id: "winter-3", name: "平假分开", useWindow: "2026-12-01 至 2027-01-31", modelGroups: ["全部型号组"], pickupLocations: ["静安店", "徐汇店"], returnLocations: ["静安店", "徐汇店"], membership: [], pricing: { mode: "split", weekdayRate: 80, holidayRate: 90, statutoryRate: 95 } },
      { id: "winter-4", name: "无人机立减", orderWindow: "2026-11-01 至 2026-12-15", rentalDays: { minimum: 3, maximum: 14 }, modelGroups: ["无人机组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: ["金卡会员", "黑卡会员"], pricing: { mode: "minus", amount: 200 } },
    ],
    versions: [
      { version: "V3", savedBy: "周敏", savedAt: "2026-10-28 16:20", note: "新增无人机立减规则", current: true },
      { version: "V2", savedBy: "周敏", savedAt: "2026-10-20 11:05", note: "调整平假折扣" },
      { version: "V1", savedBy: "李航", savedAt: "2026-10-12 09:40", note: "新建方案" },
    ],
  },
  {
    id: "plan-early", code: "PLAN-EARLY-BIRD", name: "全年早鸟计划", displayName: "提前订更省", status: "enabled", priority: 70,
    validFrom: "2026-01-01", validTo: "2026-12-31", businessLines: ["标准门市"], customerGroups: ["全部会员"], cardSchemes: ["不限"],
    rules: [
      { id: "early-1", name: "提前 30 天", advanceDays: 30, modelGroups: ["全部型号组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "discount", rate: 75, maximumDiscount: 800 } },
      { id: "early-2", name: "提前 14 天", advanceDays: 14, modelGroups: ["全部型号组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "discount", rate: 85 } },
      { id: "early-3", name: "提前 7 天", advanceDays: 7, modelGroups: ["镜头组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "minus", amount: 80 } },
    ],
    versions: [{ version: "V2", savedBy: "李航", savedAt: "2026-03-02 14:12", note: "增加 7 天档", current: true }, { version: "V1", savedBy: "李航", savedAt: "2026-01-02 10:00", note: "新建方案" }],
  },
  {
    id: "plan-student", code: "PLAN-STUDENT", name: "学生专享价", displayName: "学生价", status: "enabled", priority: 60,
    validFrom: "2026-09-01", validTo: "2027-06-30", businessLines: ["标准门市"], customerGroups: ["个人客户"], cardSchemes: ["不限"],
    onsiteVerification: { qualification: "学生身份", proof: "学生证或在读证明" },
    rules: [
      { id: "student-1", name: "工作日体验", useWindow: "周一至周四", modelGroups: ["入门机身组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "fixed", dailyPrice: 128 } },
      { id: "student-2", name: "毕业季连租", rentalDays: { minimum: 5, maximum: 30 }, modelGroups: ["入门机身组", "镜头组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "split", weekdayRate: 78, holidayRate: 88 } },
    ],
    versions: [{ version: "V1", savedBy: "周敏", savedAt: "2026-08-25 15:30", note: "新建方案", current: true }],
  },
  {
    id: "plan-long", code: "PLAN-LONG-TERM", name: "长租一口价", displayName: "长租特惠", status: "enabled", priority: 50,
    validFrom: "2026-07-01", validTo: "2027-06-30", businessLines: ["标准门市", "24h 自助"], customerGroups: ["全部会员", "企业客户"], cardSchemes: ["Visa", "Mastercard", "银联"],
    rules: [
      { id: "long-1", name: "15 天档", rentalDays: { minimum: 15, maximum: 29 }, modelGroups: ["旗舰机身组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "fixed", dailyPrice: 268 } },
      { id: "long-2", name: "30 天档", rentalDays: { minimum: 30 }, modelGroups: ["旗舰机身组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "fixed", dailyPrice: 218 } },
      { id: "long-3", name: "镜头同租", rentalDays: { minimum: 15 }, modelGroups: ["镜头组"], pickupLocations: ["静安店"], returnLocations: ["静安店"], membership: [], pricing: { mode: "discount", rate: 70 } },
    ],
    versions: [{ version: "V2", savedBy: "陈露", savedAt: "2026-09-18 10:26", note: "下调 30 天档价格", current: true }, { version: "V1", savedBy: "陈露", savedAt: "2026-06-26 17:48", note: "新建方案" }],
  },
  {
    id: "plan-newyear", code: "PLAN-NEW-YEAR", name: "元旦跨年促销", displayName: "跨年特惠", status: "draft", priority: 95,
    validFrom: "2026-12-28", validTo: "2027-01-03", businessLines: ["标准门市", "24h 自助"], customerGroups: ["全部会员"], cardSchemes: ["不限"],
    rules: [
      { id: "newyear-1", name: "跨年用车", useWindow: "2026-12-31 至 2027-01-02", modelGroups: ["全部型号组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "split", weekdayRate: 90, holidayRate: 92, statutoryRate: 95 } },
      { id: "newyear-2", name: "黑卡加赠", orderWindow: "2026-12-20 至 2026-12-30", modelGroups: ["旗舰机身组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: ["黑卡会员"], pricing: { mode: "minus", amount: 300 } },
    ],
    versions: [{ version: "草稿", savedBy: "李航", savedAt: "2026-11-06 18:02", note: "待运营确认折扣", current: true }],
  },
  {
    id: "plan-summer", code: "PLAN-2026-SUMMER", name: "2026 暑期大促", displayName: "暑期特惠", status: "disabled", priority: 80,
    validFrom: "2026-06-01", validTo: "2026-08-31", businessLines: ["标准门市"], customerGroups: ["全部会员"], cardSchemes: ["Visa", "Mastercard"],
    rules: [
      { id: "summer-1", name: "暑期连租", rentalDays: { minimum: 5 }, modelGroups: ["全部型号组"], pickupLocations: anyLocation, returnLocations: anyLocation, membership: [], pricing: { mode: "discount", rate: 82 } },
      { id: "summer-2", name: "周末加场", useWindow: "周五至周日", modelGroups: ["无人机组"], pickupLocations: ["徐汇店"], returnLocations: ["徐汇店"], membership: [], pricing: { mode: "minus", amount: 120 } },
    ],
    versions: [{ version: "V2", savedBy: "周敏", savedAt: "2026-09-01 09:00", note: "活动结束后停用", current: true }, { version: "V1", savedBy: "周敏", savedAt: "2026-05-20 13:15", note: "新建方案" }],
  },
];
