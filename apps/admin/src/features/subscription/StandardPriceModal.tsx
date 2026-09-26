import { App, Alert, Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SubscriptionPlan, type SetStandardPriceRequest, type StandardPlanPricing } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { subscriptionApi } from "@/api/subscription";
import { PLAN_LABEL } from "./subscriptionLabels";

/**
 * SUB-03 §5.2/§8 标准套餐年费维护弹层。未发布 published=false 且不落金额（§14.2：不显示 0/虚构价）。
 */
interface FormValues { published: boolean; annualFee?: number | null; currency?: string; taxInclusive?: boolean; priceVersion?: string; note?: string }

export function StandardPriceModal({ open, plan, current, onClose }: { open: boolean; plan: SubscriptionPlan | null; current: StandardPlanPricing | null; onClose: () => void }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const queryClient = useQueryClient();
  // 已发布则年费与币种必填：避免出现「已发布却无金额」这种对租户仍显示「价格待公布」的自相矛盾态（§14.2）。
  const published = Form.useWatch("published", form);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const body: SetStandardPriceRequest = {
        plan: plan as SubscriptionPlan,
        published: values.published,
        // §14.2：未发布或留空不落金额。
        annualFee: values.published ? (values.annualFee ?? undefined) : undefined,
        currency: values.currency || undefined,
        taxInclusive: values.taxInclusive,
        priceVersion: values.priceVersion || undefined,
        note: values.note || undefined
      };
      return subscriptionApi.setStandardPrice(body.plan, body);
    },
    onSuccess: () => {
      message.success(t("已保存标准价"));
      void queryClient.invalidateQueries({ queryKey: ["subscription", "standard-prices"] });
      onClose();
    },
    onError: () => message.error(t("保存失败，请稍后重试（后端服务联调中）"))
  });

  const initialValues: FormValues = {
    published: current?.published ?? false,
    annualFee: current?.annualFee?.amount,
    currency: current?.annualFee?.currency ?? "CNY",
    taxInclusive: current?.annualFee?.taxInclusive,
    priceVersion: current?.priceVersion,
    note: current?.note
  };

  return (
    <Modal open={open} title={`${t("设置标准年费")}：${plan ? t(PLAN_LABEL[plan]) : ""}`} okText={t("保存")} confirmLoading={mutation.isPending}
      okButtonProps={{ disabled: !plan }} onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t("未发布时不展示金额（显示「价格待公布」），不落 0 或虚构价；发布后才对租户显示标准年费。")} />
      <Form<FormValues> form={form} layout="vertical" initialValues={initialValues} onFinish={(values) => mutation.mutate(values)}>
        <Form.Item name="published" label={t("已发布正式价格")} valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="annualFee" label={t("标准年费（不填=待公布，不落 0）")} rules={published ? [{ required: true, message: t("发布正式价格时必须填写年费") }] : []}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="currency" label={t("币种")} rules={published ? [{ required: true, whitespace: true, message: t("发布正式价格时必须填写币种") }] : []}><Input placeholder="CNY" maxLength={8} /></Form.Item>
        <Form.Item name="taxInclusive" label={t("税口径")}>
          <Select allowClear options={[{ value: true, label: t("含税") }, { value: false, label: t("未税") }]} />
        </Form.Item>
        <Form.Item name="priceVersion" label={t("价格方案版本")}><Input maxLength={64} /></Form.Item>
        <Form.Item name="note" label={t("说明")}><Input maxLength={200} /></Form.Item>
      </Form>
    </Modal>
  );
}
