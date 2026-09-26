import { Alert, Button, Card, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Select, Space } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useLocale } from "@/app/locale";
import { APP_ROUTES } from "@/app/navigation";

/**
 * SUB-03 平台管理端「租户订阅 · 详情/办理」（需求 §8），路由 /platform/subscriptions/:id。
 *
 * 静态骨架：当前套餐/期限 + 直接办理表单 + 额外功能授权 + 申请/线下收款记录 + 历史/待生效。
 * 表单只搭字段与布局，推算截止日期、开始≤截止校验、保存开通接总控 SUB-03 写契约（TODO）。
 * 金额/币种/标准价一律占位，不虚构（§14.2）。SaaS 管理端页，路由已用 system:subscription:manage 门禁。
 */
export function PlatformSubscriptionDetailPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { id = "" } = useParams();
  const PLACEHOLDER = "待接入";

  return (
    <PageHeader
      title="租户订阅详情"
      description="查看并直接办理该租户的订阅：开通 / 升级 / 续期 / 临时延长 / 下期降级，以及公共下放与单租户额外授权。"
      extra={<Button onClick={() => navigate(APP_ROUTES.platformSubscriptions.path)}>{t("返回列表")}</Button>}
      view={
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Card size="small" title={`${t("当前套餐与期限")}（${t("租户")} ${id || PLACEHOLDER}）`}>
            <Descriptions column={{ xs: 1, md: 2 }} size="small" colon={false}
              items={[
                { key: "edition", label: t("当前套餐"), children: t(PLACEHOLDER) },
                { key: "status", label: t("服务状态"), children: t(PLACEHOLDER) },
                { key: "period", label: t("统一起止（含时区）"), children: t("待平台确认") },
                { key: "next", label: t("待生效套餐"), children: t(PLACEHOLDER) }
              ]}
            />
          </Card>

          <Card size="small" title={t("直接办理")}>
            <Alert type="info" showIcon style={{ marginBottom: 16 }}
              message={t("线下收款以平台收款账户与商业记录为依据；上传凭证不等于核实到账。正常售卖 PRO 须满足四品类首批销售条件。保存前核对租户、目标套餐与起止时间。")} />
            {/* TODO(SUB-03)：接管理员办理写契约（办理类型 × 版本 × 期限 × 来源 × 金额备注 × 原因）；
                选择服务年数后按周年规则推算并展示截止日期，校验开始≤截止，保存重试不重复延长。 */}
            <Form layout="vertical" disabled>
              <Space wrap align="start" size={16}>
                <Form.Item label={t("办理类型")} style={{ minWidth: 200 }}>
                  <Select placeholder={t("请选择")} options={[
                    { value: "activate", label: t("直接开通") },
                    { value: "upgrade", label: t("升级 PRO") },
                    { value: "renew", label: t("续期") },
                    { value: "extend", label: t("临时延长") },
                    { value: "next_basic", label: t("下期降级为基础版") },
                    { value: "no_renew", label: t("到期不续费登记") }
                  ]} />
                </Form.Item>
                <Form.Item label={t("版本")} style={{ minWidth: 160 }}>
                  <Select placeholder={t("请选择")} options={[{ value: "basic", label: t("基础版") }, { value: "pro", label: "PRO" }]} />
                </Form.Item>
                <Form.Item label={t("办理来源")} style={{ minWidth: 180 }}>
                  <Select placeholder={t("请选择")} options={[
                    { value: "sale", label: t("正常售卖") },
                    { value: "pilot", label: t("受控试点") },
                    { value: "legacy", label: t("历史登记") },
                    { value: "extend", label: t("临时延长") }
                  ]} />
                </Form.Item>
              </Space>
              <Space wrap align="start" size={16}>
                <Form.Item label={t("开始日期（含时区）")} style={{ minWidth: 200 }}><DatePicker style={{ width: "100%" }} showTime /></Form.Item>
                <Form.Item label={t("服务年数")} style={{ minWidth: 140 }} tooltip={t("选择年数后按周年规则推算截止日期，可核对后修改")}><InputNumber min={1} max={10} style={{ width: "100%" }} /></Form.Item>
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
            <Alert type="info" showIcon style={{ marginBottom: 12 }}
              message={t("可在功能目录「公共下放基础版」，或在此仅为该租户额外授权；保存前显示影响范围，不要求整体升级。")} />
            <Empty description={t("功能目录接入后在此选择授权")} />
          </Card>

          <Card size="small" title={t("申请与线下收款记录")}><Empty description={t("暂无记录")} /></Card>
          <Card size="small" title={t("历史与待生效套餐")}><Empty description={t("暂无记录")} /></Card>
        </Space>
      }
    />
  );
}
