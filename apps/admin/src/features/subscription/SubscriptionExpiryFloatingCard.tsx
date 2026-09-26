import { CloseOutlined } from "@ant-design/icons";
import { Button, Card, Space, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { APP_ROUTES } from "@/app/navigation";

/**
 * SUB-02 §5.4 到期提醒浮窗：租户管理后台**全局**左下角小卡片，基础版与 PRO 都提醒。
 *
 * 静态骨架：结构与按钮就绪，但**只有拿到完整期限事实且进入提醒窗口才展示**（§5.4、§14.2：
 * 不得凭空生成到期 / 永久有效）。到期状态只读查询接总控 SUB-01 后替换 useSubscriptionReminder，
 * 当前恒返回 null，因此浮窗默认不出现。去重（账号/租户/授权修订/阶段/当天）、
 * 续费后撤旧、网络失败错误态一并在接入查询时补齐。
 */
interface ReminderView {
  headline: string;      // 例：基础版将于 YYYY-MM-DD 到期，还剩 X 天
  impact: string;        // 简短影响说明；已到期则提示停止新业务、旧订单可继续
  hasOpenApplication: boolean;
}

/** TODO(SUB-01)：接「到期状态只读查询」。期限不完整、不在提醒窗口、或查询失败时返回 null（不伪造到期）。 */
function useSubscriptionReminder(): ReminderView | null {
  return null;
}

export function SubscriptionExpiryFloatingCard() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const isSaasAdmin = useAuthStore((state) => Boolean(state.user?.isSaasAdmin));
  const canManage = useAuthStore((state) => state.hasPermission("rental-os:subscription:manage"));
  const reminder = useSubscriptionReminder();
  const [dismissed, setDismissed] = useState(false);

  // 平台账号不属于任何租户订阅，不显示；无数据 / 已关闭不显示。
  if (isSaasAdmin || !reminder || dismissed) return null;

  return (
    <div className="subscription-reminder" role="status" aria-live="polite"
      style={{ position: "fixed", left: 16, bottom: 16, zIndex: 900, maxWidth: 320 }}>
      <Card size="small" styles={{ body: { padding: 12 } }}>
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Space style={{ justifyContent: "space-between", width: "100%" }} align="start">
            <Typography.Text strong>{t(reminder.headline)}</Typography.Text>
            <Button type="text" size="small" aria-label={t("关闭提醒")} icon={<CloseOutlined />} onClick={() => setDismissed(true)} />
          </Space>
          <Typography.Text type="secondary">{t(reminder.impact)}</Typography.Text>
          {canManage ? (
            <Button type="primary" size="small" onClick={() => navigate(APP_ROUTES.subscription.path)}>
              {t(reminder.hasOpenApplication ? "查看办理进度" : "续费 / 查看订阅")}
            </Button>
          ) : (
            <Typography.Text type="secondary">{t("请联系租户管理员处理续费")}</Typography.Text>
          )}
        </Space>
      </Card>
    </div>
  );
}
