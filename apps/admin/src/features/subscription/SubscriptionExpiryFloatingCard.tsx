import { CloseOutlined } from "@ant-design/icons";
import { Button, Card, Space, Typography } from "antd";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SubscriptionReminderStage, SubscriptionServiceStatus, type SubscriptionExpiryReminder } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { PLAN_LABEL } from "./subscriptionLabels";

/**
 * SUB-02 §5.4 到期提醒浮窗：租户管理后台全局左下角，基础版与 PRO 都提醒。
 *
 * 只对本租户订阅可见者查询（平台账号、无 view 权限不查）；无提醒 / stage=none / 关闭 / 查询失败
 * 时不出现——不伪造到期（§5.4、§14.2）。定位由 styles.css 的 .subscription-reminder 负责，桌面避开左侧栏。
 * TODO(SUB-04)：去重键（账号/租户/授权修订/阶段/当天）、续费后撤旧、短信/邮件另行接入。
 */
function headline(reminder: SubscriptionExpiryReminder, t: (value: string) => string): string {
  const plan = t(PLAN_LABEL[reminder.plan]);
  if (reminder.serviceStatus === SubscriptionServiceStatus.Expired) return `${plan}${t("已到期，新业务已停止，已有订单可继续处理")}`;
  if (typeof reminder.remainingDays === "number" && reminder.endAt) {
    return `${plan}${t("将于")} ${reminder.endAt} ${t("到期，还剩")} ${reminder.remainingDays} ${t("天")}`;
  }
  return `${plan}${t("即将到期，请及时联系平台续费")}`;
}

export function SubscriptionExpiryFloatingCard() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const isSaasAdmin = useAuthStore((state) => Boolean(state.user?.isSaasAdmin));
  const canView = useAuthStore((state) => state.hasPermission("rental-os:subscription:view"));
  const canManage = useAuthStore((state) => state.hasPermission("rental-os:subscription:manage"));
  const [dismissed, setDismissed] = useState(false);
  const query = useQuery({
    queryKey: ["subscription", "reminder"],
    queryFn: subscriptionApi.expiryReminder,
    enabled: !isSaasAdmin && canView,
    retry: false // 被动提醒：失败静默不打扰，不伪造到期。
  });

  const reminder = query.data ?? undefined;
  if (isSaasAdmin || dismissed || !reminder || reminder.stage === SubscriptionReminderStage.None) return null;

  return (
    <div className="subscription-reminder" role="status" aria-live="polite">
      <Card size="small" styles={{ body: { padding: 12 } }}>
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Space style={{ justifyContent: "space-between", width: "100%" }} align="start">
            <Typography.Text strong>{headline(reminder, t)}</Typography.Text>
            <Button type="text" size="small" aria-label={t("关闭提醒")} icon={<CloseOutlined />} onClick={() => setDismissed(true)} />
          </Space>
          {reminder.message && <Typography.Text type="secondary">{t(reminder.message)}</Typography.Text>}
          {canManage ? (
            <Button type="primary" size="small" onClick={() => navigate(APP_ROUTES.subscription.path)}>
              {t(reminder.hasOpenRequest ? "查看办理进度" : "续费 / 查看订阅")}
            </Button>
          ) : (
            <Typography.Text type="secondary">{t("请联系租户管理员处理续费")}</Typography.Text>
          )}
        </Space>
      </Card>
    </div>
  );
}
