import { Card, Popconfirm, Space } from "antd";
import { App, Empty } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Button } from "@/components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { SubscriptionRequestDetails } from "./SubscriptionRequestDetails";
import { canCancelRequest, subscriptionError } from "./subscriptionOperations";

export function SubscriptionRequestDetailPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const canManage = useAuthStore((state) => state.hasPermission("rental-os:subscription:manage"));
  const userId = useAuthStore((state) => state.user?.id);
  const tenantId = useAuthStore((state) => state.tenant?.tenantId);
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["subscription", "tenant-view", tenantId, userId], queryFn: subscriptionApi.tenantView, enabled: Boolean(tenantId && userId) });
  const request = query.data?.requests.find((row) => row.id === id);
  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!canCancelRequest(request, canManage)) throw new Error(t("仅待处理申请可撤销"));
      return subscriptionApi.cancelRequest(id);
    },
    onSuccess: async () => {
      message.success(t("申请已撤销"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subscription", "tenant-view"] }),
        queryClient.invalidateQueries({ queryKey: ["subscription", "reminder"] })
      ]);
    },
    onError: (error) => message.error(subscriptionError(error, t("撤销失败，请联系平台")))
  });

  return <PageHeader title="申请详情"
    extra={<Button onClick={() => navigate(APP_ROUTES.subscription.path)}>{t("返回版本与订阅")}</Button>}
    view={<QueryState loading={query.isLoading}>
      {query.error ? <Alert type="error" showIcon message={subscriptionError(query.error, t("申请详情加载失败"))} action={<Button onClick={() => query.refetch()}>{t("重试")}</Button>} />
        : !request ? <Empty description={t("未找到当前租户的申请")} />
        : <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Alert type="info" showIcon message={t("申请不等于开通；实际以平台核实到账并保存版本与期限为准，办理结果会显示真实生效时间。")} />
          <Card size="small" title={t("申请与处理过程")}><SubscriptionRequestDetails request={request} timeZone={query.data?.overview.timeZone} /></Card>
          {canCancelRequest(request, canManage) && <Popconfirm title={t("确认撤销此待处理申请？")} description={t("已有线下资金请另联系平台处理，本操作不代表退款。")} onConfirm={() => cancelMutation.mutateAsync()}>
            <Button danger loading={cancelMutation.isPending}>{t("撤销申请")}</Button>
          </Popconfirm>}
        </Space>}
    </QueryState>} />;
}
