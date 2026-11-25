/** 公共官方日历来源与不可变版本。平台维护来源，Core按自身规则引用版本。
 * 不决定营业、价格或业务采用；来源主档的修改不得改写历史版本快照。 */

/** 保留原日期代码；tenant_special由采用该日期的Core解释。 */
export type CalendarDayType = "workday" | "weekend" | "statutory_holiday" | "makeup_workday" | "tenant_special";

export type OfficialCalendarDayInput = Array<{
  date: string;
  dayType: CalendarDayType;
  name: string;
  /** 原来源字段，是否采用及如何计价由业务Core裁定。 */
  pricingMultiplier?: number;
  closed?: boolean;
}>;

/** 平台级公共来源，仅SaaS管理员维护，不属于某个租户或Core。 */
export interface OfficialCalendarSource {
  id: string;
  region: "CN";
  name: string;
  url: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 来源版本只追加，来源资料按登记时快照解释，供Core追溯其原引用。 */
export interface OfficialCalendarSourceVersion {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  region: "CN";
  year: number;
  /** 展示版本；排序和并发分配使用sequence，避免1.10被排在1.9之前。 */
  version: string;
  /** 从1开始的来源/年度内版本序号。 */
  sequence: number;
  /** 公告发布时间，与平台登记时间importedAt分别保存。 */
  publishedAt: string;
  importedAt: string;
  importedBy?: string;
  days: OfficialCalendarDayInput;
}

/** 列表不返回全年日期；停用禁新采用，历史引用仍保留。 */
export interface OfficialCalendarSourceVersionSummary
  extends Omit<OfficialCalendarSourceVersion, "days"> {
  dayCount: number;
  sourceActive: boolean;
}

export interface SaveOfficialCalendarSourceRequest {
  id?: string;
  region: "CN";
  name: string;
  url: string;
  notes?: string;
  isActive?: boolean;
}

/** 版本号由服务端按同来源/年度递增，不由调用方指定。 */
export interface RegisterOfficialCalendarSourceVersionRequest {
  year: number;
  publishedAt: string;
  days: OfficialCalendarDayInput;
}
