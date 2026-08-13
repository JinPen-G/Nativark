import { ApartmentOutlined, CalendarOutlined, NotificationOutlined, SafetyCertificateOutlined, SaveOutlined, TeamOutlined } from "@ant-design/icons";
import type { RentalAttributeDefinition, RentalCategoryDefinition, SaveTenantRentalBusinessSettingsRequest, TenantRentalBusinessSettings } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Form, InputNumber, Row, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

const pricingUnitLabels: Record<string, string> = {
  hour: "小时", shift: "班次", day_24h: "24 小时", calendar_day: "自然日", night: "夜",
  week: "周", month: "月", usage: "使用量", package: "套餐"
};
const fulfillmentModeLabels: Record<string, string> = {
  store_pickup_return: "门店取还", partner_pickup_return: "合作商取还", warehouse_pickup_return: "仓库取还",
  locker_pickup_return: "自提柜取还", delivery: "配送", onsite_delivery: "现场交付"
};
const locationTypeLabels: Record<string, string> = {
  operator: "经营主体", partner: "合作商", store: "门店", warehouse: "仓库", station: "取还点",
  locker: "自提柜", delivery_hub: "配送中心", project_site: "项目现场"
};
const scopeLabels: Record<string, string> = { item_group: "商品型号", asset: "资产实例", transaction: "履约记录" };

type SettingsTab = "category" | "rules" | "calendar" | "membership" | "notifications";

export function RentalSettingsPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SettingsTab>("category");
  const [form] = Form.useForm<TenantRentalBusinessSettings>();
  const categories = useQuery({ queryKey: ["rental-core", "categories"], queryFn: rentalCoreApi.categories });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const settings = useQuery({ queryKey: ["rental-core", "business-settings"], queryFn: rentalCoreApi.businessSettings });
  const category = useMemo<RentalCategoryDefinition | undefined>(() => categories.data?.find((item) => item.code === profile.data?.categoryCode), [categories.data, profile.data?.categoryCode]);
  const save = useMutation({
    mutationFn: (values: TenantRentalBusinessSettings) => {
      const { tenantId: _tenantId, categoryCode: _categoryCode, configVersion: _configVersion, updatedAt: _updatedAt, updatedBy: _updatedBy, ...request } = values;
      return rentalCoreApi.saveBusinessSettings(request as SaveTenantRentalBusinessSettingsRequest);
    },
    onSuccess: async (result) => {
      form.setFieldsValue(result);
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "business-settings"] });
      message.success("经营设置已保存并生成新配置时间戳");
    },
    onError: () => message.error("保存失败，请检查计价、履约与预授权是否在当前品类允许范围内")
  });

  useEffect(() => {
    if (settings.data) form.setFieldsValue(settings.data);
  }, [form, settings.data]);

  const loading = categories.isLoading || profile.isLoading || settings.isLoading;
  const error = categories.error || profile.error || settings.error;

  return (
    <>
      <PageHeader
        title="品类与业务规则"
        description="按租户经营品类约束计价、履约、支付、日历、会员激励和通知能力。"
        extra={<Button type="primary" icon={<SaveOutlined />} loading={save.isPending} disabled={!settings.data} onClick={() => form.submit()}>保存设置</Button>}
      />
      <Tabs
        className="standalone-tabs"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as SettingsTab)}
        items={[
          { key: "category", label: <span><ApartmentOutlined />品类模型</span> },
          { key: "rules", label: <span><SafetyCertificateOutlined />计价与租赁规则</span> },
          { key: "calendar", label: <span><CalendarOutlined />营业日历</span> },
          { key: "membership", label: <span><TeamOutlined />会员激励</span> },
          { key: "notifications", label: <span><NotificationOutlined />通知事件</span> }
        ]}
      />
      <QueryState loading={loading} error={error}>
        {category && settings.data && (
          <Form<TenantRentalBusinessSettings> form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
            {activeTab === "category" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert showIcon type="info" message={`${category.name} · 模板 ${category.version}`} description="品类决定允许范围，租户只能在范围内选择；产生商品或订单后不能直接切换品类。" />
                <Row gutter={[16, 16]}>
                  <Col xs={24} lg={8}><Card title="库存与能力"><Space wrap>{category.supportedInventoryModes.map((item) => <Tag color="blue" key={item}>{item}</Tag>)}</Space><Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>已启用 capability</Typography.Paragraph><Space wrap>{profile.data?.capabilities.map((item) => <Tag key={item}>{item}</Tag>)}</Space></Card></Col>
                  <Col xs={24} lg={8}><Card title="计价方式"><Space wrap>{category.businessModel.pricingUnits.map((item) => <Tag color={item === category.businessModel.defaultPricingUnit ? "green" : "default"} key={item}>{pricingUnitLabels[item] ?? item}</Tag>)}</Space><Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>绿色为默认计价单位；使用量定价、节假日定价由品类能力和租户开关共同决定。</Typography.Paragraph></Card></Col>
                  <Col xs={24} lg={8}><Card title="履约地点"><Space wrap>{category.businessModel.locationTypes.map((item) => <Tag color="cyan" key={item}>{locationTypeLabels[item] ?? item}</Tag>)}</Space><Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>合作商、车行和自营主体共用履约组织模型，门店、仓库和项目现场属于地点类型。</Typography.Paragraph></Card></Col>
                </Row>
                <Card title="品类字段 schema" styles={{ body: { paddingBottom: 0 } }}>
                  <Table<RentalAttributeDefinition>
                    size="small"
                    rowKey={(row) => `${row.scope}-${row.code}`}
                    pagination={false}
                    dataSource={category.businessModel.assetFields}
                    columns={[
                      { title: "字段", render: (_, row) => <><b>{row.label}</b><br /><span className="muted">{row.code}</span></> },
                      { title: "数据归属", dataIndex: "scope", render: (value) => <Tag>{scopeLabels[value] ?? value}</Tag> },
                      { title: "类型", dataIndex: "type" },
                      { title: "必填", dataIndex: "required", render: (value) => value ? "是" : "否" },
                      { title: "单位/选项", render: (_, row) => row.unit ?? row.options?.join("、") ?? "-" }
                    ]}
                  />
                  <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>型号字段在商品目录维护，资产字段在具体资产维护，履约字段随订单领取/归还检查记录。当前页面已建立 schema，旧车辆兼容页面将在 P1 切换到该 schema。</Typography.Paragraph>
                </Card>
              </Space>
            )}

            {activeTab === "rules" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={12}><Card title="计价范围"><Form.Item name={["pricing", "enabledUnits"]} label="启用计价单位" rules={[{ required: true }]}><Select mode="multiple" options={category.businessModel.pricingUnits.map((value) => ({ value, label: pricingUnitLabels[value] ?? value }))} /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name={["pricing", "defaultUnit"]} label="默认计价单位" rules={[{ required: true }]}><Select options={category.businessModel.pricingUnits.map((value) => ({ value, label: pricingUnitLabels[value] ?? value }))} /></Form.Item></Col><Col span={12}><Form.Item name={["pricing", "taxIncluded"]} label="价格含税" valuePropName="checked"><Switch /></Form.Item></Col></Row><Form.Item name={["pricing", "holidayPricingEnabled"]} label="启用工作日/节假日差异定价" valuePropName="checked"><Switch disabled={!category.businessModel.supportsHolidayPricing} /></Form.Item></Card></Col>
                  <Col xs={24} xl={12}><Card title="履约方式"><Form.Item name={["fulfillment", "enabledModes"]} label="启用履约方式" rules={[{ required: true }]}><Select mode="multiple" options={category.businessModel.fulfillmentModes.map((value) => ({ value, label: fulfillmentModeLabels[value] ?? value }))} /></Form.Item><Form.Item name={["fulfillment", "allowDifferentReturnLocation"]} label="允许异地归还" valuePropName="checked"><Switch /></Form.Item><Typography.Paragraph type="secondary">地点类型由品类模板限定；实际门店、合作商和仓库在“履约地点”中维护。</Typography.Paragraph></Card></Col>
                  <Col xs={24} xl={12}><Card title="支付与押金"><Row gutter={12}><Col span={12}><Form.Item name={["payment", "timing"]} label="支付时点" rules={[{ required: true }]}><Select options={[{ value: "order", label: "下单时" }, { value: "confirmation", label: "确认时" }, { value: "pickup", label: "领取时" }, { value: "offline_terms", label: "线下账期" }]} /></Form.Item></Col><Col span={12}><Form.Item name={["payment", "depositMode"]} label="押金方式" rules={[{ required: true }]}><Select options={[{ value: "none", label: "无押金" }, { value: "fixed", label: "固定押金" }, { value: "price_multiple", label: "价格倍数" }, ...(category.businessModel.supportsPreauthorization ? [{ value: "preauthorization", label: "预授权" }] : [])]} /></Form.Item></Col></Row><Form.Item name={["payment", "preauthorizationRequired"]} label="必须完成预授权" valuePropName="checked"><Switch disabled={!category.businessModel.supportsPreauthorization} /></Form.Item></Card></Col>
                  <Col xs={24} xl={12}><Card title="逾期规则"><Row gutter={12}><Col span={8}><Form.Item name={["overdue", "graceMinutes"]} label="宽限分钟" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col><Col span={8}><Form.Item name={["overdue", "feeMode"]} label="费用方式" rules={[{ required: true }]}><Select options={[{ value: "none", label: "不自动收费" }, { value: "hourly", label: "按小时" }, { value: "next_period", label: "下一周期" }, { value: "multiplier", label: "价格倍数" }, { value: "manual_review", label: "人工核定" }]} /></Form.Item></Col><Col span={8}><Form.Item name={["overdue", "feeMultiplier"]} label="费用系数" rules={[{ required: true }]}><InputNumber min={0} step={0.1} style={{ width: "100%" }} /></Form.Item></Col></Row></Card></Col>
                </Row>
                <Card title="定价与营销管理"><Space wrap><Button type="primary" onClick={() => navigate("/rental/pricing")}>基础定价</Button><Button onClick={() => navigate("/rental/discounts")}>优惠方案</Button><Button onClick={() => navigate("/rental/coupons")}>优惠券模板</Button><Button onClick={() => navigate("/rental/services")}>增值服务</Button></Space><Alert type="warning" showIcon style={{ marginTop: 16 }} message="优惠券模板已建，核销交易尚未完成" description="现可维护模板、额度、适用商品和有效期；领取、锁定、核销、订单取消退回和防重复仍需下一阶段状态机。" /></Card>
              </Space>
            )}

            {activeTab === "calendar" && (
              <Card title="营业日历"><Alert type="info" showIcon message="中国大陆法定节假日需采用官方年度数据并人工发布" description="周末不能等同于法定假日，调休日期每年变化。本阶段保存租户选择和周规则；自动同步将在接入国务院办公厅年度通知源后实现。" style={{ marginBottom: 20 }} /><Row gutter={16}><Col xs={24} md={12}><Form.Item name={["calendar", "weekendDays"]} label="默认周末"><Select mode="multiple" options={[{ value: 0, label: "周日" }, { value: 1, label: "周一" }, { value: 2, label: "周二" }, { value: 3, label: "周三" }, { value: 4, label: "周四" }, { value: 5, label: "周五" }, { value: 6, label: "周六" }]} /></Form.Item></Col><Col xs={24} md={12}><Form.Item name={["calendar", "officialCalendarRegion"]} label="官方日历区域"><Select options={[{ value: "CN", label: "中国大陆" }, { value: "NONE", label: "不使用官方日历" }]} /></Form.Item></Col></Row><Form.Item name={["calendar", "holidayPricingEnabled"]} label="日历参与报价" valuePropName="checked"><Switch disabled={!category.businessModel.supportsHolidayPricing} /></Form.Item></Card>
            )}

            {activeTab === "membership" && (
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}><Card title="注册赠礼"><Form.Item name={["membership", "signupRewardEnabled"]} label="启用" valuePropName="checked"><Switch /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name={["membership", "signupRewardType"]} label="奖励类型"><Select options={[{ value: "points", label: "积分" }, { value: "balance", label: "余额" }, { value: "coupon", label: "优惠券" }]} /></Form.Item></Col><Col span={12}><Form.Item name={["membership", "signupRewardAmount"]} label="奖励数量"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col></Row></Card></Col>
                <Col xs={24} xl={12}><Card title="邀请奖励"><Form.Item name={["membership", "referralRewardEnabled"]} label="启用" valuePropName="checked"><Switch /></Form.Item><Row gutter={12}><Col span={8}><Form.Item name={["membership", "referralRewardType"]} label="奖励类型"><Select options={[{ value: "points", label: "积分" }, { value: "balance", label: "余额" }, { value: "coupon", label: "优惠券" }]} /></Form.Item></Col><Col span={8}><Form.Item name={["membership", "referrerRewardAmount"]} label="邀请人数量"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col><Col span={8}><Form.Item name={["membership", "inviteeRewardAmount"]} label="被邀请人数量"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col></Row><Form.Item name={["membership", "referralTrigger"]} label="发奖触发点"><Select options={[{ value: "registration", label: "完成注册" }, { value: "identity_verified", label: "通过实名" }, { value: "first_order_completed", label: "首单完成" }]} /></Form.Item></Card></Col>
                <Col span={24}><Alert type="warning" showIcon message="当前只保存激励规则" description="正式发奖还需奖励流水、幂等业务键、防刷策略和撤销流程；不能直接修改会员余额代替奖励交易。" /></Col>
              </Row>
            )}

            {activeTab === "notifications" && (
              <Card title="通知事件与渠道"><Form.Item name={["notifications", "enabledEvents"]} label="启用事件"><Select mode="tags" tokenSeparators={[",", "，"]} options={["member.registered", "member.referral.completed", "order.created", "order.confirmed", "order.cancelled", "payment.pending", "pickup.reminder", "return.reminder", "order.overdue", "refund.completed"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name={["notifications", "editableChannels"]} label="租户可用渠道"><Select mode="multiple" options={[{ value: "sms", label: "短信" }, { value: "app_push", label: "App 推送" }, { value: "wechat", label: "微信" }, { value: "email", label: "邮件" }]} /></Form.Item><Alert type="info" showIcon message="模板编辑与发送基础设施分离" description="本页控制租户可用事件和渠道；模板正文、变量 schema、版本、发送日志、重试和供应商回执继续由通知模板域管理。" /></Card>
            )}
          </Form>
        )}
      </QueryState>
    </>
  );
}
