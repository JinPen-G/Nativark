import { useState } from "react";
import { App, Alert, Button, Form, Input, InputNumber, Select, Space, Typography } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SubscriptionPlan, SubscriptionSource, type StandardPlanPricing, type SubscriptionRequestRecord, type TenantSubscriptionOverview } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { subscriptionApi } from "@/api/subscription";
import { formatSubscriptionDate, PLAN_LABEL, REQUEST_TYPE_LABEL } from "./subscriptionLabels";
import { buildSubscriptionAction, initialSubscriptionAction, operationForRequest, subscriptionError, subscriptionTermPreview, type SubscriptionActionValues, type SubscriptionOperation } from "./subscriptionOperations";

/** Each editor owns an immutable authorization/price snapshot until explicit reload or successful save. */
export function PlatformSubscriptionActionForm({ tenantId, overview, standardPricing, request, onSaved }: {
  tenantId: string;
  overview: TenantSubscriptionOverview;
  standardPricing: StandardPlanPricing[];
  request?: SubscriptionRequestRecord;
  onSaved?: () => void;
}) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<SubscriptionActionValues>();
  const [snapshot, setSnapshot] = useState(() => structuredClone(overview));
  const [prices, setPrices] = useState(() => structuredClone(standardPricing));
  const [reloading, setReloading] = useState(false);
  const initial = initialSubscriptionAction(snapshot, request ? operationForRequest(request, snapshot) ?? "activate" : "activate", Date.now(), request);
  const watched = Form.useWatch([], form) as Partial<SubscriptionActionValues> | undefined;
  const values = { ...initial, ...watched };
  const operationType = values.operationType;
  const isUpgrade = operationType === "upgrade";
  const isExtend = operationType === "extend";
  const stale = overview.revision !== snapshot.revision;
  const moneyRequired = values.source === SubscriptionSource.Sale || values.amount != null;
  const targetPlan = isUpgrade ? SubscriptionPlan.Pro : operationType === "next_standard" ? SubscriptionPlan.Standard : values.plan;
  const selectedPrice = prices.find((p) => p.plan === targetPlan && p.published);
  let preview: { startAt?: string; endAt?: string } | undefined;
  let previewError: string | undefined;
  try { preview = subscriptionTermPreview(values, snapshot); } catch (error) { previewError = subscriptionError(error); }

  async function reload() {
    setReloading(true);
    try {
      const data = await queryClient.fetchQuery({ queryKey: ["subscription", "platform-detail", tenantId], queryFn: () => subscriptionApi.platformDetail(tenantId), staleTime: 0 });
      setSnapshot(structuredClone(data.overview));
      setPrices(structuredClone(data.standardPricing));
      form.resetFields();
      form.setFieldsValue(initialSubscriptionAction(data.overview, operationType, Date.now(), request));
      mutation.reset();
    } catch (error) { message.error(subscriptionError(error, t("重新加载失败"))); }
    finally { setReloading(false); }
  }

  const mutation = useMutation({
    mutationFn: (formValues: SubscriptionActionValues) => {
      const action = buildSubscriptionAction(formValues, snapshot, request);
      switch (action.operation) {
        case "activate": return subscriptionApi.provision(tenantId, action.payload);
        case "renew": return subscriptionApi.renew(tenantId, action.payload);
        case "upgrade": return subscriptionApi.upgrade(tenantId, action.payload);
        case "extend": return subscriptionApi.extend(tenantId, action.payload);
        case "next_standard": return subscriptionApi.scheduleNext(tenantId, action.payload);
      }
    },
    onSuccess: async () => {
      message.success(t("已保存办理"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subscription", "platform-detail", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["subscription", "platform-list"] }),
        queryClient.invalidateQueries({ queryKey: ["subscription", "tenant-view"] }),
        queryClient.invalidateQueries({ queryKey: ["subscription", "reminder"] })
      ]);
      if (request) onSaved?.();
      else await reload();
    },
    onError: (error) => message.error(subscriptionError(error))
  });

  function changeOperation(next: SubscriptionOperation) {
    form.resetFields();
    form.setFieldsValue(initialSubscriptionAction(snapshot, next, Date.now(), request));
    mutation.reset();
  }

  return <>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t("线下收款须先核实到账。正式 PRO 销售尚未开放，仅可按明确依据登记受控试点；保存失败不等于退款，请勿要求重复付款。所有时间采用租户统一服务时区，不随空间或浏览器改变。")} />
    {request && <Alert style={{ marginBottom: 12 }} message={`${t("关联待处理申请")}：${request.id} · ${t(REQUEST_TYPE_LABEL[request.type])}`} description={t("保存实际授权成功后，将同时完成此申请；失败时申请保持待处理。仅登记咨询 / 不续费无需授权操作。可公开办理依据将进入申请记录，请勿填内部敏感信息。")} />}
    {stale && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t("授权已被其他操作更新，本表单仍保留原修订。请重新载入并核对，不能覆盖最新授权。")} />}
    {mutation.error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={subscriptionError(mutation.error)} description={t("本次未完成开通；已核实的线下收款仍须保留，刷新复核后再办理。")} />}
    <Form<SubscriptionActionValues> form={form} layout="vertical" initialValues={initial} onFinish={(data) => mutation.mutate(data)} disabled={mutation.isPending || reloading}>
      <Space wrap align="start" size={16}>
        <Form.Item name="operationType" label={t("办理类型")} style={{ minWidth: 200 }} rules={[{ required: true }]}>
          <Select disabled={Boolean(request) || mutation.isPending || reloading} onChange={changeOperation} options={[
            { value: "activate", label: t("直接开通") }, { value: "upgrade", label: t("升级 PRO") }, { value: "renew", label: t("续期") },
            { value: "extend", label: t("临时延长") }, { value: "next_standard", label: t("下期降级为基础版") }
          ]} />
        </Form.Item>
        {!isUpgrade && !isExtend && operationType !== "next_standard" && <Form.Item name="plan" label={t("版本")} style={{ minWidth: 160 }}>
          <Select disabled={Boolean(request) || mutation.isPending || reloading} onChange={() => form.setFieldValue("priceVersion", undefined)} options={[{ value: SubscriptionPlan.Standard, label: t("基础版") }, { value: SubscriptionPlan.Pro, label: "PRO" }]} />
        </Form.Item>}
        {!isExtend && <Form.Item name="source" label={t("办理来源")} style={{ minWidth: 180 }} rules={[{ required: true }]}>
          <Select options={[
            { value: SubscriptionSource.Sale, label: t("正常售卖"), disabled: targetPlan === SubscriptionPlan.Pro },
            { value: SubscriptionSource.Pilot, label: t("受控试点") }, { value: SubscriptionSource.HistoricalRegister, label: t("历史登记") }
          ]} />
        </Form.Item>}
        <Form.Item name="timeZone" label={t("服务时区（IANA）")} style={{ minWidth: 210 }} rules={[{ required: true, whitespace: true }]}>
          <Input readOnly={operationType !== "activate"} placeholder="Asia/Shanghai" />
        </Form.Item>
      </Space>
      {!isUpgrade && <Space wrap align="start" size={16}>
        {!isExtend && <>
          <Form.Item name="startAt" label={t(operationType === "next_standard" ? "下一段开始（含）" : "服务开始（含）")} rules={[{ required: true }]}>
            <Input type="datetime-local" step={0.001} />
          </Form.Item>
          <Form.Item name="termMode" label={t("期限方式")}>
            <Select style={{ width: 170 }} onChange={(mode) => form.setFieldsValue(mode === "years" ? { endAt: undefined, serviceYears: 1 } : { serviceYears: undefined, endAt: undefined })}
              options={[{ value: "years", label: t("服务年数") }, { value: "custom", label: t("明确截止时点") }]} />
          </Form.Item>
        </>}
        {!isExtend && values.termMode === "years" && <Form.Item name="serviceYears" label={t("服务年数（按日历周年）")} rules={[{ required: true }, { type: "integer", min: 1, max: 100 }]}><InputNumber min={1} max={100} /></Form.Item>}
        {(isExtend || values.termMode === "custom") && <Form.Item name="endAt" label={t(isExtend ? "新截止时点（不含）" : "服务截止时点（不含）")} rules={[{ required: true }]}><Input type="datetime-local" step={0.001} /></Form.Item>}
      </Space>}
      <Typography.Paragraph type={previewError ? "secondary" : undefined}>
        {previewError ? t(previewError) : `${t(isUpgrade ? "升级保持当前统一截止" : "保存前核对最终期间")}：[${formatSubscriptionDate(preview?.startAt, values.timeZone)}, ${formatSubscriptionDate(preview?.endAt, values.timeZone)})`}
      </Typography.Paragraph>
      {!isExtend && <Space wrap align="start" size={16}>
        <Form.Item name="amount" label={t("实际收费金额")} rules={moneyRequired ? [{ required: true }, { type: "number", min: 0.01 }] : []}><InputNumber min={0.01} precision={2} /></Form.Item>
        <Form.Item name="currency" label={t("币种")} rules={moneyRequired ? [{ required: true }, { pattern: /^[A-Za-z]{3}$/, message: t("请填写三位币种代码") }] : []}><Input placeholder="CNY" maxLength={3} style={{ width: 110 }} /></Form.Item>
        <Form.Item name="taxInclusive" label={t("税口径")} rules={moneyRequired ? [{ required: true }] : []}><Select style={{ width: 120 }} options={[{ value: true, label: t("含税") }, { value: false, label: t("未税") }]} /></Form.Item>
        <Form.Item name="priceVersion" label={t("采用的已发布价格方案")} rules={values.source === SubscriptionSource.Sale ? [{ required: true, message: t("收费办理须核对价格版本") }] : []}>
          <Select allowClear style={{ minWidth: 220 }} placeholder={t("未选择价格版本")} options={selectedPrice?.priceVersion ? [{ value: selectedPrice.priceVersion, label: `${t(PLAN_LABEL[targetPlan])} · ${selectedPrice.priceVersion}` }] : []} />
        </Form.Item>
      </Space>}
      <Form.Item name="reason" label={t(isExtend ? "临时延长原因（租户可见，不记录收款）" : "办理依据 / 调整原因（租户可见）")} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={500} rows={2} /></Form.Item>
      {!isExtend && <Form.Item name="note" label={t("转账核实 / 平台内部备注（不向租户展示）")}><Input.TextArea maxLength={2000} rows={2} /></Form.Item>}
      <Space wrap>
        <Button type="primary" htmlType="submit" loading={mutation.isPending} disabled={stale || reloading || (!isExtend && values.source === SubscriptionSource.Sale && targetPlan === SubscriptionPlan.Pro)}>{t("保存办理")}</Button>
        <Button loading={reloading} disabled={mutation.isPending} onClick={() => void reload()}>{t("重新载入最新授权（清空表单）")}</Button>
        <Typography.Text type="secondary">{t("编辑基于授权修订")} {snapshot.revision}</Typography.Text>
      </Space>
    </Form>
  </>;
}
