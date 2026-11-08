/** Last-resort page rendering recovery. Never repeats a business command or
 * presents an unconfirmed save as failed/successful; original journals stay intact. */
import { useNavigate } from "react-router-dom";
import { Button, Result } from "@/components/ui";
import { useLocale } from "./locale";

export function RouteErrorPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  return <main className="route-error-page">
    <Result status="500" title={t("页面暂时无法显示")}
      subTitle={t("请重新加载页面。若刚提交过操作，请先核对结果。")}
      extra={<>
        <Button type="primary" onClick={() => window.location.reload()}>{t("重新加载页面")}</Button>
        <Button onClick={() => navigate("/", { replace: true })}>{t("返回可访问页面")}</Button>
      </>} />
  </main>;
}
