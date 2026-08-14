import { ArrowLeftOutlined, CheckCircleOutlined, PlusOutlined } from "@ant-design/icons";
import type { CreateRentalOrderRequest, RentalQuoteRequest, RentalQuoteSnapshotV1 } from "@store-rental/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Result, Row, Select, Space, Steps, Table, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";

type FormValues = Omit<RentalQuoteRequest, "startAt" | "endAt"> & { customerName: string; contactPhone?: string; qualificationApproved?: boolean; qualificationValidTo?: string; period: [Dayjs, Dayjs] };
const money = (value: number) => `¥${Number(value).toFixed(2)}`;
const unitLabels: Record<string, string> = { hour: "小时", shift: "班次", day_24h: "24 小时", calendar_day: "自然日", night: "夜", week: "周", month: "月", usage: "使用量", package: "套餐" };

export function RentalOrderCreatePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const [step, setStep] = useState(0);
  const [quote, setQuote] = useState<RentalQuoteSnapshotV1>();
  const [created, setCreated] = useState<{ id: string; orderNo: string }>();
  const customerId = Form.useWatch("customerId", form);
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const settings = useQuery({ queryKey: ["rental-core", "business-settings"], queryFn: rentalCoreApi.businessSettings });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const locations = useQuery({ queryKey: ["rental-core", "locations"], queryFn: rentalCoreApi.locations });
  const pricing = useQuery({ queryKey: ["rental-core", "pricing-plans"], queryFn: rentalCoreApi.pricingPlans });
  const discounts = useQuery({ queryKey: ["rental-core", "discount-plans"], queryFn: rentalCoreApi.discountPlans });
  const services = useQuery({ queryKey: ["rental-core", "value-added-services"], queryFn: rentalCoreApi.valueAddedServices });
  const coupons = useQuery({ queryKey: ["rental-core", "customer-coupons", customerId], queryFn: () => rentalCoreApi.customerCoupons(customerId), enabled: Boolean(customerId) });
  const createQuote = useMutation({ mutationFn: rentalCoreApi.createQuote, onSuccess: (result) => { setQuote(result); setStep(2); }, onError: () => message.error("报价失败，请检查价格计划、库存时间、优惠叠加与业务规则") });
  const createOrder = useMutation({ mutationFn: rentalCoreApi.createOrder, onSuccess: (result) => { setCreated(result); setStep(3); }, onError: () => message.error("创建失败，报价可能过期或库存已变化") });
  useEffect(() => {
    if (locations.data?.length && groups.data?.length && pricing.data?.length && !form.getFieldValue("fulfillmentLocationId")) initialValues();
  }, [locations.data, groups.data, pricing.data, settings.data]);

  function initialValues() {
    form.setFieldsValue({ customerType: "personal", fulfillmentMode: settings.data?.fulfillment.enabledModes[0] ?? "store_pickup_return", fulfillmentLocationId: locations.data?.[0]?.id, period: [dayjs().add(1, "day").hour(9), dayjs().add(2, "day").hour(18)], pricingPlanId: pricing.data?.find((item) => item.status === "enabled")?.id, lines: [{ itemGroupId: groups.data?.[0]?.id ?? "", quantity: 1 }], services: [] });
  }

  async function quoteOrder() {
    const values = await form.validateFields();
    createQuote.mutate({ customerType: values.customerType, customerId: values.customerId, fulfillmentMode: values.fulfillmentMode, fulfillmentLocationId: values.fulfillmentLocationId, returnLocationId: values.returnLocationId, startAt: values.period[0].toISOString(), endAt: values.period[1].toISOString(), pricingPlanId: values.pricingPlanId, discountPlanId: values.discountPlanId, customerCouponId: values.customerCouponId, lines: values.lines.map((line) => ({ ...line, quantity: Number(line.quantity), usageQuantity: line.usageQuantity === undefined ? undefined : Number(line.usageQuantity) })), services: values.services?.map((item) => ({ ...item, quantity: Number(item.quantity) })) });
  }

  async function submitOrder() {
    if (!quote) return;
    const values = form.getFieldsValue(true);
    const input: CreateRentalOrderRequest = { quoteId: quote.id, customerType: values.customerType, customerId: values.customerId, customerName: values.customerName, contactPhone: values.contactPhone, qualificationApproved: values.qualificationApproved, qualificationValidTo: values.qualificationValidTo, fulfillmentMode: quote.request.fulfillmentMode, fulfillmentLocationId: quote.request.fulfillmentLocationId, returnLocationId: quote.request.returnLocationId, startAt: quote.request.startAt, endAt: quote.request.endAt, lines: quote.request.lines.map(({ itemGroupId, quantity, note }) => ({ itemGroupId, quantity, note })) };
    createOrder.mutate(input);
  }

  return (
    <>
      <PageHeader title="新建租赁订单" description={`按${profile.data?.terminology.itemGroupLabel ?? "商品"}、租期和服务生成服务端报价，再创建库存预占。`} extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/rental/orders")}>返回订单</Button>} />
      <Steps current={step} items={[{ title: "客户与时间" }, { title: "商品与优惠" }, { title: "服务端报价" }, { title: "完成" }]} style={{ marginBottom: 20 }} />
      <Card className="data-panel">
        {step < 3 && <Form<FormValues> form={form} layout="vertical" onFinish={quoteOrder} onReset={initialValues}>
          <section hidden={step !== 0}><Row gutter={16}><Col xs={24} md={8}><Form.Item name="customerType" label="客户类型" rules={[{ required: true }]}><Select options={[{ value: "personal", label: "个人客户" }, { value: "corporate", label: "企业客户" }]} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="customerId" label="客户编号" rules={[{ required: true }]}><Input placeholder="会员或企业客户 ID" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="customerName" label="客户名称" rules={[{ required: true }]}><Input /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="contactPhone" label="联系电话"><Input /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="fulfillmentMode" label="租赁履约方式" rules={[{ required: true }]}><Select options={(settings.data?.fulfillment.enabledModes ?? []).map((value) => ({ value, label: value }))} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="fulfillmentLocationId" label={profile.data?.terminology.fulfillmentLabel ?? "领取地点"} rules={[{ required: true }]}><Select options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="returnLocationId" label="归还地点"><Select allowClear options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="qualificationApproved" label="资质审核"><Select options={[{ value: true, label: "已通过" }, { value: false, label: "未通过/不适用" }]} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="qualificationValidTo" label="资质有效期"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col><Col span={24}><Form.Item name="period" label="租赁时间" rules={[{ required: true }]}><DatePicker.RangePicker showTime style={{ width: "100%" }} /></Form.Item></Col></Row><div className="form-actions"><Button type="primary" onClick={() => form.validateFields(["customerType", "customerId", "customerName", "fulfillmentMode", "fulfillmentLocationId", "period"]).then(() => setStep(1))}>下一步</Button></div></section>
          <section hidden={step !== 1}><Row gutter={16}><Col xs={24} lg={12}><Form.Item name="pricingPlanId" label="基础定价计划" rules={[{ required: true }]}><Select options={(pricing.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.name} · v${item.version}` }))} /></Form.Item></Col><Col xs={24} lg={12}><Form.Item name="discountPlanId" label="指定优惠方案（可留空自动匹配）"><Select allowClear options={(discounts.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col><Col span={24}><Form.List name="lines">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: "100%" }}>{fields.map((field) => <Card size="small" key={field.key} extra={fields.length > 1 && <Button danger type="link" onClick={() => remove(field.name)}>删除</Button>}><Row gutter={12}><Col span={12}><Form.Item name={[field.name, "itemGroupId"]} label="商品" rules={[{ required: true }]}><Select options={(groups.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item></Col><Col span={5}><Form.Item name={[field.name, "quantity"]} label="数量" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col><Col span={5}><Form.Item name={[field.name, "pricingUnit"]} label="计价单位"><Select allowClear options={[...new Set((pricing.data ?? []).flatMap((plan) => plan.rates.map((rate) => rate.unit)))].map((value) => ({ value, label: unitLabels[value] ?? value }))} /></Form.Item></Col><Col span={2}><Form.Item name={[field.name, "usageQuantity"]} label="用量"><InputNumber min={0} precision={0} /></Form.Item></Col></Row></Card>)}<Button block type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>增加商品</Button></Space>}</Form.List></Col><Col span={24}><Form.List name="services">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: "100%" }}>{fields.map((field) => <Row gutter={12} key={field.key}><Col span={16}><Form.Item name={[field.name, "serviceId"]} label="增值服务"><Select options={(services.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.name} · ${money(item.price)}` }))} /></Form.Item></Col><Col span={6}><Form.Item name={[field.name, "quantity"]} label="数量"><InputNumber min={1} precision={0} /></Form.Item></Col><Col span={2}><Button danger type="text" onClick={() => remove(field.name)}>删</Button></Col></Row>)}<Button type="dashed" onClick={() => add({ quantity: 1 })}>增加增值服务</Button></Space>}</Form.List></Col><Col span={24}><Form.Item name="customerCouponId" label="客户优惠券"><Select allowClear disabled={!customerId} options={(coupons.data ?? []).filter((item) => item.status === "claimed").map((item) => ({ value: item.id, label: `${item.templateName} · ${item.effectiveTo.slice(0, 10)} 到期` }))} /></Form.Item></Col></Row><Alert type="info" showIcon message="最终价格由服务端计算" description="基础价格、营业日历、自动优惠、优惠券、服务、押金和规则版本都会写入报价快照。" /><div className="form-actions"><Space><Button onClick={() => setStep(0)}>上一步</Button><Button type="primary" loading={createQuote.isPending} onClick={quoteOrder}>生成报价</Button></Space></div></section>
        </Form>}
        {step === 2 && quote && <Row gutter={[20, 20]}><Col xs={24} xl={15}><Table rowKey="code" pagination={false} dataSource={quote.chargeLines} columns={[{ title: "费用项", dataIndex: "name" }, { title: "类型", dataIndex: "type" }, { title: "版本来源", render: (_, row) => row.sourceVersion ?? "-" }, { title: "计算说明", dataIndex: "detail", render: (value) => value ?? "-" }, { title: "金额", dataIndex: "amount", align: "right", render: money }]} /></Col><Col xs={24} xl={9}><Card size="small" title="报价快照"><Descriptions column={1} items={[{ key: "no", label: "报价号", children: quote.quoteNo }, { key: "pricing", label: "价格版本", children: quote.pricingPlanVersion }, { key: "rule", label: "规则版本", children: quote.ruleVersion }, { key: "calendar", label: "日历版本", children: quote.calendarVersion ?? "未发布" }, { key: "rental", label: "租金", children: money(quote.rentalAmount) }, { key: "discount", label: "总优惠", children: `-${money(quote.discountAmount + quote.couponAmount)}` }, { key: "service", label: "增值服务", children: money(quote.serviceAmount) }, { key: "deposit", label: "押金/预授权", children: money(quote.depositAmount) }, { key: "payable", label: "应付", children: <Typography.Text strong style={{ fontSize: 20 }}>{money(quote.payableAmount)}</Typography.Text> }]} /></Card><div className="form-actions"><Space><Button onClick={() => setStep(1)}>返回修改</Button><Button type="primary" loading={createOrder.isPending} onClick={submitOrder}>创建订单</Button></Space></div></Col></Row>}
        {step === 3 && created && <Result status="success" icon={<CheckCircleOutlined />} title="租赁订单已创建" subTitle={`${created.orderNo} 已建立库存软预占，优惠券已锁定。`} extra={[<Button key="detail" type="primary" onClick={() => navigate(`/rental/orders/${created.id}`)}>查看订单</Button>, <Button key="new" onClick={() => { setStep(0); setQuote(undefined); setCreated(undefined); form.resetFields(); initialValues(); }}>继续新建</Button>]} />}
      </Card>
    </>
  );
}
