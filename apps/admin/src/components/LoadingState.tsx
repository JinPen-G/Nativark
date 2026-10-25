import { useLocale } from "@/app/locale";

/**
 * 页面/区块/会话恢复共用原像素网格 loading；不模拟不同业务页面的结构。
 * 所有页面级加载入口都使用这一处，保证后台的加载反馈一致。
 */

const PIXEL_DELAYS = [90, 180, 270, 0, 90, 180, 90, 180, 270];

export function LoadingState({ label }: { label?: string }) {
  const { t } = useLocale();

  return (
    <div className="rental-loading-state" role="status" aria-live="polite" aria-busy="true">
      <span className="rental-loading-grid" aria-hidden="true">
        {PIXEL_DELAYS.map((delay, index) => (
          <span className="rental-loading-cell" key={index} style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      <span className="rental-loading-label">{label ?? t("加载中")}</span>
    </div>
  );
}
