import { Alert, App, Button, Card, Descriptions, Space, Tag, Typography } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";

/**
 * SUB-02 申请详情页（需求 §7.2/§7.3），路由 /settings/subscription/requests/:id。
 *
 * 静态骨架：展示申请字段与状态；「申请不等于开通、收款以平台核实为准」如实说明。
 * 撤销仅对未办理(pending)申请、且具订阅管理权限者开放；数据与动作接总控契约（TODO）。
 */
export function SubscriptionRequestDetailPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const canManage = useAuthStore((state) => state.hasPermission("rental-os:subscription:manage"));
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: () => subscriptionApi.cancelRequest(id),
    onSuccess: () => { message.success(t("申请已撤销")); void queryClient.invalidateQueries({ queryKey: ["subscription", "tenant-view"] }); void queryClient.invalidateQueries({ queryKey: ["subscription", "reminder"] }); navigate(APP_ROUTES.subscription.path); },
    onError: () => message.error(t("撤销失败，请稍后重试或联系平台"))
  });
  const PLACEHOLDER = "待接入";

  return (
    <PageHeader
      title="申请详情"
      description="查看升级 / 续费 / 降级 / 不续费申请的类型、目标、进度与办理结果。"
      view={
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Alert type="info" showIcon message={t("申请不等于开通；实际以平台核实到账并保存版本与期限为准，办理结果会显示真实生效时间。")} />
          <Card size="small" title={`${t("申请编号")}：${id || PLACEHOLDER}`}>
            <Descriptions column={{ xs: 1, md: 2 }} size="small" colon={false}
              items={[
                { key: "type", label: t("申请类型"), children: t(PLACEHOLDER) },
                { key: "status", label: t("状态"), children: <Tag>{t(PLACEHOLDER)}</Tag> },
                { key: "current", label: t("当前版本与期限"), children: t(PLACEHOLDER) },
                { key: "target", label: t("目标"), children: t(PLACEHOLDER) },
                { key: "modules", label: t("希望使用的模块"), children: t(PLACEHOLDER) },
                { key: "contact", label: t("联系人 / 联系方式"), children: t(PLACEHOLDER) },
                { key: "period", label: t("意向期间"), children: t("价格待公布时仅记录咨询意向") },
                { key: "handled", label: t("实际办理金额 / 期限 / 结果"), children: t(PLACEHOLDER) },
                { key: "note", label: t("需求说明"), children: t(PLACEHOLDER) }
              ]}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              {t("处理过程与可公开原因在此展示。")}
            </Typography.Paragraph>
          </Card>
          <Space wrap>
            <Button onClick={() => navigate(APP_ROUTES.subscription.path)}>{t("返回版本与订阅")}</Button>
            {/* 仅未办理申请可撤销；已收款 / 已开通须联系平台处理，不伪造退款（§7.2）。写动作 :manage 门禁 + 待接契约。 */}
            <Button danger disabled={!canManage} loading={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>{t("撤销申请")}</Button>
          </Space>
        </Space>
      }
    />
  );
}
