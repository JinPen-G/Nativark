import { App, FormSection, Modal } from "@/components/ui";
import { Col, Row } from "antd";
import { useEffect } from "react";
import { Form } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Input } from "@/components/ui";
import { Select } from "@/components/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SubscriptionPlan, SubscriptionRequestType, type SubmitSubscriptionRequestRequest } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { subscriptionApi } from "@/api/subscription";
import { REQUEST_TYPE_LABEL } from "./subscriptionLabels";
import { subscriptionError } from "./subscriptionOperations";
import { useSubscriptionCategoryLabels } from "./useSubscriptionCategoryLabels";

/**
 * SUB-02 §7.2 租户申请提交弹层。type 由入口按钮预置；targetPlan 由类型推导，不让用户改版本。
 * dedupeKey 按类型固定，重试/重复提交由后端按"同租户同类型未关闭"去重（§7.2）。
 * 提交表示申请已受理，不能被显示成已付款或已开通。
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
  useEffect(() => { if (open) form.resetFields(); }, [open, type, form]);
  const showModuleIntent = type === SubscriptionRequestType.UpgradeConsult || type === SubscriptionRequestType.UpgradePro;
  const categories = useSubscriptionCategoryLabels();

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
      onConfirm={() => form.validateFields().then((values) => mutation.mutateAsync(values))}
      onCancel={onClose}
      closable={!mutation.isPending}
      keyboard={!mutation.isPending}
      maskClosable={!mutation.isPending}
      cancelButtonProps={{ disabled: mutation.isPending }}
      afterClose={() => { form.resetFields(); mutation.reset(); }}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message={t("申请不等于开通，也不会自动收款；外部费用可能另计。规划中 / 试点功能不计入本次交付承诺。")} />
      <Form<FormValues> form={form} layout="vertical" disabled={mutation.isPending} onFinish={(values) => mutation.mutate(values)}>
        <FormSection title={t("联系与办理")}>
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item name="contactName" label={t("联系人")}><Input maxLength={64} allowClear /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="contactPhone" label={t("联系方式")}><Input maxLength={32} allowClear /></Form.Item></Col>
          </Row>
        <Form.Item name="moduleIntent" label={t("希望使用的模块（按品类，可多选）")} hidden={!showModuleIntent}>
          <Select mode="multiple" allowClear placeholder={t("仅表达意向，不保证规划项交付")}
            loading={categories.isLoading} disabled={categories.isLoading || Boolean(categories.error)} options={categories.options} />
        </Form.Item>
        <Form.Item name="note" label={t("需求说明（可选）")}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
        </FormSection>
      </Form>
      {mutation.error && <Alert type="error" showIcon title={t("申请提交失败")} description={subscriptionError(mutation.error, t("提交失败，请稍后重试或联系平台"))} />}
    </Modal>
  );
}
