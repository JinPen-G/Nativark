import { CloseOutlined } from "@ant-design/icons";
import { Card, Space, Typography } from "antd";
import { Button } from "@/components/ui";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SubscriptionServiceStatus } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { PLAN_LABEL, formatSubscriptionDate } from "./subscriptionLabels";
import { dismissReminder, reminderDismissalKey, reminderIsDismissed } from "./subscriptionReminder";

function storage() { try { return window.localStorage; } catch { return undefined; } }

export function SubscriptionExpiryFloatingCard() {
  const isSaasAdmin = useAuthStore((state) => Boolean(state.user?.isSaasAdmin));
  const canManage = useAuthStore((state) => state.hasPermission("rental-os:subscription:manage"));
  const accountId = useAuthStore((state) => state.user?.id);
  const tenantId = useAuthStore((state) => state.tenant?.tenantId);
  if (isSaasAdmin || !accountId || !tenantId) return null;
  // Remount only for identity changes, never for workspace navigation; in-flight data has a separate scoped query key.
  return <ScopedExpiryCard key={`${accountId}:${tenantId}`} accountId={accountId} tenantId={tenantId} canManage={canManage} />;
}

function ScopedExpiryCard({ accountId, tenantId, canManage }: { accountId: string; tenantId: string; canManage: boolean }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [storageVersion, setStorageVersion] = useState(0);
  const query = useQuery({
    queryKey: ["subscription", "reminder", tenantId, accountId], queryFn: subscriptionApi.expiryReminder,
    retry: false, refetchInterval: 60_000, refetchOnWindowFocus: "always", staleTime: 0
  });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    const onStorage = () => setStorageVersion((value) => value + 1);
    window.addEventListener("storage", onStorage);
    return () => { window.clearInterval(timer); window.removeEventListener("storage", onStorage); };
  }, []);
  const endAt = query.data?.endAt;
  useEffect(() => {
    if (!endAt) return;
    const remaining = Date.parse(endAt) - Date.now();
    if (remaining <= 0 || remaining > 2_147_483_647) return;
    const timer = window.setTimeout(() => { setNow(Date.now()); void query.refetch(); }, remaining + 1);
    return () => window.clearTimeout(timer);
  }, [endAt, query.refetch]);
  const reminder = query.data;
  const key = reminder ? reminderDismissalKey({ accountId, tenantId }, reminder, now) : null;
  // Re-read when another tab closes the card. No closure should leak into a new identity/revision/stage/day.
  void storageVersion;
  if (!key || !reminder || dismissedKey === key || reminderIsDismissed(storage(), key)) return null;
  const expired = reminder.serviceStatus === SubscriptionServiceStatus.Expired;
  const summary = query.error ? t("未能刷新订阅期限，请重试；当前服务状态以服务器校验为准。")
    : `${t(PLAN_LABEL[reminder.plan])} · ${t(expired ? "已到期" : "即将到期")}\n${formatSubscriptionDate(reminder.endAt, reminder.timeZone)}${typeof reminder.remainingDays === "number" && !expired ? ` · ${t("剩余")} ${reminder.remainingDays} ${t("天")}` : ""}`;

  return <div className="subscription-reminder" role="status" aria-live="polite">
    <Card size="small" styles={{ body: { padding: 12 } }}>
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <div className="subscription-reminder-heading">
          <Typography.Text strong style={{ whiteSpace: "pre-line", minWidth: 0 }}>{summary}</Typography.Text>
          <Button type="text" size="small" aria-label={t("关闭提醒")} icon={<CloseOutlined />} onClick={() => { dismissReminder(storage(), key); setDismissedKey(key); }} />
        </div>
        {!query.error && <Typography.Text type="secondary">{t(expired ? "新业务已停止，已有订单可继续处理。" : "截止前仍可按现行授权经营，请及时联系平台续费。")}</Typography.Text>}
        {query.error ? <Button size="small" onClick={() => query.refetch()} loading={query.isFetching}>{t("重试")}</Button>
          : canManage ? <Button type="primary" size="small" onClick={() => navigate(APP_ROUTES.subscription.path)}>{t(reminder.hasOpenRequest ? "查看办理进度" : "续费 / 查看订阅")}</Button>
            : <Typography.Text type="secondary">{t("请联系租户管理员处理续费")}</Typography.Text>}
      </Space>
    </Card>
  </div>;
}
