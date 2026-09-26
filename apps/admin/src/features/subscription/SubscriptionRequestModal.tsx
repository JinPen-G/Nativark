import { App, Alert, Form, Input, Modal, Select } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SubscriptionPlan, SubscriptionRequestType, type SubmitSubscriptionRequestRequest } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { subscriptionApi } from "@/api/subscription";
import { REQUEST_TYPE_LABEL } from "./subscriptionLabels";

/**
 * SUB-02 §7.2 租户申请提交弹层。type 由入口按钮预置；targetPlan 由类型推导，不让用户改版本。
 * dedupeKey 按类型固定，重试/重复提交由后端按"同租户同类型未关闭"去重（§7.2）。
 * 后端 service 通端点前，提交会失败并提示——页面不可达（权限未授予）故无实际影响。
 */
function targetPlanFor(type: SubscriptionRequestType): SubscriptionPlan | undefined {
  if (type === SubscriptionRequestType.UpgradePro || type === SubscriptionRequestType.RenewPro) return SubscriptionPlan.Pro;
  if (type === SubscriptionRequestType.RenewStandard || type === SubscriptionRequestType.NextStandard) return SubscriptionPlan.Standard;
  return undefined;
}

interface FormValues { moduleIntent?: string[]; contactName?: string; contactPhone?: string; note?: string }

export function SubscriptionRequestModal({ open, type, onClose }: { open: boolean; type: SubscriptionRequestType | null; onClose: () => void }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const body: SubmitSubscriptionRequestRequest = {
        type: type as SubscriptionRequestType,
        targetPlan: targetPlanFor(type as SubscriptionRequestType),
        moduleIntent: values.moduleIntent,
        contactName: values.contactName,
        contactPhone: values.contactPhone,
        note: values.note,
        dedupeKey: `subscription-request:${type}`
      };
      return subscriptionApi.submitRequest(body);
    },
    onSuccess: () => {
      message.success(t("申请已提交，实际以平台核实办理为准"));
      void queryClient.invalidateQueries({ queryKey: ["subscription", "tenant-view"] });
      void queryClient.invalidateQueries({ queryKey: ["subscription", "reminder"] });
      form.resetFields();
      onClose();
    },
    onError: () => message.error(t("提交失败，请稍后重试或联系平台"))
  });

  return (
    <Modal
      open={open}
      title={type ? `${t("提交申请")}：${t(REQUEST_TYPE_LABEL[type])}` : t("提交申请")}
      okText={t("提交申请")}
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={() => { form.resetFields(); onClose(); }}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message={t("申请不等于开通，也不会自动收款；外部费用可能另计。规划中 / 试点功能不计入本次交付承诺。")} />
      <Form<FormValues> form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
        <Form.Item name="moduleIntent" label={t("希望使用的模块（按品类，可多选）")}>
          <Select mode="multiple" allowClear placeholder={t("仅表达意向，不保证规划项交付")}
            options={[
              { value: "camera", label: t("摄影设备") }, { value: "camping", label: t("露营装备") },
              { value: "vehicle", label: t("车辆载具") }, { value: "construction", label: t("工程设备") }
            ]} />
        </Form.Item>
        <Form.Item name="contactName" label={t("联系人")}><Input maxLength={64} allowClear /></Form.Item>
        <Form.Item name="contactPhone" label={t("联系方式")}><Input maxLength={32} allowClear /></Form.Item>
        <Form.Item name="note" label={t("需求说明（可选）")}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
      </Form>
    </Modal>
  );
}
