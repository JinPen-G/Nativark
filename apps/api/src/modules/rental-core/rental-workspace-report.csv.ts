import type { RentalWorkspaceOperationReport } from "@store-rental/shared";
import { RENTAL_EXCEPTION_CHARGE_TYPES } from "@store-rental/shared";

/**
 * REPORT-01B：把经营报表渲染成 CSV。
 *
 * 纯函数，不碰数据库与 HTTP：导出口径必须与页面**同一份数据**，因此这里只接收
 * 已经算好的报表对象，不自己再查一遍库——再查一遍就会出现「页面一个数、
 * 导出另一个数」，而且没人能说清哪个对。
 *
 * 不建设泛化异步导出平台（需求 4.10）：单个经营空间的报表是有界的聚合结果，
 * 同步生成即可。真正无界的是订单明细，那不在本次导出范围内。
 */

/** 数字字段由我们自己格式化，因此不需要防注入；字符串字段来自用户数据，必须处理。 */
function escapeText(value: string): string {
  // 以 = + @ 开头会被 Excel/Sheets 当公式执行（CSV 注入）。前置单引号中和，
  // 这是电子表格里公认的「按文本处理」写法，比静默丢字符可解释。
  const neutralized = /^[=+@]/u.test(value) ? `'${value}` : value;
  if (/[",\r\n]/u.test(neutralized)) return `"${neutralized.replace(/"/gu, '""')}"`;
  return neutralized;
}

function row(...cells: Array<string | number | undefined>): string {
  return cells
    .map((cell) => {
      if (cell === undefined || cell === null) return "";
      if (typeof cell === "number") return String(cell);
      return escapeText(String(cell));
    })
    .join(",");
}

const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  overdue: "逾期费",
  damage: "损坏费",
  cancellation: "取消费"
};

/**
 * 渲染 CSV。分节输出而不是一张宽表：概览、库存资产、地点、客户各有各的列，
 * 硬拼成一张表会让大半数格子是空的，反而更难对账。
 *
 * 开头带 UTF-8 BOM：没有它，Excel 会用本地编码打开，中文列名全是乱码。
 */
export function renderOperationReportCsv(report: RentalWorkspaceOperationReport): string {
  const lines: string[] = [];

  // ---- 报表标识与生效筛选 ----
  // 筛选必须写进导出文件：一份没有筛选说明的 CSV，过两天没人能说清它统计的是什么。
  lines.push(row("经营空间报表"));
  lines.push(row("经营空间", report.workspaceId));
  lines.push(row("经营品类", report.categoryCode));
  // 结算币种（需求 §948）：金额列一律是纯数字，没有这一行，导出件里的金额就没有单位。
  lines.push(row("结算币种", report.currency));
  lines.push(row("生成时间", report.generatedAt));
  lines.push(row("统计开始", report.filter.from ?? "不限"));
  lines.push(row("统计结束", report.filter.to ?? "不限"));
  lines.push(row("履约地点筛选", report.filter.locationId ?? "全部"));
  lines.push(row("客户筛选", report.filter.customerId ?? "全部"));
  lines.push(row("客户类型筛选", report.filter.customerType ?? "全部"));
  lines.push("");

  // ---- 概览指标 ----
  lines.push(row("概览指标", "数值"));
  lines.push(row("订单量", report.orderCount));
  lines.push(row("租赁收入", report.rentalRevenue));
  lines.push(row("优惠金额", report.discountTotal));
  lines.push(row("应收金额", report.receivableTotal));
  // 价内税：税额已含在应收里，两行是同一笔钱的拆分，不要相加。
  lines.push(row("其中税额", report.taxTotal));
  lines.push(row("不含税应收", report.netOfTaxTotal));
  lines.push(row("异常费用", report.exceptionFeeTotal));
  lines.push(row("异常订单", report.exceptionOrderCount));
  lines.push("");

  // ---- 异常费用拆分 ----
  lines.push(row("异常费用类型", "金额", "涉及订单数"));
  for (const type of RENTAL_EXCEPTION_CHARGE_TYPES) {
    const entry = report.exceptionFeeBreakdown.find((item) => item.type === type);
    lines.push(row(EXCEPTION_TYPE_LABELS[type] ?? type, entry?.amount ?? 0, entry?.orderCount ?? 0));
  }
  lines.push("");

  // ---- 订单状态拆分 ----
  lines.push(row("订单状态", "订单数"));
  for (const entry of report.statusBreakdown) lines.push(row(entry.status, entry.count));
  lines.push("");
  // ---- 库存与资产（快照口径） ----
  const assets = report.utilization.serializedAssets;
  const stock = report.utilization.quantityStock;
  const occupancy = report.utilization.orderOccupancy;
  lines.push(row("库存与资产（当前快照，非区间利用率）", "数值", "说明"));
  lines.push(row("资产快照时点", assets.snapshotAt, "读取资产状态的瞬间；区间筛选不影响本节"));
  lines.push(row("在册资产数", assets.totalCount, "含停用"));
  lines.push(row("可运营资产数（分母）", assets.operableCount, "在册总数 - 停用"));
  lines.push(row("在租资产数（分子）", assets.rentedCount, "当前状态为 rented"));
  lines.push(row("在租占比", assets.rentedRatio, "在租资产数 / 可运营资产数"));
  lines.push(row("库存在库总量（分母）", stock.onHandTotal, ""));
  lines.push(row("库存已占用（分子）", stock.reservedTotal, ""));
  lines.push(row("库存维修占用", stock.maintenanceTotal, "既不可租也不算已出租"));
  lines.push(row("库存可租余量", stock.availableTotal, "在库 - 已占用 - 维修"));
  lines.push(row("库存占用比", stock.reservedRatio, "已占用 / 在库总量"));
  lines.push(row("区间订单占用时长（小时）", occupancy.totalHours, "只有分子；缺历史可出租时长故不产出比率"));
  lines.push(row("区间平均租期（小时）", occupancy.averageHours, ""));
  lines.push("");

  // ---- 资产状态拆分 ----
  lines.push(row("资产状态", "数量"));
  for (const entry of assets.statusBreakdown) lines.push(row(entry.status, entry.count));
  lines.push("");

  // ---- 地点维度 ----
  lines.push(row("履约地点", "地点 id", "订单量", "租赁收入", "优惠金额", "应收金额", "异常费用"));
  for (const entry of report.locationBreakdown) {
    lines.push(row(
      entry.locationName, entry.locationId, entry.orderCount,
      entry.rentalRevenue, entry.discountTotal, entry.receivableTotal, entry.exceptionFeeTotal
    ));
  }
  lines.push("");

  // ---- 客户维度 ----
  // 只有客户名与类型；手机号、证件号不进导出——报表不是客户资料的第二个出口。
  lines.push(row("客户", "客户类型", "客户 id", "订单量", "租赁收入", "优惠金额", "应收金额", "异常费用"));
  for (const entry of report.customerBreakdown) {
    lines.push(row(
      entry.customerName, entry.customerType, entry.customerId ?? "",
      entry.orderCount, entry.rentalRevenue, entry.discountTotal, entry.receivableTotal, entry.exceptionFeeTotal
    ));
  }
  lines.push("");

  // ---- 历史口径缺口 ----
  // 导出件常常脱离页面单独流转，因此这段说明必须跟着文件走。
  lines.push(row("历史口径缺口"));
  for (const gap of report.historicalCaliberGaps) lines.push(row(gap));

  return `﻿${lines.join("\r\n")}\r\n`;
}
