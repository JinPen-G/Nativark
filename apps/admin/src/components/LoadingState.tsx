import { useLocale } from "@/app/locale";

/**
 * 页面级加载态：保留像素网格的轻量动效，不显示耗时、模式切换或附加内容。
 * 所有页面级加载入口都使用这一处，保证后台的加载反馈一致。
 */
const PIXEL_DELAYS = [90, 180, 270, 0, 90, 180, 90, 180, 270];

export function LoadingState({ label }: { label?: string }) {
  const { t } = useLocale();

  return (
    <div className="rental-loading-state" role="status" aria-live="polite">
      <span className="rental-loading-grid" aria-hidden="true">
        {PIXEL_DELAYS.map((delay, index) => (
          <span
            className="rental-loading-cell"
            key={index}
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span>{label ?? t("加载中")}</span>
    </div>
  );
}
