import { App, InputNumber, Modal } from "antd";
import { Form } from "@/components/ui";
import { Alert } from "@/components/ui";
import { Input, Switch } from "@/components/ui";
import { Select } from "@/components/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SubscriptionPlan, type SetStandardPriceRequest, type StandardPlanPricing } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { subscriptionApi } from "@/api/subscription";
import { PLAN_LABEL } from "./subscriptionLabels";
import { subscriptionError } from "./subscriptionOperations";

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
        expectedPriceVersion: current?.priceVersion ?? null,
        published: values.published,
        annualFee: values.published ? (values.annualFee ?? undefined) : undefined,
        currency: values.published ? values.currency?.trim().toUpperCase() : undefined,
        taxInclusive: values.published ? values.taxInclusive : undefined,
        priceVersion: values.priceVersion?.trim() || undefined,
        note: values.note || undefined
      };
      return subscriptionApi.setStandardPrice(body.plan, body);
    },
    onSuccess: () => {
      message.success(t("已保存标准价"));
      void queryClient.invalidateQueries({ queryKey: ["subscription", "standard-prices"] });
      onClose();
    },
    onError: (error) => message.error(subscriptionError(error))
  });

  const initialValues: FormValues = {
    published: current?.published ?? false,
    annualFee: current?.annualFee?.amount,
    currency: current?.annualFee?.currency ?? "CNY",
    taxInclusive: current?.annualFee?.taxInclusive,
    priceVersion: undefined,
    note: current?.note
  };

  return (
    <Modal open={open} title={`${t("设置标准年费")}：${plan ? t(PLAN_LABEL[plan]) : ""}`} okText={t("保存")} confirmLoading={mutation.isPending}
      okButtonProps={{ disabled: !plan }} onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t("未发布时不展示金额（显示「价格待公布」），不落 0 或虚构价；发布后才对租户显示标准年费。")} />
      <Form<FormValues> form={form} layout="vertical" initialValues={initialValues} onFinish={(values) => mutation.mutate(values)}>
        <Form.Item name="published" label={t("已发布正式价格")} valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="annualFee" label={t("标准年费（不填=待公布，不落 0）")} rules={published ? [{ required: true, type: "number", min: 0.01, max: 9999999999.99 }] : []}><InputNumber min={0.01} max={9999999999.99} precision={2} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="currency" label={t("币种")} rules={published ? [{ required: true, pattern: /^[A-Za-z]{3}$/, message: t("请填写三位币种代码") }] : []}><Input placeholder="CNY" maxLength={3} /></Form.Item>
        <Form.Item name="taxInclusive" label={t("税口径")} rules={published ? [{ required: true }] : []}>
          <Select allowClear options={[{ value: true, label: t("含税") }, { value: false, label: t("未税") }]} />
        </Form.Item>
        <Form.Item name="priceVersion" label={t("新的价格方案版本")}><Input maxLength={64} placeholder={t("留空自动生成新版本")} /></Form.Item>
        <Form.Item name="note" label={t("说明")}><Input maxLength={200} /></Form.Item>
      </Form>
    </Modal>
  );
}
