import { Steps as AntSteps, type StepsProps } from "antd";
import { Stepper } from "@/registry/components/stepper/stepper";
import { useLocale } from "@/app/locale";
import { Button } from "./Button";

export function Steps(props: StepsProps & { reachable?: number }) {
  const { t } = useLocale();
  if (props.items?.some(item => typeof item.title !== "string" || (item.description != null && typeof item.description !== "string") || item.icon || item.disabled) || props.type || props.progressDot || props.initial || props.percent || props.status) return <AntSteps {...props} />;
  return <div style={props.style}><Stepper current={props.current ?? 0} orientation={props.orientation ?? "horizontal"} label={t("步骤")} completeLabel={t("已完成")} className={props.className}
    steps={(props.items ?? []).map((item, index) => ({ id: String(index), label: String(item.title ?? ""), description: item.description as string | undefined, error: item.status === "error" ? String(item.description ?? t("失败")) : undefined }))}
    onStepSelect={props.onChange} />{props.onChange && props.reachable != null && props.reachable > (props.current ?? 0) && <div className="arc-range-presets">{props.items?.map((item, index) => index > (props.current ?? 0) && index <= props.reachable! ? <Button key={index} size="small" disabled={item.disabled} onClick={() => props.onChange?.(index)}>{item.title}</Button> : null)}</div>}</div>;
}
