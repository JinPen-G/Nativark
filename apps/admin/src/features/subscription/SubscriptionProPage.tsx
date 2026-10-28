import { useState } from "react";
import { Space } from "antd";
import { Alert, Button, Select } from "@/components/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SubscriptionPlan, SubscriptionRequestStatus, SubscriptionRequestType } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { SubscriptionRequestModal } from "./SubscriptionRequestModal";
import { subscriptionError } from "./subscriptionOperations";
import { PlanComparison } from "./plan-comparison/PlanComparison";

/** Published catalog projection only; plan selection never grants access or charges a tenant. */
export function SubscriptionProPage() {
  const { t } = useLocale(), navigate = useNavigate();
  const canManage = useAuthStore(state => state.hasPermission("rental-os:subscription:manage"));
  const userId = useAuthStore(state => state.user?.id), tenantId = useAuthStore(state => state.tenant?.tenantId);
  const query = useQuery({ queryKey: ["subscription", "tenant-view", tenantId, userId], queryFn: subscriptionApi.tenantView, enabled: Boolean(tenantId && userId) });
  const [requestType, setRequestType] = useState<SubscriptionRequestType | null>(null);
  const [category, setCategory] = useState<string>();
  const categories = [...new Set(query.data?.entitlements.flatMap(feature => feature.categories) ?? [])];
  const categoryLabels: Record<string, string> = { camera: "摄影设备", camping: "露营装备", vehicle: "车辆载具", construction: "工程设备" };
  const features = query.data?.entitlements.filter(feature => !category || !feature.categories.length || feature.categories.includes(category)) ?? [];
  const actionType = (plan: SubscriptionPlan) => plan === query.data?.overview.plan
    ? plan === SubscriptionPlan.Pro ? SubscriptionRequestType.RenewPro : SubscriptionRequestType.RenewStandard
    : plan === SubscriptionPlan.Pro ? SubscriptionRequestType.UpgradeConsult : SubscriptionRequestType.NextStandard;
  const pendingRequest = (plan: SubscriptionPlan) => query.data?.requests.find(request => request.type === actionType(plan) && request.status === SubscriptionRequestStatus.Pending);
  return <PageHeader title="版本对比" extra={<Button onClick={() => navigate(APP_ROUTES.subscription.path)}>{t("返回版本与订阅")}</Button>}
    view={<QueryState loading={query.isLoading}>
      {query.error ? <Alert type="error" message={subscriptionError(query.error, t("订阅介绍加载失败"))} action={<Button onClick={() => query.refetch()}>{t("重试")}</Button>} /> : query.data && <div style={{ display: "grid", gap: "var(--rental-layout-section-gap)", minWidth: 0 }}>
        <Alert type="info" showIcon message={t("PRO 暂仅接受咨询或受控试点，正式销售尚未开放。")} />
        {categories.length > 0 && <Space wrap><Select allowClear style={{ width: "var(--rental-control-width-select)" }} placeholder={t("全部适用品类")} value={category} onChange={setCategory} options={categories.map(value => ({ value, label: t(categoryLabels[value] ?? value) }))} /></Space>}
        <PlanComparison key={tenantId} features={features} prices={query.data.standardPricing} currentPlan={query.data.overview.plan} actionDisabled={!canManage}
          actionLabel={plan => pendingRequest(plan) ? t("查看申请进度") : t(plan === query.data?.overview.plan ? "申请续费" : plan === SubscriptionPlan.Pro ? "升级咨询" : "申请下期基础版")}
          onAction={plan => { const pending = pendingRequest(plan); if (pending) navigate(`${APP_ROUTES.subscription.path}/requests/${encodeURIComponent(pending.id)}`); else setRequestType(actionType(plan)); }} />
        <span className="text-meta">{t("实际使用仍须满足有效期、租户授权、品类与空间配置；选择版本不会自动开通或扣费。")}</span>
        <SubscriptionRequestModal open={requestType !== null} type={requestType} onClose={() => setRequestType(null)} />
      </div>}
    </QueryState>} />;
}
