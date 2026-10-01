import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { ConfigProvider, TimePicker as AntTimePicker, type TimePickerProps } from "antd";
import { TimePicker as ArcTimePicker } from "@/registry/components/time-picker/time-picker";
import { useLocale } from "@/app/locale";
import { Button } from "./Button";
import { ArcLocale } from "./ArcLocale";

/** HH:mm string contract for business-hour fields, without changing persisted values to Dayjs. */
export function TimeInput({ value = "", onChange, disabled, label, id }: { value?: string; onChange?: (value: string) => void; disabled?: boolean; label?: string; id?: string }) {
  const { t } = useLocale();
  const { componentDisabled } = ConfigProvider.useConfig();
  return <div id={id} className="arc-time-fields"><ArcLocale><ArcTimePicker value={value} onChange={onChange} label={label ?? t("时间")} minuteStep={1} format="24h" disabled={disabled ?? componentDisabled} placeholder={t("选择时间")} /></ArcLocale></div>;
}

export function TimePicker(props: TimePickerProps) {
  const { t } = useLocale();
  const { componentDisabled } = ConfigProvider.useConfig();
  const [internal, setInternal] = useState<Dayjs | null>(props.defaultValue ?? null);
  const value = "value" in props ? props.value : internal;
  const disabled = props.disabled ?? componentDisabled;
  if (props.disabledTime || props.disabledHours || props.disabledMinutes || props.disabledSeconds || props.use12Hours || props.hourStep || props.secondStep || props.open !== undefined || props.needConfirm || props.onOk || props.addon || props.cellRender || props.renderExtraFooter || (props.minuteStep != null && ![1, 5, 10, 15, 30].includes(props.minuteStep))) return <AntTimePicker {...props} />;
  const emit = (next: Dayjs | null) => { if (disabled) return; setInternal(next); props.onChange?.(next, next ? next.format(typeof props.format === "string" ? props.format : "HH:mm:ss") : ""); };
  const step = [1, 5, 10, 15, 30].includes(props.minuteStep ?? 1) ? props.minuteStep as 1 | 5 | 10 | 15 | 30 | undefined : undefined;
  const seconds = !(typeof props.format === "string" && !props.format.includes("ss"));
  return <div id={props.id} style={props.style} className={`arc-time-fields ${props.className ?? ""}`}><ArcLocale><ArcTimePicker label={t("时间")} value={value?.format("HH:mm") ?? ""} minuteStep={step ?? 1} format="24h" disabled={disabled} placeholder={props.placeholder ?? t("选择时间")}
    onChange={time => { const [hour, minute] = time.split(":").map(Number); emit((value ?? dayjs().startOf("day")).hour(hour).minute(minute)); }} /></ArcLocale>
    {seconds && value && <label className="arc-seconds">{t("秒")}<input type="number" min={0} max={59} disabled={disabled} value={value.second()} onChange={event => { const number = Number(event.target.value); if (Number.isInteger(number) && number >= 0 && number < 60) emit(value.second(number)); }} /></label>}
    {value && props.allowClear !== false && <Button size="small" disabled={disabled} onClick={() => emit(null)}>{t("清空")}</Button>}
  </div>;
}
