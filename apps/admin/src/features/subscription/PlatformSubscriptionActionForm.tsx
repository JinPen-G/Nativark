import { App, Alert, Button, DatePicker, Form, Input, InputNumber, Select, Space } from "antd";
import type { Dayjs } from "dayjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  SubscriptionPlan,
  SubscriptionSource,
  type ExtendSubscriptionRequest,
  type ProvisionSubscriptionRequest,
  type RenewSubscriptionRequest,
  type ScheduleNextSubscriptionRequest,
  type UpgradeSubscriptionProRequest
} from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { subscriptionApi } from "@/api/subscription";

/**
 * SUB-03 §8.2 平台直接办理表单：按办理类型派发到 provision/renew/upgrade/extend/schedule-next 写请求。
 * 目标租户走路径参数；金额缺省=待确认不落 0（§14.2）；开始/截止由服务端按周年规则最终判定。
 * 后端 service 通端点前，保存会失败并提示"联调中"（页面仅 SaaS 管理员可达）。
 */
type OperationType = "activate" | "upgrade" | "renew" | "extend" | "next_standard";
interface FormValues {
  operationType: OperationType;
  plan?: SubscriptionPlan;
  source?: SubscriptionSource;
  startAt?: Dayjs;
  serviceYears?: number;
  endAt?: Dayjs;
  amount?: number;
  currency?: string;
  reason?: string;
}

export function PlatformSubscriptionActionForm({ tenantId }: { tenantId: string }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const queryClient = useQueryClient();
  const operationType = Form.useWatch("operationType", form) ?? "activate";
  const iso = (value?: Dayjs) => value?.toISOString();

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const source = values.source ?? SubscriptionSource.Sale;
      const plan = values.plan ?? SubscriptionPlan.Standard;
      switch (values.operationType) {
        case "activate":
          return subscriptionApi.provision(tenantId, { plan, source, startAt: iso(values.startAt) ?? "", serviceYears: values.serviceYears, endAt: iso(values.endAt), amount: values.amount ?? undefined, currency: values.currency, reason: values.reason } satisfies ProvisionSubscriptionRequest);
        case "renew":
          return subscriptionApi.renew(tenantId, { plan, source, startAt: iso(values.startAt), serviceYears: values.serviceYears, endAt: iso(values.endAt), amount: values.amount ?? undefined, currency: values.currency, reason: values.reason } satisfies RenewSubscriptionRequest);
        case "upgrade":
          return subscriptionApi.upgrade(tenantId, { source, amount: values.amount ?? undefined, currency: values.currency, reason: values.reason } satisfies UpgradeSubscriptionProRequest);
        case "extend":
          return subscriptionApi.extend(tenantId, { endAt: iso(values.endAt) ?? "", reason: values.reason ?? "" } satisfies ExtendSubscriptionRequest);
        case "next_standard":
          return subscriptionApi.scheduleNext(tenantId, { plan: SubscriptionPlan.Standard, source, effectiveAt: iso(values.startAt) ?? "", serviceYears: values.serviceYears, endAt: iso(values.endAt), amount: values.amount ?? undefined, currency: values.currency, reason: values.reason } satisfies ScheduleNextSubscriptionRequest);
        default:
          throw new Error("unknown operation");
      }
    },
    onSuccess: () => {
      message.success(t("已保存办理"));
      void queryClient.invalidateQueries({ queryKey: ["subscription", "platform-detail", tenantId] });
      void queryClient.invalidateQueries({ queryKey: ["subscription", "platform-list"] });
      form.resetFields();
    },
    onError: () => message.error(t("保存失败，请稍后重试（后端服务联调中）"))
  });

  const isUpgrade = operationType === "upgrade";
  const isExtend = operationType === "extend";
  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message={t("线下收款以平台收款账户与商业记录为依据；上传凭证不等于核实到账。正常售卖 PRO 须满足四品类首批销售条件。保存前核对租户、目标套餐与起止时间。")} />
      <Form<FormValues> form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}
        initialValues={{ operationType: "activate", plan: SubscriptionPlan.Standard, source: SubscriptionSource.Sale }}>
        <Space wrap align="start" size={16}>
          <Form.Item name="operationType" label={t("办理类型")} style={{ minWidth: 200 }} rules={[{ required: true }]}>
            <Select options={[
              { value: "activate", label: t("直接开通") }, { value: "upgrade", label: t("升级 PRO") }, { value: "renew", label: t("续期") },
              { value: "extend", label: t("临时延长") }, { value: "next_standard", label: t("下期降级为基础版") }
            ]} />
          </Form.Item>
          <Form.Item name="plan" label={t("版本")} style={{ minWidth: 160 }} hidden={isUpgrade || isExtend || operationType === "next_standard"}>
            <Select options={[{ value: SubscriptionPlan.Standard, label: t("基础版") }, { value: SubscriptionPlan.Pro, label: "PRO" }]} />
          </Form.Item>
          <Form.Item name="source" label={t("办理来源")} style={{ minWidth: 180 }} hidden={isExtend}>
            <Select options={[
              { value: SubscriptionSource.Sale, label: t("正常售卖") }, { value: SubscriptionSource.Pilot, label: t("受控试点") },
              { value: SubscriptionSource.HistoricalRegister, label: t("历史登记") }, { value: SubscriptionSource.TempExtension, label: t("临时延长") }
            ]} />
          </Form.Item>
        </Space>
        <Space wrap align="start" size={16}>
          <Form.Item name="startAt" label={t(operationType === "next_standard" ? "下一段开始（含时区）" : "开始日期（含时区）")} style={{ minWidth: 200 }} rules={operationType === "activate" || operationType === "next_standard" ? [{ required: true }] : []} hidden={isUpgrade || isExtend}><DatePicker style={{ width: "100%" }} showTime /></Form.Item>
          <Form.Item name="serviceYears" label={t("服务年数")} style={{ minWidth: 140 }} tooltip={t("按周年规则推算截止，可核对后改")} hidden={isUpgrade || isExtend}><InputNumber min={1} max={10} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="endAt" label={t(isExtend ? "新截止（含时区，必填）" : "或自定义截止日期")} style={{ minWidth: 200 }} rules={isExtend ? [{ required: true }] : []} hidden={isUpgrade}><DatePicker style={{ width: "100%" }} showTime /></Form.Item>
        </Space>
        <Space wrap align="start" size={16}>
          <Form.Item name="amount" label={t("实际收费金额")} style={{ minWidth: 160 }} tooltip={t("标准价待公布；缺省=待确认，不落 0")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="currency" label={t("币种")} style={{ minWidth: 120 }}><Input placeholder="CNY" maxLength={8} /></Form.Item>
          <Form.Item name="reason" label={t(isExtend ? "原因（必填）" : "调整原因 / 转账备注")} style={{ minWidth: 280 }} rules={isExtend ? [{ required: true }] : []}><Input placeholder={t("试点 / 历史登记 / 临时延长 / 优惠等原因")} /></Form.Item>
        </Space>
        <Form.Item><Button type="primary" htmlType="submit" loading={mutation.isPending}>{t("保存办理")}</Button></Form.Item>
      </Form>
    </>
  );
}
