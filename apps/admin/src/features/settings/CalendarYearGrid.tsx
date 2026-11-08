import { useMemo, useRef, useState } from "react";
import type { RentalCalendarDay } from "@rental-os/shared";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";
import { useLocale } from "@/app/locale";
import { calendarDayTypeLabels } from "./governance/ruleOptionLabels";
import { calendarYearMonths, moveCalendarDate } from "./calendar-year-model";
import styles from "./CalendarYearGrid.module.css";

const statusLabels: Record<string, string> = { open: "正常营业", limited: "限时营业", closed: "停止营业", self_service: "自助营业" };
const sourceLabels = { week_rule: "每周模板", official_cn: "官方日历", tenant_override: "人工覆盖" };
const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function CalendarYearGrid({ year, days, onDayClick, onMonthClick }: {
  year: number;
  days: RentalCalendarDay[];
  onDayClick: (day: RentalCalendarDay) => void;
  onMonthClick: (month: number) => void;
}) {
  const { t, locale } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const [activeDate, setActiveDate] = useState<string>();
  const months = useMemo(() => calendarYearMonths(year), [year]);
  const byDate = useMemo(() => new Map(days.map(day => [day.date, day])), [days]);
  const focusDate = activeDate?.startsWith(`${year}-`) && byDate.has(activeDate)
    ? activeDate : months.flatMap(month => month.cells).find(cell => cell && byDate.has(cell.date))?.date;
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  return <div className={styles.year} ref={root} aria-label={t("{year} 年全年日历", { year })}>
    <div className={styles.legend} aria-label={t("营业状态")}>
      <span><i className={styles.holidaySample} aria-hidden="true" />{t("法定节假日")}</span>
      <span><i className={styles.closedSample} aria-hidden="true" />{t("停止营业")}</span>
      <span><i className={styles.limitedSample} aria-hidden="true" />{t("限时营业")}</span>
      <span><i className={styles.selfServiceSample} aria-hidden="true" />{t("自助营业")}</span>
      <span><i className={styles.overrideSample} aria-hidden="true" />{t("人工覆盖")}</span>
    </div>
    <div className={styles.months}>
      {months.map(({ month, cells }) => {
        const monthLabel = monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
        return <section key={month} className={styles.month} aria-label={`${year} · ${monthLabel}`}>
          <h3 className={styles.monthHeading}><Button type="text" size="small" onClick={() => onMonthClick(month)} aria-label={t("查看 {month} 月历", { month: monthLabel })}>
            {monthLabel}<ChevronRight size={14} aria-hidden="true" />
          </Button></h3>
          <div className={styles.grid}>
            {weekdayLabels.map(label => <span key={label} className={styles.weekday}>{locale === "en-US" ? t(label).slice(0, 2) : t(label).replace("周", "")}</span>)}
            {cells.map((cell, index) => {
              if (!cell) return <span key={`blank-${index}`} aria-hidden="true" />;
              const day = byDate.get(cell.date);
              const status = day?.businessStatus ?? (day?.closed ? "closed" : "open");
              const label = day
                ? `${day.date} · ${t(calendarDayTypeLabels[day.dayType])} · ${t(statusLabels[status])} · ${t(sourceLabels[day.source])}${day.name ? ` · ${day.name}` : ""}`
                : `${cell.date} · ${t("无数据")}`;
              return <button key={cell.date} type="button" className={styles.day} data-calendar-date={cell.date}
                data-status={day ? status : undefined} data-weekend={cell.weekday > 4 || undefined} data-holiday={day?.dayType === "statutory_holiday" || undefined}
                data-override={day?.source === "tenant_override" || undefined} disabled={!day} aria-label={label} title={label}
                tabIndex={cell.date === focusDate ? 0 : -1} onFocus={() => setActiveDate(cell.date)} onClick={() => { if (day) onDayClick(day); }}
                onKeyDown={event => {
                  const nextDate = moveCalendarDate(cell.date, event.key, year);
                  if (!nextDate || !byDate.has(nextDate)) return;
                  event.preventDefault();
                  root.current?.querySelector<HTMLButtonElement>(`[data-calendar-date="${nextDate}"]`)?.focus();
                }}>{cell.day}</button>;
            })}
          </div>
        </section>;
      })}
    </div>
    <p className={styles.help}>{t("点击日期查看详情，点击月份返回月历。")}</p>
  </div>;
}
