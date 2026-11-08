import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";
import { ConfigProvider, DatePicker as AntDatePicker, type DatePickerProps } from "antd";
import type { RangePickerProps } from "antd/es/date-picker";
import { DatePicker as ArcDatePicker } from "@/registry/components/date-picker/date-picker";
import { TimePicker as ArcTimePicker } from "@/registry/components/time-picker/time-picker";
import { DateRangePicker as ArcRangePicker } from "@/registry/components/date-range-picker/date-range-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { useLocale } from "@/app/locale";
import { Button } from "./Button";
import { ArcLocale } from "./ArcLocale";

/** Dayjs stays the business contract; Arc owns the calendar/time animations. */
function SingleDatePicker(props: DatePickerProps<Dayjs, false>) {
  const { locale, t } = useLocale();
  const { componentDisabled: formDisabled, componentSize } = ConfigProvider.useConfig();
  const [internal, setInternal] = useState<Dayjs | null>(props.defaultValue ?? null);
  const value = "value" in props ? props.value : internal;
  const disabled = props.disabled ?? formDisabled;
  const emit = (next: Dayjs | null) => { if (disabled) return; setInternal(next); props.onChange?.(next, next ? next.format(typeof props.format === "string" ? props.format : props.showTime ? "YYYY-MM-DD HH:mm:ss" : "YYYY-MM-DD") : ""); };
  // These Ant contracts need a dedicated adapter, not an approximation of dates.
  if (props.multiple || (props.picker && props.picker !== "date") || props.disabledTime || props.needConfirm || props.cellRender || props.panelRender || props.onOk || props.open !== undefined || Array.isArray(props.format) || typeof props.format === "function") return <AntDatePicker {...props} />;
  const seconds = Boolean(props.showTime) && !(typeof props.format === "string" && !props.format.includes("ss"));
  return <div className={`arc-date-field ${props.className ?? ""}`} style={props.style} data-size={props.size ?? componentSize} aria-disabled={disabled}><ArcLocale>
    <ArcDatePicker id={props.id} label={typeof props.placeholder === "string" ? props.placeholder : t("选择日期")} value={value?.isValid() ? value.toDate() : undefined} placeholder={typeof props.placeholder === "string" ? props.placeholder : t("选择日期")}
      locale={locale} disabled={disabled} minDate={props.minDate?.toDate()} maxDate={props.maxDate?.toDate()} showToday={props.showToday !== false}
      disabledDates={props.disabledDate ? date => props.disabledDate!(dayjs(date), { type: "date" }) : undefined}
      onChange={date => { if (!date) emit(null); else { const base = value ?? dayjs().startOf("day"); emit(dayjs(date).hour(base.hour()).minute(base.minute()).second(base.second()).millisecond(0)); } }} />
    {props.showTime && value?.isValid() && <div className="arc-time-fields"><ArcTimePicker label={t("时间")} value={value.format("HH:mm")} minuteStep={1} format="24h" disabled={disabled}
      onChange={time => { const [hour, minute] = time.split(":").map(Number); emit(value.hour(hour).minute(minute)); }} />
      {seconds && <label className="arc-seconds">{t("秒")}<input type="number" min={0} max={59} value={value.second()} disabled={disabled} onChange={event => { const number = Number(event.target.value); if (Number.isInteger(number) && number >= 0 && number <= 59) emit(value.second(number)); }} /></label>}</div>}
    {props.allowClear !== false && value && <Button size="small" disabled={disabled} onClick={() => emit(null)} aria-label={t("清空日期")}>{t("清空")}</Button>}
  </ArcLocale></div>;
}

type Pair = [Dayjs | null, Dayjs | null];
/** The trigger can be narrower than its form cell; keep the clear hit area inside its actual edge. */
function RangeClearButton({ root, onClear, label }: { root: RefObject<HTMLDivElement | null>; onClear: () => void; label: string }) {
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const host = button.current?.closest<HTMLDivElement>(".arc-date-range");
    const trigger = host?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    if (!host || !trigger) return;
    const align = () => host.style.setProperty("--rental-date-clear-offset", `${Math.max(0, host.getBoundingClientRect().right - trigger.getBoundingClientRect().right)}px`);
    align();
    const observer = new ResizeObserver(align);
    observer.observe(host); observer.observe(trigger);
    return () => { observer.disconnect(); host.style.removeProperty("--rental-date-clear-offset"); };
  }, [root]);
  return <button ref={button} type="button" className="arc-date-range-clear" aria-label={label}
    onMouseDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); onClear(); root.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.focus(); }}><X size={14} aria-hidden="true" /></button>;
}

function RangePicker(props: RangePickerProps) {
  const { locale, t } = useLocale();
  const { componentDisabled: formDisabled, componentSize } = ConfigProvider.useConfig();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Pair>([props.value?.[0] ?? props.defaultValue?.[0] ?? null, props.value?.[1] ?? props.defaultValue?.[1] ?? null]);
  useEffect(() => { if ("value" in props) setDraft([props.value?.[0] ?? null, props.value?.[1] ?? null]); }, [props.value]);
  const disabled = props.disabled ?? formDisabled;
  const emit = (pair: Pair) => {
    setDraft(pair);
    const strings: [string, string] = [pair[0]?.format(typeof props.format === "string" ? props.format : props.showTime ? "YYYY-MM-DD HH:mm:ss" : "YYYY-MM-DD") ?? "", pair[1]?.format(typeof props.format === "string" ? props.format : props.showTime ? "YYYY-MM-DD HH:mm:ss" : "YYYY-MM-DD") ?? ""];
    props.onCalendarChange?.(pair, strings, { range: pair[1] ? "end" : "start" });
    const allowEmpty = Array.isArray(props.allowEmpty) ? props.allowEmpty : [Boolean(props.allowEmpty), Boolean(props.allowEmpty)];
    if (pair.every(item => !item) || pair.every((item, index) => item || allowEmpty[index])) props.onChange?.(pair.every(item => !item) ? null : pair as [Dayjs, Dayjs], strings);
  };
  // Arc's range picker selects whole days only. A datetime range must stay one
  // integrated control, with time/seconds/clear inside its picker, not endpoints.
  // Forward showTime unchanged so precision, time limits and confirmation survive.
  if (props.showTime || props.disabledTime || props.onOk || props.needConfirm || props.open !== undefined || (props.picker && props.picker !== "date") || props.cellRender || props.panelRender || Array.isArray(props.format) || typeof props.format === "function" || (props.presets && (props.disabledDate || props.minDate || props.maxDate))) return <AntDatePicker.RangePicker {...props} className={[props.className, props.showTime && !props.prefix ? "rental-datetime-range" : undefined].filter(Boolean).join(" ") || undefined} />;
  const partial = Array.isArray(props.allowEmpty) ? props.allowEmpty.some(Boolean) : props.allowEmpty;
  const simple = !props.showTime && !props.disabledDate && !partial && !disabled && !props.minDate && !props.maxDate;
  const fullyDisabled = Array.isArray(disabled) ? disabled.every(Boolean) : disabled;
  const clearDisabled = Array.isArray(disabled) ? disabled.some(Boolean) : disabled;
  const inlineClear = props.allowClear !== false && draft.some(Boolean) && !clearDisabled;
  const rangeLabel = draft.some(Boolean) ? draft.map((value, index) => value ? new Intl.DateTimeFormat(locale).format(value.toDate()) : props.placeholder?.[index] ?? t(index === 0 ? "开始日期" : "结束日期")).join(" – ") : props.placeholder?.[0] ?? t("选择日期");
  // Open-ended ranges keep both endpoint contracts in one anchored editor. They
  // must not expand a 36px query row into a form that overlaps its neighbours.
  return <div ref={root} className={`arc-date-range ${props.className ?? ""}`} style={props.style} data-size={props.size ?? componentSize} data-inline-clear={inlineClear || undefined}><ArcLocale>
    {simple ? <ArcRangePicker locale={locale} label={t("日期范围")} placeholder={props.placeholder?.[0] ?? t("选择日期")} value={draft[0] && draft[1] ? { start: draft[0].toDate(), end: draft[1].toDate() } : null}
      presets={(props.presets ?? []).filter(preset => typeof preset.value === "function" || (preset.value[0] && preset.value[1])).map(preset => ({ label: String(preset.label), range: () => { const pair = typeof preset.value === "function" ? preset.value() : preset.value; return { start: (pair[0] ?? dayjs()).toDate(), end: (pair[1] ?? dayjs()).toDate() }; } }))}
      onChange={range => emit([dayjs(range.start), dayjs(range.end)])} /> : <div className="arc-range-advanced"><Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button className="arc-range-advanced-trigger" disabled={Boolean(fullyDisabled)} aria-label={`${t("日期范围")} · ${rangeLabel}`}><CalendarDays size={16} aria-hidden="true" /><span>{rangeLabel}</span><ChevronDown size={16} aria-hidden="true" /></Button></PopoverTrigger>
      <PopoverContent ref={panel} align="start" side="bottom" className="arc-range-advanced-popup" onInteractOutside={event => {
        const target = event.target;
        if (target instanceof Node && [...(panel.current?.querySelectorAll("[aria-controls]") ?? [])].some(control => control.getAttribute("aria-controls")?.split(/\s+/u).some(id => document.getElementById(id)?.contains(target)))) event.preventDefault();
      }}>
      <div className="arc-range-endpoints">{([0, 1] as const).map(index => <SingleDatePicker key={index} value={draft[index]} showTime={Boolean(props.showTime)} format={props.format} minDate={props.minDate} maxDate={props.maxDate}
        disabled={Array.isArray(disabled) ? disabled[index] : disabled} placeholder={props.placeholder?.[index] ?? t(index === 0 ? "开始日期" : "结束日期")}
        allowClear={props.allowClear} disabledDate={date => Boolean(props.disabledDate?.(date, { type: "date", from: draft[0] ?? undefined })) || (index === 1 && Boolean(draft[0] && date.isBefore(draft[0], "day")))}
        onChange={next => { const pair: Pair = [...draft]; pair[index] = next; if (pair[0] && pair[1] && pair[1].isBefore(pair[0])) pair[index === 0 ? 1 : 0] = null; emit(pair); }} />)}</div>
      {props.presets && <div className="arc-range-presets">{props.presets.map((preset, index) => <Button key={index} size="small" disabled={Boolean(clearDisabled)} onClick={() => { const pair = typeof preset.value === "function" ? preset.value() : preset.value; emit([pair[0] ?? null, pair[1] ?? null]); setOpen(false); }}>{preset.label}</Button>)}</div>}
      </PopoverContent></Popover></div>}
    {inlineClear && <RangeClearButton root={root} label={t("清空日期")} onClear={() => { emit([null, null]); setOpen(false); }} />}
  </ArcLocale></div>;
}
export const DatePicker = Object.assign(SingleDatePicker, { RangePicker });
