import { App, Alert, Form, Input, Modal } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { GrantTenantFeatureRequest, RevokeTenantFeatureRequest, SubscriptionFeatureEntitlement } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { subscriptionApi } from "@/api/subscription";

/**
 * SUB-03 §3.5/§8 单租户额外授权 / 撤销弹层。
 * 授权 = tenant_specific 下放，不要求整体升级（§3.5）；撤销须填原因并保护既有承诺（§3.5.8）。
 * 公共下放（currentOwnership=基础版）与 PRO 自带权益不在此逐租户维护：目录页统一改归属。
 */
interface FormValues { reason?: string }

export function TenantFeatureGrantModal({
  open,
  mode,
  tenantId,
  feature,
  onClose
}: {
  open: boolean;
  mode: "grant" | "revoke";
  tenantId: string;
  feature: SubscriptionFeatureEntitlement | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const queryClient = useQueryClient();
  const isRevoke = mode === "revoke";

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const featureCode = feature?.code ?? "";
      return isRevoke
        ? subscriptionApi.revokeFeature(tenantId, { featureCode, reason: values.reason ?? "" } satisfies RevokeTenantFeatureRequest)
        : subscriptionApi.grantFeature(tenantId, { featureCode, reason: values.reason || undefined } satisfies GrantTenantFeatureRequest);
    },
    onSuccess: () => {
      message.success(t(isRevoke ? "已撤销额外授权" : "已额外授权"));
      void queryClient.invalidateQueries({ queryKey: ["subscription", "platform-detail", tenantId] });
      onClose();
    },
    onError: () => message.error(t("保存失败，请稍后重试（后端服务联调中）"))
  });

  return (
    <Modal
      open={open}
      title={`${t(isRevoke ? "撤销额外授权" : "额外授权功能")}${feature ? `：${feature.name}` : ""}`}
      okText={t(isRevoke ? "确认撤销" : "确认授权")}
      okButtonProps={{ danger: isRevoke, disabled: !feature }}
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Alert
        type={isRevoke ? "warning" : "info"}
        showIcon
        style={{ marginBottom: 16 }}
        message={t(isRevoke
          ? "撤销后该租户将失去此项额外授权；若功能已公共下放或属当前套餐权益则不受影响。请填写撤销原因备查。"
          : "仅为该租户额外授权此功能，不要求整体升级为 PRO；保存后即时生效。若需对所有基础版开放，请在功能目录页改为公共下放。")}
      />
      <Form<FormValues> form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
        <Form.Item name="reason" label={t(isRevoke ? "撤销原因（必填）" : "授权原因")} rules={isRevoke ? [{ required: true, whitespace: true }] : []}>
          <Input.TextArea rows={3} maxLength={200} placeholder={t(isRevoke ? "如：试点结束 / 误授权更正" : "如：签约赠送 / 试点开放")} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
