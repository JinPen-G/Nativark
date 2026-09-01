import { ArrowLeftOutlined, CheckCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { RENTAL_PRICING_UNIT_LABELS, type CreateRentalOrderRequest, type RentalBookingIdentityInput, type RentalQuoteRequest, type RentalQuoteSnapshotV1 } from "@store-rental/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, InputNumber, Result, Row, Select, Space, Steps, Switch, Table, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { membershipApi } from "@/api/membership";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";

type FormValues = Omit<RentalQuoteRequest, "startAt" | "endAt"> & { period: [Dayjs, Dayjs]; bookingIdentity?: RentalBookingIdentityInput };
const money = (value: number) => `¥${Number(value).toFixed(2)}`;
const unitLabels = RENTAL_PRICING_UNIT_LABELS;

export function RentalOrderCreatePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const [step, setStep] = useState(0);
  const [quote, setQuote] = useState<RentalQuoteSnapshotV1>();
  const [created, setCreated] = useState<{ id: string; orderNo: string }>();
  const customerId = Form.useWatch("customerId", form);
  const bookingIdentity = Form.useWatch("bookingIdentity", form);
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const settings = useQuery({ queryKey: ["rental-core", "business-settings"], queryFn: rentalCoreApi.businessSettings });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const locations = useQuery({ queryKey: ["rental-core", "locations"], queryFn: rentalCoreApi.locations });
  const pricing = useQuery({ queryKey: ["rental-core", "pricing-plans"], queryFn: rentalCoreApi.pricingPlans });
  const discounts = useQuery({ queryKey: ["rental-core", "discount-plans"], queryFn: rentalCoreApi.discountPlans });
  const services = useQuery({ queryKey: ["rental-core", "value-added-services"], queryFn: rentalCoreApi.valueAddedServices });
  const members = useQuery({ queryKey: ["membership", "personal"], queryFn: membershipApi.personal });
  const bookingOptions = useQuery({ queryKey: ["membership", "booking-options", customerId], queryFn: () => membershipApi.bookingOptions(customerId ?? ""), enabled: Boolean(customerId) });
  const coupons = useQuery({ queryKey: ["rental-core", "customer-coupons", customerId], queryFn: () => rentalCoreApi.customerCoupons(customerId), enabled: Boolean(customerId) });
  const selectedMember = useMemo(() => members.data?.find((item) => item.customerId === customerId), [members.data, customerId]);
  const enterpriseMode = bookingIdentity?.bookingIdentity === "enterprise_employee";
  const createQuote = useMutation({ mutationFn: rentalCoreApi.createQuote, onSuccess: (result) => { setQuote(result); setStep(2); }, onError: (error: Error) => message.error(error.message || "报价失败，请检查会员资格、价格、库存与规则") });
  const createOrder = useMutation({ mutationFn: rentalCoreApi.createOrder, onSuccess: (result) => { setCreated(result); setStep(3); }, onError: (error: Error) => message.error(error.message || "创建失败，报价可能过期或资格、库存已变化") });

  useEffect(() => {
    if (locations.data?.length && groups.data?.length && pricing.data?.length && !form.getFieldValue("fulfillmentLocationId")) initialValues();
  }, [locations.data, groups.data, pricing.data, settings.data]);

  function initialValues() {
    form.setFieldsValue({ customerType: "personal", bookingIdentity: { bookingIdentity: "personal", enterpriseContractAndPayer: false }, fulfillmentMode: settings.data?.fulfillment.enabledModes[0] ?? "store_pickup_return", fulfillmentLocationId: locations.data?.[0]?.id, period: [dayjs().add(1, "day").hour(9).minute(0), dayjs().add(2, "day").hour(18).minute(0)], pricingPlanId: pricing.data?.find((item) => item.status === "enabled")?.id, lines: [{ itemGroupId: groups.data?.[0]?.id ?? "", quantity: 1 }], services: [] });
  }

  async function quoteOrder() {
    const values = await form.validateFields();
    if (!selectedMember) return message.error("请选择当前经营空间的个人会员");
    createQuote.mutate({ customerType: "personal", customerId: values.customerId, bookingIdentity: values.bookingIdentity, fulfillmentMode: values.fulfillmentMode, fulfillmentLocationId: values.fulfillmentLocationId, returnLocationId: values.returnLocationId, startAt: values.period[0].toISOString(), endAt: values.period[1].toISOString(), pricingPlanId: values.pricingPlanId, discountPlanId: values.discountPlanId, customerCouponId: values.customerCouponId, lines: values.lines.map((line) => ({ ...line, quantity: Number(line.quantity), usageQuantity: line.usageQuantity === undefined ? undefined : Number(line.usageQuantity) })), services: values.services?.map((item) => ({ ...item, quantity: Number(item.quantity) })) });
  }

  function submitOrder() {
    if (!quote || !selectedMember) return;
    const input: CreateRentalOrderRequest = { quoteId: quote.id, customerType: "personal", customerId: selectedMember.customerId, customerName: selectedMember.name, bookingIdentity: quote.request.bookingIdentity, fulfillmentMode: quote.request.fulfillmentMode, fulfillmentLocationId: quote.request.fulfillmentLocationId, returnLocationId: quote.request.returnLocationId, startAt: quote.request.startAt, endAt: quote.request.endAt, lines: quote.request.lines.map(({ itemGroupId, quantity, note }) => ({ itemGroupId, quantity, note })) };
    createOrder.mutate(input);
  }

  return <>
    <PageHeader title="新建租赁订单" description={`从个人会员预约开始，按${profile.data?.terminology.itemGroupLabel ?? "商品"}、服务与优惠生成服务端报价。`} extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/rental/orders")}>返回订单</Button>} />
    <Steps current={step} items={[{ title: "会员与租期" }, { title: "商品与优惠" }, { title: "服务端报价" }, { title: "完成" }]} style={{ marginBottom: 20 }} />
    <Card className="data-panel">
      {step < 3 && <Form<FormValues> form={form} layout="vertical" onValuesChange={() => quote && setQuote(undefined)}>
        <section hidden={step !== 0}><Row gutter={16}>
          <Col xs={24} md={12}><Form.Item name="customerId" label="预约会员" rules={[{ required: true, message: "请选择个人会员" }]} extra="个人始终是实际使用人与品类资质校验来源。"><Select showSearch optionFilterProp="label" loading={members.isLoading} placeholder="选择当前经营空间的个人会员" options={(members.data ?? []).filter((item) => item.membershipStatus === "active").map((item) => ({ value: item.customerId, label: `${item.name} · ${item.phoneMasked} · ${item.levelName}` }))} onChange={() => form.setFieldValue("bookingIdentity", { bookingIdentity: "personal", enterpriseContractAndPayer: false })} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name={["bookingIdentity", "bookingIdentity"]} label="预约身份" rules={[{ required: true }]}><Select disabled={!customerId} options={[{ value: "personal", label: "个人预约（默认）" }, { value: "enterprise_employee", label: "企业员工预约（使用企业权益）", disabled: !(bookingOptions.data?.length) }]} /></Form.Item></Col>
          {enterpriseMode && <><Col xs={24} md={12}><Form.Item name={["bookingIdentity", "corporateCustomerId"]} label="所属企业" rules={[{ required: true, message: "请选择有效员工关系对应的企业" }]}><Select loading={bookingOptions.isLoading} options={(bookingOptions.data ?? []).map((item) => ({ value: item.corporateCustomerId, label: `${item.corporateCustomerName}${item.role === "admin" ? " · 企业管理员" : ""}` }))} /></Form.Item></Col><Col xs={24} md={12}><Form.Item name={["bookingIdentity", "enterpriseContractAndPayer"]} label="企业签约并付款" valuePropName="checked" extra="默认仍由个人签约付款；开启后企业成为签约与付款主体。"><Switch checkedChildren="企业" unCheckedChildren="个人" /></Form.Item></Col></>}
          {selectedMember && <Col span={24}><Alert showIcon type="info" message={`本次使用人：${selectedMember.name}`} description={`会员状态：${selectedMember.membershipStatus}；已登记证件：${selectedMember.qualifications.length} 项。实际可用资格仍由服务端按本次商品和租期复核。`} /></Col>}
          <Col xs={24} md={8}><Form.Item name="fulfillmentMode" label="租赁履约方式" rules={[{ required: true }]}><Select options={(settings.data?.fulfillment.enabledModes ?? []).map((value) => ({ value, label: value }))} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="fulfillmentLocationId" label={profile.data?.terminology.fulfillmentLabel ?? "领取地点"} rules={[{ required: true }]}><Select options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="returnLocationId" label="归还地点"><Select allowClear options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col><Col span={24}><Form.Item name="period" label="租赁时间" rules={[{ required: true }]}><DatePicker.RangePicker showTime style={{ width: "100%" }} /></Form.Item></Col>
        </Row><div className="form-actions"><Button type="primary" onClick={() => form.validateFields(["customerId", "bookingIdentity", "fulfillmentMode", "fulfillmentLocationId", "period"]).then(() => setStep(1))}>下一步</Button></div></section>
        <section hidden={step !== 1}><Row gutter={16}>
          <Col xs={24} lg={12}><Form.Item name="pricingPlanId" label="基础定价计划" rules={[{ required: true }]}><Select options={(pricing.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.name} · v${item.version}` }))} /></Form.Item></Col><Col xs={24} lg={12}><Form.Item name="discountPlanId" label="指定优惠方案（可留空自动匹配）"><Select allowClear options={(discounts.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
          <Col span={24}><Form.List name="lines">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: "100%" }}>{fields.map((field) => <Card size="small" key={field.key} extra={fields.length > 1 && <Button danger type="link" onClick={() => remove(field.name)}>删除</Button>}><Row gutter={12}><Col xs={24} md={12}><Form.Item name={[field.name, "itemGroupId"]} label={profile.data?.terminology.itemLabel ?? "商品"} rules={[{ required: true }]}><Select options={(groups.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item></Col><Col xs={12} md={5}><Form.Item name={[field.name, "quantity"]} label="数量" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col><Col xs={12} md={5}><Form.Item name={[field.name, "pricingUnit"]} label="计价单位"><Select allowClear options={[...new Set((pricing.data ?? []).flatMap((plan) => plan.rates.map((rate) => rate.unit)))].map((value) => ({ value, label: unitLabels[value] ?? value }))} /></Form.Item></Col><Col xs={12} md={2}><Form.Item name={[field.name, "usageQuantity"]} label="用量"><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col></Row></Card>)}<Button block type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>增加{profile.data?.terminology.itemLabel ?? "商品"}</Button></Space>}</Form.List></Col>
          <Col span={24}><Form.List name="services">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: "100%" }}>{fields.map((field) => <Row gutter={12} key={field.key}><Col xs={24} md={16}><Form.Item name={[field.name, "serviceId"]} label="增值服务"><Select options={(services.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.name} · ${money(item.price)}` }))} /></Form.Item></Col><Col xs={18} md={6}><Form.Item name={[field.name, "quantity"]} label="数量"><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col><Col xs={6} md={2}><Button danger type="text" onClick={() => remove(field.name)}>删</Button></Col></Row>)}<Button type="dashed" onClick={() => add({ quantity: 1 })}>增加增值服务</Button></Space>}</Form.List></Col>
          <Col span={24}><Form.Item name="customerCouponId" label="个人优惠券"><Select allowClear disabled={!customerId} options={(coupons.data ?? []).filter((item) => item.status === "claimed").map((item) => ({ value: item.id, label: `${item.templateName} · ${item.effectiveTo.slice(0, 10)} 到期` }))} /></Form.Item></Col>
        </Row><Alert type="info" showIcon message="最终金额由服务端计算" description="价格、日历、服务、营销优惠、会员预约身份与权益版本均随报价固化；任一关键输入变化后必须重新报价。" /><div className="form-actions"><Space><Button onClick={() => setStep(0)}>上一步</Button><Button type="primary" loading={createQuote.isPending} onClick={quoteOrder}>生成报价</Button></Space></div></section>
      </Form>}
      {step === 2 && quote && <Row gutter={[20, 20]}><Col xs={24} xl={15}><Table rowKey="code" pagination={false} dataSource={quote.chargeLines} columns={[{ title: "费用项", dataIndex: "name" }, { title: "类型", dataIndex: "type" }, { title: "版本来源", render: (_, row) => row.sourceVersion ?? "-" }, { title: "计算说明", dataIndex: "detail", render: (value) => value ?? "-" }, { title: "金额", dataIndex: "amount", align: "right", render: money }]} /></Col><Col xs={24} xl={9}><Card size="small" title="报价快照"><Descriptions column={1} items={[{ key: "member", label: "预约身份", children: quote.membershipSnapshot ? <Space wrap><span>{quote.membershipSnapshot.personalCustomerName}</span>{quote.membershipSnapshot.corporateCustomerName && <Tag color="blue">{quote.membershipSnapshot.corporateCustomerName}</Tag>}<Tag>{quote.membershipSnapshot.enterpriseContractAndPayer ? "企业签约付款" : "个人签约付款"}</Tag></Space> : "旧客户路径" }, { key: "no", label: "报价号", children: quote.quoteNo }, { key: "pricing", label: "价格版本", children: quote.pricingPlanVersion }, { key: "rental", label: "租金", children: money(quote.rentalAmount) }, { key: "discount", label: "总优惠", children: `-${money(quote.discountAmount + quote.couponAmount)}` }, { key: "service", label: "增值服务", children: money(quote.serviceAmount) }, { key: "deposit", label: "押金/预授权", children: money(quote.depositAmount) }, { key: "payable", label: "应付", children: <Typography.Text strong style={{ fontSize: 20 }}>{money(quote.payableAmount)}</Typography.Text> }]} /></Card><div className="form-actions"><Space><Button onClick={() => { setQuote(undefined); setStep(1); }}>返回修改</Button><Button type="primary" loading={createOrder.isPending} onClick={submitOrder}>提交订单</Button></Space></div></Col></Row>}
      {step === 3 && created && <Result status="success" icon={<CheckCircleOutlined />} title="租赁订单已创建" subTitle={`${created.orderNo} 已进入订单主流程。`} extra={[<Button key="detail" type="primary" onClick={() => navigate(`/rental/orders/${created.id}`)}>查看订单</Button>, <Button key="new" onClick={() => { setStep(0); setQuote(undefined); setCreated(undefined); form.resetFields(); initialValues(); }}>继续新建</Button>]} />}
    </Card>
  </>;
}
