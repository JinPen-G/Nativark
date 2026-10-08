import { useLocale } from "@/app/locale";
import { Skeleton } from "./ui/Skeleton";

/**
 * 页面级加载态：使用原版 Arc Skeleton，不显示耗时、模式切换或附加内容。
 * 所有页面级加载入口都使用这一处，保证后台的加载反馈一致。
 */

export function LoadingState({ label }: { label?: string }) {
  const { t } = useLocale();

  return (
    <div className="rental-loading-state" role="status" aria-live="polite">
      <Skeleton lines={3} label={label ?? t("加载中")} className="rental-loading-skeleton" />
      <span>{label ?? t("加载中")}</span>
    </div>
  );
}
