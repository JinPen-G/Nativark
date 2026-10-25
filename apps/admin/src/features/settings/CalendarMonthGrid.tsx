import { Card, Space, Tag, Typography } from "antd";
import { Button, Tooltip } from "@/components/ui";
import { LeftOutlined, RightOutlined } from "@/components/ui/icons";
import type { CSSProperties } from "react";
import type { RentalCalendarDay, RentalCalendarTimePriceDay } from "@rental-os/shared";
import { useLocale } from "@/app/locale";

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

const dayTypeColors: Record<string, string> = {
  workday: "default",
  weekend: "orange",
  statutory_holiday: "red",
  makeup_workday: "blue",
  tenant_special: "purple",
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

const sourceColors: Record<string, string> = {
  week_rule: "default",
  official_cn: "geekblue",
  tenant_override: "volcano",
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

const cellStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--rental-ui-radius-container)",
  minHeight: 76,
  minWidth: 0,
  padding: "var(--space-2)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  cursor: "pointer",
  background: "var(--surface)",
  textAlign: "left",
  width: "100%",
};

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
    <Card
      className="calendar-month-card"
      title={
        <Space>
          <Button
            size="small"
            icon={<LeftOutlined />}
            aria-label={t("上一月")}
            onClick={() => onMonthChange(month === 1 ? 12 : month - 1)}
          />
          <Typography.Text strong>{monthLabel}</Typography.Text>
          <Button
            size="small"
            icon={<RightOutlined />}
            aria-label={t("下一月")}
            onClick={() => onMonthChange(month === 12 ? 1 : month + 1)}
          />
        </Space>
      }
      extra={
        <Space size={4} wrap>
          {(Object.keys(sourceLabels) as Array<keyof typeof sourceLabels>).map((source) => (
            <Tag key={source} color={sourceColors[source]}>
              {t(sourceLabels[source])}
            </Tag>
          ))}
        </Space>
      }
    >
      <div className="calendar-month-scroll">
      <div className="calendar-month-grid">
        {WEEKDAY_LABELS.map((label) => (
          <Typography.Text key={label} type="secondary" className="calendar-weekday">
            {t(label)}
          </Typography.Text>
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
              <button type="button" style={cellStyle} onClick={() => onDayClick(day)}>
                <Space size={4} style={{ justifyContent: "space-between", width: "100%" }}>
                  <Typography.Text strong={day?.source === "tenant_override"} className="calendar-day-number">
                    {cell.dayNumber}
                  </Typography.Text>
                  <Space size={2}>
                  {day.source === "tenant_override" && <Tag color="volcano" style={{ marginInlineEnd: 0 }}>{t("覆盖")}</Tag>}
                  {summaryByDate.get(cell.date)?.entries.length ? (
                    <Tooltip title={summaryByDate.get(cell.date)!.entries.map((entry) => `${entry.planCode ?? `价格版本 ${entry.version}`} · ${entry.timeLabel} ×${entry.multiplier}`).join("；")}>
                      <Tag color="gold" style={{ marginInlineEnd: 0 }}>{t("分时")}</Tag>
                    </Tooltip>
                  ) : null}
                  </Space>
                </Space>
                <Space size={2} wrap style={{ rowGap: 0 }}>
                  <Tag color={dayTypeColors[day.dayType]} className="calendar-day-tag" style={{ marginInlineEnd: 0 }}>
                    {t(dayTypeLabels[day.dayType] ?? day.dayType)}
                  </Tag>
                  <Tag color={businessStatusColors[status]} className="calendar-day-tag" style={{ marginInlineEnd: 0 }}>
                    {t(businessStatusLabels[status] ?? status)}
                  </Tag>
                </Space>
                <Typography.Text className="calendar-day-note" ellipsis>
                  {day.name}
                </Typography.Text>
                <Typography.Text type="secondary" className="calendar-day-note" ellipsis>
                  {day.hours?.windows?.length
                    ? day.hours.windows.map((w) => `${w.start}-${w.end}`).join("、")
                    : `×${day.pricingMultiplier}`}
                </Typography.Text>
              </button>
            </Tooltip>
          ) : (
            <div key={cell.date} style={{ ...cellStyle, cursor: "default", color: "var(--text-muted)" }}>
              <Typography.Text type="secondary" className="calendar-day-number">
                {cell.dayNumber}
              </Typography.Text>
              <Typography.Text type="secondary" className="calendar-day-note">
                {t("无数据")}
              </Typography.Text>
            </div>
          );
          return body;
        })}
      </div>
      </div>
      <Typography.Paragraph type="secondary" className="calendar-help" style={{ marginTop: 12, marginBottom: 0 }}>
        {t("图例——日期类型")}：<Tag>{t("工作日")}</Tag>
        <Tag color="orange">{t("周末")}</Tag>
        <Tag color="red">{t("法定节假日")}</Tag>
        <Tag color="blue">{t("调休工作日")}</Tag>
        <Tag color="purple">{t("空间特殊日")}</Tag>
        ；{t("营业状态")}{t("正常")} / {t("限时")} / {t("停止")} / {t("自助")}；{t("角标「覆盖」表示该日期存在人工覆盖，点击日期查看基础值、生效值与覆盖详情。")}
      </Typography.Paragraph>
    </Card>
  );
}
