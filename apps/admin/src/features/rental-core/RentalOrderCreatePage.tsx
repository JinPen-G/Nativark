import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  CalculatorOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  GiftOutlined,
  PlusOutlined,
  TagsOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  RENTAL_PRICING_UNIT_LABELS,
  formatRentalMoney,
  type CreateRentalOrderRequest,
  type RentalBookingIdentityInput,
  type RentalQuoteRequest,
  type RentalQuoteSnapshotV1,
} from "@rental-os/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  InputNumber,
  Radio,
  Result,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";

type FormValues = Omit<RentalQuoteRequest, "startAt" | "endAt" | "services"> & {
  period: [Dayjs, Dayjs];
  bookingIdentity?: RentalBookingIdentityInput;
};
type SelectedService = NonNullable<RentalQuoteRequest["services"]>[number];

const unitLabels = RENTAL_PRICING_UNIT_LABELS;
const fulfillmentModeLabels: Record<string, string> = {
  store_pickup_return: "门店取还",
  partner_pickup_return: "合作点取还",
  warehouse_pickup_return: "仓库取还",
  locker_pickup_return: "智能柜取还",
  delivery: "配送取还",
  onsite_delivery: "现场交付",
};

export function RentalOrderCreatePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const [quote, setQuote] = useState<RentalQuoteSnapshotV1>();
  const [created, setCreated] = useState<{ id: string; orderNo: string }>();
  const [selectedServices, setSelectedServices] = useState<SelectedService[]>([]);
  const customerId = Form.useWatch("customerId", form);
  const bookingIdentity = Form.useWatch("bookingIdentity", form);
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const settings = useQuery({ queryKey: ["rental-core", "business-settings"], queryFn: rentalCoreApi.businessSettings });
  // 报价与订单都在本空间生成，币种就是本空间的结算币种；报价回来后优先用它自己的快照。
  const money = (value: number) => formatRentalMoney(Number(value), quote?.currency ?? settings.data?.pricing.currency);
  const pricingGroups = useQuery({ queryKey: ["rental-core", "pricing-groups"], queryFn: rentalCoreApi.pricingGroups });
  const locations = useQuery({ queryKey: ["rental-core", "locations"], queryFn: rentalCoreApi.locations });
  const pricing = useQuery({ queryKey: ["rental-core", "pricing-plans"], queryFn: rentalCoreApi.pricingPlans });
  const discounts = useQuery({ queryKey: ["rental-core", "discount-plans"], queryFn: rentalCoreApi.discountPlans });
  const services = useQuery({ queryKey: ["rental-core", "value-added-services"], queryFn: rentalCoreApi.valueAddedServices });
  // 下单只读取会员最小摘要，不依赖租户会员维护权限。
  const members = useQuery({ queryKey: ["rental-core", "booking-members"], queryFn: rentalCoreApi.bookingMembers });
  const bookingOptions = useQuery({
    queryKey: ["rental-core", "booking-options", customerId],
    queryFn: () => rentalCoreApi.bookingOptions(customerId ?? ""),
    enabled: Boolean(customerId),
  });
  const coupons = useQuery({
    queryKey: ["rental-core", "customer-coupons", customerId],
    queryFn: () => rentalCoreApi.customerCoupons(customerId),
    enabled: Boolean(customerId),
  });
  const selectedMember = useMemo(() => members.data?.find((item) => item.customerId === customerId), [members.data, customerId]);
  const enterpriseMode = bookingIdentity?.bookingIdentity === "enterprise_employee";
  const createQuote = useMutation({
    mutationFn: rentalCoreApi.createQuote,
    onSuccess: setQuote,
    onError: (error: Error) => message.error(error.message || "报价失败，请检查会员资格、价格、库存与规则"),
  });
  const createOrder = useMutation({
    mutationFn: rentalCoreApi.createOrder,
    onSuccess: setCreated,
    onError: (error: Error) => message.error(error.message || "创建失败，报价可能过期或资格、库存已变化"),
  });

  useEffect(() => {
    if (locations.data?.length && pricingGroups.data?.length && pricing.data?.length && !form.getFieldValue("fulfillmentLocationId")) {
      setInitialValues();
    }
  }, [locations.data, pricingGroups.data, pricing.data, settings.data]);

  function setInitialValues() {
    form.setFieldsValue({
      customerType: "personal",
      bookingIdentity: { bookingIdentity: "personal", enterpriseContractAndPayer: false },
      fulfillmentMode: settings.data?.fulfillment.enabledModes[0] ?? "store_pickup_return",
      fulfillmentLocationId: locations.data?.[0]?.id,
      period: [dayjs().add(1, "day").hour(9).minute(0), dayjs().add(2, "day").hour(18).minute(0)],
      pricingPlanId: pricing.data?.find((item) => item.status === "enabled")?.id,
      lines: [{ pricingGroupId: pricingGroups.data?.find((item) => item.status === "enabled")?.id ?? "", quantity: 1 }],
    });
  }

  function updateService(serviceId: string, checked: boolean) {
    setQuote(undefined);
    setSelectedServices((current) => checked
      ? [...current, { serviceId, quantity: 1 }]
      : current.filter((item) => item.serviceId !== serviceId));
  }

  function updateServiceQuantity(serviceId: string, quantity: number | null) {
    setQuote(undefined);
    setSelectedServices((current) => current.map((item) => item.serviceId === serviceId ? { ...item, quantity: quantity ?? 1 } : item));
  }

  async function quoteOrder() {
    const values = await form.validateFields();
    if (!selectedMember) {
      message.error("请选择租户内的有效个人会员");
      return;
    }
    createQuote.mutate({
      customerType: "personal",
      customerId: values.customerId,
      bookingIdentity: values.bookingIdentity,
      fulfillmentMode: values.fulfillmentMode,
      fulfillmentLocationId: values.fulfillmentLocationId,
      returnLocationId: values.returnLocationId,
      startAt: values.period[0].toISOString(),
      endAt: values.period[1].toISOString(),
      pricingPlanId: values.pricingPlanId,
      discountPlanId: values.discountPlanId,
      customerCouponId: values.customerCouponId,
      lines: values.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        usageQuantity: line.usageQuantity === undefined ? undefined : Number(line.usageQuantity),
      })),
      services: selectedServices.map((item) => ({ ...item, quantity: Number(item.quantity) })),
    });
  }

  function submitOrder() {
    if (!quote || !selectedMember) return;
    const input: CreateRentalOrderRequest = {
      quoteId: quote.id,
      customerType: "personal",
      customerId: selectedMember.customerId,
      customerName: selectedMember.name,
      bookingIdentity: quote.request.bookingIdentity,
      fulfillmentMode: quote.request.fulfillmentMode,
      fulfillmentLocationId: quote.request.fulfillmentLocationId,
      returnLocationId: quote.request.returnLocationId,
      startAt: quote.request.startAt,
      endAt: quote.request.endAt,
      lines: quote.request.lines.map(({ itemGroupId, pricingGroupId, quantity, note }) => ({ itemGroupId: itemGroupId!, pricingGroupId, quantity, note })),
    };
    createOrder.mutate(input);
  }

  function startAnotherOrder() {
    setCreated(undefined);
    setQuote(undefined);
    setSelectedServices([]);
    form.resetFields();
    setInitialValues();
  }

  if (created) {
    return <>
      <PageHeader title="新建租赁订单" description="订单已经创建完成。" extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/rental/orders")}>返回订单</Button>} />
      <Card className="data-panel">
        <Result
          status="success"
          icon={<CheckCircleOutlined />}
          title="租赁订单已创建"
          subTitle={`${created.orderNo} 已进入订单主流程。`}
          extra={[
            <Button key="detail" type="primary" onClick={() => navigate(`/rental/orders/${created.id}`)}>查看订单</Button>,
            <Button key="new" onClick={startAnotherOrder}>继续新建</Button>,
          ]}
        />
      </Card>
    </>;
  }

  const itemLabel = profile.data?.terminology.itemLabel ?? "商品";
  const itemGroupLabel = `${profile.data?.terminology.itemLabel ?? "商品"}定价分组`;
  const pickupLabel = profile.data?.terminology.pickupLabel ?? "领取";
  const returnLabel = profile.data?.terminology.returnLabel ?? "归还";

  return <>
    <PageHeader
      title="新建租赁订单"
      description={`在一个页面内完成会员、${itemGroupLabel}、增值服务、优惠和报价确认。`}
      extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/rental/orders")}>返回订单</Button>}
    />
    <Form<FormValues> form={form} layout="vertical" onValuesChange={() => setQuote(undefined)}>
      <Row gutter={[16, 16]} align="top">
        <Col xs={24} xl={17}>
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card className="data-panel" title={<Space><UserOutlined />会员与预约身份</Space>} style={{ height: "100%" }}>
                  <Form.Item name="customerId" label="预约会员" rules={[{ required: true, message: "请选择个人会员" }]}>
                    <Select
                      showSearch={{ optionFilterProp: "label" }}
                      loading={members.isLoading}
                      placeholder="搜索姓名或手机号"
                      options={(members.data ?? []).filter((item) => item.membershipStatus === "active").map((item) => ({
                        value: item.customerId,
                        label: `${item.name} · ${item.phoneMasked}`,
                      }))}
                      onChange={() => form.setFieldValue("bookingIdentity", { bookingIdentity: "personal", enterpriseContractAndPayer: false })}
                    />
                  </Form.Item>
                  <Form.Item name={["bookingIdentity", "bookingIdentity"]} label="以什么身份预约" rules={[{ required: true }]}>
                    <Radio.Group
                      block
                      optionType="button"
                      buttonStyle="solid"
                      disabled={!customerId}
                      options={[
                        { value: "personal", label: "个人（默认）" },
                        { value: "enterprise_employee", label: "企业员工", disabled: !(bookingOptions.data?.length) },
                      ]}
                      onChange={(event) => form.setFieldValue("bookingIdentity", {
                        bookingIdentity: event.target.value,
                        enterpriseContractAndPayer: false,
                      })}
                    />
                  </Form.Item>
                  {enterpriseMode && <Row gutter={12}>
                    <Col span={14}>
                      <Form.Item name={["bookingIdentity", "corporateCustomerId"]} label="所属企业" rules={[{ required: true, message: "请选择企业" }]}>
                        <Select loading={bookingOptions.isLoading} options={(bookingOptions.data ?? []).map((item) => ({
                          value: item.corporateCustomerId,
                          label: `${item.corporateCustomerName}${item.role === "admin" ? " · 企业管理员" : ""}`,
                        }))} />
                      </Form.Item>
                    </Col>
                    <Col span={10}>
                      <Form.Item name={["bookingIdentity", "enterpriseContractAndPayer"]} label="企业签约付款" valuePropName="checked">
                        <Switch checkedChildren="企业" unCheckedChildren="个人" />
                      </Form.Item>
                    </Col>
                  </Row>}
                  {(members.error || bookingOptions.error) && <Alert showIcon type="error" title="会员或企业身份加载失败" description={members.error?.message ?? bookingOptions.error?.message} style={{ marginBottom: 12 }} />}
                  {selectedMember
                    ? <Alert showIcon type="info" title={`${selectedMember.name} · ${selectedMember.phoneMasked}`} description="租户统一会员。下单仅显示必要信息，会员状态、资质及本空间适用权益由服务端在报价时复核。" />
                    : <Alert showIcon type="info" title="先选择会员，再选择个人或企业预约身份" />}
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card className="data-panel" title={<Space><CalendarOutlined />租赁时间与履约</Space>} style={{ height: "100%" }}>
                  <Row gutter={12}>
                    <Col span={12}>
                      <Form.Item name="fulfillmentLocationId" label={`${pickupLabel}地点`} rules={[{ required: true }]}>
                        <Select options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="returnLocationId" label={`${returnLabel}地点`}>
                        <Select allowClear placeholder="默认同领取地点" options={(locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="period" label="租赁时间" rules={[{ required: true }]}>
                    <DatePicker.RangePicker showTime style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item name="fulfillmentMode" label="履约方式" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                    <Select options={(settings.data?.fulfillment.enabledModes ?? []).map((value) => ({ value, label: fulfillmentModeLabels[value] ?? value }))} />
                  </Form.Item>
                </Card>
              </Col>
            </Row>

            <Card
              className="data-panel"
              title={<Space><AppstoreOutlined />选择{itemGroupLabel}</Space>}
              extra={<Typography.Text type="secondary">支持一张订单添加多项</Typography.Text>}
            >
              <Form.Item name="pricingPlanId" label="计价方案" rules={[{ required: true }]} style={{ maxWidth: 420 }}>
                <Select options={(pricing.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.name} · v${item.version}` }))} />
              </Form.Item>
              <Form.List name="lines">
                {(fields, { add, remove }) => <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                  {fields.map((field, index) => <Card key={field.key} size="small" styles={{ body: { paddingBottom: 0 } }}>
                    <Row gutter={12} align="middle">
                      <Col xs={24} md={10}>
                        <Form.Item name={[field.name, "pricingGroupId"]} label={`${itemGroupLabel} ${index + 1}`} rules={[{ required: true }]}>
                          <Select showSearch={{ optionFilterProp: "label" }} options={(pricingGroups.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.code} · ${item.name}（${item.members.map((member) => member.name).join("、")}）` }))} />
                        </Form.Item>
                      </Col>
                      <Col xs={8} md={4}>
                        <Form.Item name={[field.name, "quantity"]} label="数量" rules={[{ required: true }]}>
                          <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={8} md={5}>
                        <Form.Item name={[field.name, "pricingUnit"]} label="计价单位">
                          <Select allowClear placeholder="自动" options={[...new Set((pricing.data ?? []).flatMap((plan) => plan.rates.map((rate) => rate.unit)))].map((value) => ({ value, label: unitLabels[value] ?? value }))} />
                        </Form.Item>
                      </Col>
                      <Col xs={6} md={3}>
                        <Form.Item name={[field.name, "usageQuantity"]} label="使用量">
                          <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={2} md={2}>
                        {fields.length > 1 && <Button danger type="text" icon={<DeleteOutlined />} aria-label={`删除${itemLabel}`} onClick={() => remove(field.name)} />}
                      </Col>
                    </Row>
                  </Card>)}
                  <Button block type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>继续添加定价分组</Button>
                </Space>}
              </Form.List>
            </Card>

            <Card className="data-panel" title={<Space><GiftOutlined />增值服务</Space>}>
              {(services.data ?? []).filter((item) => item.status === "enabled").length === 0
                ? <Typography.Text type="secondary">当前没有可选增值服务</Typography.Text>
                : <Row gutter={[12, 12]}>
                  {(services.data ?? []).filter((item) => item.status === "enabled").map((service) => {
                    const selected = selectedServices.find((item) => item.serviceId === service.id);
                    return <Col xs={24} md={12} key={service.id}>
                      <Card size="small" styles={{ body: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } }}>
                        <Checkbox checked={Boolean(selected)} onChange={(event) => updateService(service.id, event.target.checked)}>
                          <Space orientation="vertical" size={0}>
                            <Typography.Text strong>{service.name}</Typography.Text>
                            <Typography.Text type="secondary">{money(service.price)}</Typography.Text>
                          </Space>
                        </Checkbox>
                        <InputNumber
                          min={1}
                          precision={0}
                          value={selected?.quantity ?? 1}
                          disabled={!selected}
                          onChange={(value) => updateServiceQuantity(service.id, value)}
                          style={{ width: 80 }}
                        />
                      </Card>
                    </Col>;
                  })}
                </Row>}
            </Card>
          </Space>
        </Col>

        <Col xs={24} xl={7}>
          <div style={{ position: "sticky", top: 16 }}>
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
              <Card className="data-panel" title={<Space><TagsOutlined />优惠与权益</Space>}>
                <Form.Item name="discountPlanId" label="优惠方案" extra="可留空，由服务端自动匹配最优方案。">
                  <Select allowClear placeholder="自动匹配" options={(discounts.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} />
                </Form.Item>
                <Form.Item name="customerCouponId" label="会员优惠券" style={{ marginBottom: 0 }}>
                  <Select
                    allowClear
                    disabled={!customerId}
                    placeholder={customerId ? "选择可用优惠券" : "请先选择会员"}
                    options={(coupons.data ?? []).filter((item) => item.status === "claimed").map((item) => ({
                      value: item.id,
                      label: `${item.templateName} · ${item.effectiveTo.slice(0, 10)} 到期`,
                    }))}
                  />
                </Form.Item>
              </Card>

              <Card className="data-panel" title={<Space><CalculatorOutlined />费用明细</Space>}>
                {!quote && <Alert showIcon type="info" title="填写完成后生成报价" description="价格、库存、营业日历、会员资格和优惠均由服务端统一计算。" />}
                {quote && <>
                  <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                    {quote.chargeLines.map((line) => <Row key={line.code} justify="space-between" wrap={false} gutter={12}>
                      <Col flex="auto">
                        <Typography.Text>{line.name}</Typography.Text>
                        {line.detail && <div><Typography.Text type="secondary" className="text-meta">{line.detail}</Typography.Text></div>}
                      </Col>
                      <Col><Typography.Text strong={line.amount > 0}>{money(line.amount)}</Typography.Text></Col>
                    </Row>)}
                  </Space>
                  <Divider style={{ margin: "16px 0" }} />
                  <Descriptions
                    size="small"
                    column={1}
                    items={[
                      { key: "identity", label: "预约身份", children: quote.membershipSnapshot ? <Space wrap><span>{quote.membershipSnapshot.personalCustomerName}</span>{quote.membershipSnapshot.corporateCustomerName && <Tag color="blue">{quote.membershipSnapshot.corporateCustomerName}</Tag>}</Space> : "个人" },
                      { key: "discount", label: "优惠合计", children: `-${money(quote.discountAmount + quote.couponAmount)}` },
                      { key: "deposit", label: "押金/预授权", children: money(quote.depositAmount) },
                    ]}
                  />
                  <Divider style={{ margin: "16px 0 12px" }} />
                  <Row justify="space-between" align="middle">
                    <Typography.Text>应付金额</Typography.Text>
                    <Typography.Text strong className="order-quote-total">{money(quote.payableAmount)}</Typography.Text>
                  </Row>
                </>}
                <Button block size="large" type={quote ? "default" : "primary"} loading={createQuote.isPending} onClick={quoteOrder} style={{ marginTop: 16 }}>
                  {quote ? "重新计算报价" : "生成报价"}
                </Button>
                {quote && <Button block size="large" type="primary" loading={createOrder.isPending} onClick={submitOrder} style={{ marginTop: 10 }}>确认并创建订单</Button>}
              </Card>
            </Space>
          </div>
        </Col>
      </Row>
    </Form>
  </>;
}
