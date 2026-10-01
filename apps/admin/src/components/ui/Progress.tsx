import { Progress as AntProgress, type ProgressProps } from "antd";
import { Progress as ArcProgress } from "@/registry/components/progress/progress";
import { useLocale } from "@/app/locale";

export function Progress(props: ProgressProps) {
  const { t } = useLocale();
  if ((props.type && props.type !== "line") || props.steps || props.format || props.success || props.status === "exception" || props.strokeColor || props.trailColor) return <AntProgress {...props} />;
  return <ArcProgress value={Number.isFinite(props.percent) ? props.percent : 0} showValue={props.showInfo !== false} label={t("进度")} style={props.style} className={props.className} />;
}
