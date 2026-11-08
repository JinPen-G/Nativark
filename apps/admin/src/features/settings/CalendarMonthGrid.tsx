import { Tag } from "antd";
import { Button, Tooltip } from "@/components/ui";
import { LeftOutlined, RightOutlined } from "@/components/ui/icons";
import { Clock3, SquarePen } from "lucide-react";
import type { RentalCalendarDay, RentalCalendarTimePriceDay } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import styles from "./CalendarMonthGrid.module.css";

/**
 * PRICE-02A（需求 4.5.9）：按自然月展示的七列月历。
 *
 * 运营按月看待日历，而不是按 365 行的长列表——需求明确「不得把全年每一天作为
 * 默认长列表要求租户逐日查找和修改」。本组件是纯展示：
 * 日期格给出日期、类型、名称、营业状态、来源与人工覆盖标记；点击交给父级打开详情。
 */

const dayTypeLabels: Record<string, string> = {
  workday: "工作日",
  weekend: "周末",
  statutory_holiday: "法定节假日",
  makeup_workday: "调休工作日",
  tenant_special: "空间特殊日",
};

const compactDayLabels: Record<string, [string, string]> = {
  workday: ["平日", "Wkdy"], weekend: ["周末", "Wknd"], statutory_holiday: ["假日", "Hol."],
  makeup_workday: ["调休", "Alt."], tenant_special: ["特殊", "Spec."],
};

const businessStatusLabels: Record<string, string> = {
  open: "正常营业",
  limited: "限时营业",
  closed: "停止营业",
  self_service: "自助营业",
};

const businessStatusColors: Record<string, string> = {
  open: "success",
  limited: "processing",
  closed: "error",
  self_service: "warning",
};

const sourceLabels: Record<string, string> = {
  week_rule: "每周模板",
  official_cn: "官方日历",
  tenant_override: "人工覆盖",
};

const compactStatusLabels: Record<string, [string, string]> = {
  open: ["营业", "Open"], limited: ["限时", "Ltd."], closed: ["停业", "Shut"], self_service: ["自助", "Self"],
};

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 该月第一天是星期几（周一=0）。日历键是 UTC 日期，按 UTC 计算星期。 */
function firstWeekdayOfMonth(year: number, month: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=周日
  return (weekday + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function CalendarMonthGrid({
  year,
  month,
  onMonthChange,
  days,
  timePriceSummary,
  onDayClick,
}: {
  year: number;
  month: number;
  onMonthChange: (next: number) => void;
  days: RentalCalendarDay[];
  /** PRICE-02B：服务端用与报价同一命中助手生成的分时价格摘要（只读）。 */
  timePriceSummary?: RentalCalendarTimePriceDay[];
  onDayClick: (day: RentalCalendarDay) => void;
}) {
  const { t, locale } = useLocale();
  const byDate = new Map(days.map((day) => [day.date, day]));
  const summaryByDate = new Map((timePriceSummary ?? []).map((row) => [row.date, row]));
  const leading = firstWeekdayOfMonth(year, month);
  const total = daysInMonth(year, month);
  const cells: Array<{ date: string; dayNumber: number } | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, index) => {
      const dayNumber = index + 1;
      return {
        date: `${year}-${String(month).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`,
        dayNumber,
      };
    }),
  ];

  const monthLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return (
    <section className={styles.calendar} aria-label={monthLabel}>
      <div className={styles.header}>
        <div className={styles.monthControl}>
          <Button
            size="small"
            icon={<LeftOutlined />}
            aria-label={t("上一月")}
            onClick={() => onMonthChange(month === 1 ? 12 : month - 1)}
          />
          <h3 className={styles.monthLabel}>{monthLabel}</h3>
          <Button
            size="small"
            icon={<RightOutlined />}
            aria-label={t("下一月")}
            onClick={() => onMonthChange(month === 12 ? 1 : month + 1)}
          />
        </div>
        <div className={styles.legend}>
          <span><SquarePen size={14} aria-hidden="true" />{t("人工覆盖")}</span>
          <span><Clock3 size={14} aria-hidden="true" />{t("分时")}</span>
        </div>
      </div>
      <div className={styles.grid}>
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className={styles.weekday}>
            {t(label)}
          </span>
        ))}
        {cells.map((cell, index) => {
          if (!cell) return <div key={`blank-${index}`} />;
          const day = byDate.get(cell.date);
          const status = day?.businessStatus ?? (day?.closed ? "closed" : "open");
          const body = day ? (
            <Tooltip
              key={cell.date}
              title={
                day.source === "tenant_override"
                  ? `${t("人工覆盖")}：${day.overrideReason ?? t("未记录原因")}${day.overrideBy ? `（${day.overrideBy}）` : ""}${
                      day.overrideScope && day.overrideScope.kind === "range"
                        ? `；${t("范围")} ${day.overrideScope.rangeStart} ~ ${day.overrideScope.rangeEnd}`
                        : ""
                    }`
                  : `${t(sourceLabels[day.source])} · ${t("点击查看详情")}`
              }
            >
              <button type="button" className={styles.day} onClick={() => onDayClick(day)} aria-label={`${day.date} · ${t(dayTypeLabels[day.dayType] ?? day.dayType)} · ${t(businessStatusLabels[status] ?? status)} · ${t(sourceLabels[day.source])} · ${day.name}`}>
                <span className={styles.dayHeading}>
                  <strong className={styles.dayNumber}>{cell.dayNumber}</strong>
                  <span className={styles.markers}>
                  {day.source === "tenant_override" && <SquarePen size={12} aria-label={t("人工覆盖")} />}
                  {summaryByDate.get(cell.date)?.entries.length ? (
                    <Tooltip title={summaryByDate.get(cell.date)!.entries.map((entry) => `${entry.planCode ?? `价格版本 ${entry.version}`} · ${entry.timeLabel} ×${entry.multiplier}`).join("；")}>
                      <Clock3 size={12} aria-label={t("分时")} />
                    </Tooltip>
                  ) : null}
                  </span>
                </span>
                <span className={styles.dayType}>
                  <span className={styles.fullLabel}>{t(dayTypeLabels[day.dayType] ?? day.dayType)}</span>
                  <span className={styles.compactLabel}>{compactDayLabels[day.dayType]?.[locale === "en-US" ? 1 : 0] ?? day.dayType}</span>
                </span>
                <Tag color={businessStatusColors[status]} className={styles.status}>
                  <span className={styles.fullLabel}>{t(businessStatusLabels[status] ?? status)}</span>
                  <span className={styles.compactLabel}>{compactStatusLabels[status]?.[locale === "en-US" ? 1 : 0] ?? status}</span>
                </Tag>
                {day.name && <span className={styles.dayDetails} title={day.name}>{day.name}</span>}
                <span className={styles.dayDetails}>
                  {day.hours?.windows?.length
                    ? day.hours.windows.map((w) => `${w.start}-${w.end}`).join("、")
                    : `×${day.pricingMultiplier}`}
                </span>
              </button>
            </Tooltip>
          ) : (
            <div key={cell.date} className={`${styles.day} ${styles.unavailable}`}>
              <strong className={styles.dayNumber}>{cell.dayNumber}</strong>
              <span className={styles.dayType}>{t("无数据")}</span>
            </div>
          );
          return body;
        })}
      </div>
      <p className={styles.help}>{t("点击日期查看营业安排、来源及覆盖记录。")}</p>
    </section>
  );
}
