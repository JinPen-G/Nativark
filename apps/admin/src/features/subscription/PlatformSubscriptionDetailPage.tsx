import { Alert, Button, Card, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Select, Space, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { SubscriptionPlan, type TenantSubscriptionView } from "@rental-os/shared";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";
import { subscriptionApi } from "@/api/subscription";
import { PLAN_LABEL, SERVICE_STATUS_LABEL, formatMoney } from "./subscriptionLabels";

/**
 * SUB-03 平台端「租户订阅 · 详情/办理」（§8）。概览走只读视图；直接办理表单字段就位、
 * 提交待 SUB-03 写契约（当前 Form disabled）。金额一律占位不虚构（§14.2）。
 */
export function PlatformSubscriptionDetailPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["subscription", "platform-detail", id], queryFn: () => subscriptionApi.platformDetail(id), enabled: Boolean(id) });

  const back = <Button onClick={() => navigate(APP_ROUTES.platformSubscriptions.path)}>{t("返回列表")}</Button>;
  if (query.isLoading) return <div style={{ textAlign: "center", padding: 80 }}><LoadingState /></div>;
  if (query.error || !query.data) {
    return <PageHeader title="租户订阅详情" description="查看并直接办理该租户的订阅。" extra={back}
      view={<Alert type="error" showIcon message={t("租户订阅详情加载失败")} description={<Button size="small" onClick={() => query.refetch()}>{t("重试")}</Button>} />} />;
  }
  return <PageHeader title="租户订阅详情" description="查看并直接办理该租户的订阅：开通 / 升级 / 续期 / 临时延长 / 下期降级，以及公共下放与单租户额外授权。" extra={back}
    view={<DetailBody data={query.data} />} />;
}

function DetailBody({ data }: { data: TenantSubscriptionView }) {
  const { t } = useLocale();
  const { overview, entitlements, requests } = data;
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small" title={`${t("当前套餐与期限")}（${overview.tenantName}）`}>
        <Descriptions column={{ xs: 1, md: 2 }} size="small" colon={false} items={[
          { key: "plan", label: t("当前套餐"), children: <Tag color={overview.plan === SubscriptionPlan.Pro ? "gold" : "default"}>{t(PLAN_LABEL[overview.plan])}</Tag> },
          { key: "status", label: t("服务状态"), children: t(SERVICE_STATUS_LABEL[overview.serviceStatus]) },
          { key: "period", label: t("统一起止"), children: overview.endAt ? `${overview.startAt ?? ""} ~ ${overview.endAt}${overview.timeZone ? `（${overview.timeZone}）` : ""}` : t("待平台确认") },
          { key: "amount", label: t("本期确认金额"), children: t(formatMoney(overview.currentAmount)) },
          { key: "next", label: t("待生效套餐"), children: overview.next ? `${t(PLAN_LABEL[overview.next.plan])}${overview.next.effectiveAt ? `（${overview.next.effectiveAt}）` : ""}` : t("无") }
        ]} />
      </Card>

      <Card size="small" title={t("直接办理")}>
        <Alert type="info" showIcon style={{ marginBottom: 16 }}
          message={t("线下收款以平台收款账户与商业记录为依据；上传凭证不等于核实到账。正常售卖 PRO 须满足四品类首批销售条件。保存前核对租户、目标套餐与起止时间。")} />
        {/* TODO(SUB-03)：接管理员办理写契约；选年数后按周年规则推算截止并展示，校验开始≤截止，保存重试不重复延长。 */}
        <Form layout="vertical" disabled>
          <Space wrap align="start" size={16}>
            <Form.Item label={t("办理类型")} style={{ minWidth: 200 }}>
              <Select placeholder={t("请选择")} options={[
                { value: "activate", label: t("直接开通") }, { value: "upgrade", label: t("升级 PRO") }, { value: "renew", label: t("续期") },
                { value: "extend", label: t("临时延长") }, { value: "next_standard", label: t("下期降级为基础版") }, { value: "no_renew", label: t("到期不续费登记") }
              ]} />
            </Form.Item>
            <Form.Item label={t("版本")} style={{ minWidth: 160 }}><Select placeholder={t("请选择")} options={[{ value: "standard", label: t("基础版") }, { value: "pro", label: "PRO" }]} /></Form.Item>
            <Form.Item label={t("办理来源")} style={{ minWidth: 180 }}>
              <Select placeholder={t("请选择")} options={[
                { value: "sale", label: t("正常售卖") }, { value: "pilot", label: t("受控试点") }, { value: "historical_register", label: t("历史登记") }, { value: "temp_extension", label: t("临时延长") }
              ]} />
            </Form.Item>
          </Space>
          <Space wrap align="start" size={16}>
            <Form.Item label={t("开始日期（含时区）")} style={{ minWidth: 200 }}><DatePicker style={{ width: "100%" }} showTime /></Form.Item>
            <Form.Item label={t("服务年数")} style={{ minWidth: 140 }} tooltip={t("选年数后按周年规则推算截止，可核对后修改")}><InputNumber min={1} max={10} style={{ width: "100%" }} /></Form.Item>
            <Form.Item label={t("或自定义截止日期")} style={{ minWidth: 200 }}><DatePicker style={{ width: "100%" }} showTime /></Form.Item>
          </Space>
          <Space wrap align="start" size={16}>
            <Form.Item label={t("实际收费金额 / 转账备注")} style={{ minWidth: 260 }} tooltip={t("收费办理时填写；标准价待公布")}><Input placeholder={t("金额与转账备注（收费办理时）")} /></Form.Item>
            <Form.Item label={t("调整原因")} style={{ minWidth: 260 }}><Input placeholder={t("试点 / 历史登记 / 临时延长 / 优惠等原因")} /></Form.Item>
          </Space>
          <Form.Item><Button type="primary" htmlType="submit">{t("保存办理")}</Button></Form.Item>
        </Form>
      </Card>

      <Card size="small" title={t("额外功能授权")}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("可在功能目录「公共下放基础版」，或在此仅为该租户额外授权；保存前显示影响范围，不要求整体升级。")} />
        {entitlements.length === 0 ? <Empty description={t("功能目录接入后在此选择授权")} /> : (
          <Descriptions column={1} size="small" colon={false} items={entitlements.map((feature) => ({ key: feature.code, label: feature.name, children: feature.available ? t("已授权") : t("未授权") }))} />
        )}
      </Card>

      <Card size="small" title={t("申请与线下收款记录")}>{requests.length === 0 ? <Empty description={t("暂无记录")} /> : <Descriptions column={1} size="small" colon={false} items={requests.map((row) => ({ key: row.id, label: row.id, children: t(formatMoney(row.handledAmount)) }))} />}</Card>
    </Space>
  );
}
