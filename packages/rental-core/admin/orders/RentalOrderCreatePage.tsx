/** 新建订单沿服务端报价与客户已签原委托执行，复用公共表单、会话及当前页操作。 */
import { AppstoreOutlined, ArrowLeftOutlined, CalculatorOutlined, CalendarOutlined, CheckCircleOutlined, DeleteOutlined, GiftOutlined, PlusOutlined, TagsOutlined, UserOutlined } from "@rental-os/platform-admin/source/components/ui/icons";
import {
  RENTAL_CATEGORY_DEFINITIONS,
  RENTAL_PRICING_UNIT_LABELS,
  formatRentalMoney,
  type CreateRentalOrderRequest,
  type RentalBookingIdentityInput,
  type RentalQuoteRequest,
  type RentalQuoteSnapshotV1,
} from "@rental-os/rental-core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, Col, Descriptions, Divider, InputNumber, Row, Space, Tag, Typography } from "antd";
import { Radio, Result } from "@rental-os/platform-admin/ui";
import { Checkbox } from "@rental-os/platform-admin/ui";
import { Form } from "@rental-os/platform-admin/ui";
import { Alert, DatePicker } from "@rental-os/platform-admin/ui";
import { Switch } from "@rental-os/platform-admin/ui";
import { Input } from "@rental-os/platform-admin/ui";
import { Button, Select, Tabs } from "@rental-os/platform-admin/ui";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@rental-os/platform-admin/locale";
import { CorePage, CorePageActions, type CoreAdminPageAction } from "@rental-os/platform-admin/core";
import { formSnapshotFingerprint } from "@rental-os/platform-admin/forms";
import { useOrderEditor } from "./useOrderEditor";
import { rentalOrderLocation } from "./pages";
import { rentalOrderSessionIdentity, useRentalOrderContext } from "./page-context";
import styles from "./RentalOrderCreatePage.module.css";
import { detailFulfillmentLabels as fulfillmentModeLabels } from "./orderDetailPresentation";
import { EnterpriseMerchantOrderDelegationPanel } from "./EnterpriseMerchantOrderDelegationPanel";

type FormValues = Omit<RentalQuoteRequest, "startAt" | "endAt" | "services"> & {
  period: [Dayjs, Dayjs];
  bookingIdentity?: RentalBookingIdentityInput;
  deliveryAddressMode?: "saved" | "new";
};
type SelectedService = NonNullable<RentalQuoteRequest["services"]>[number];

const unitLabels = RENTAL_PRICING_UNIT_LABELS;
// 配送/上门类履约：目的地按品类而定（见 category.businessModel.deliveryDestination）。
const DELIVERY_FULFILLMENT_MODES = new Set(["delivery", "onsite_delivery"]);
const isDeliveryMode = (mode?: string) => Boolean(mode && DELIVERY_FULFILLMENT_MODES.has(mode));

export function RentalOrderCreatePage() {
  const context = useRentalOrderContext();
  const identity = rentalOrderSessionIdentity(context.session, context.runtime.currentSessionEpoch());
  return <RentalOrderCreateContent key={identity} />;
}

function RentalOrderCreateContent() {
  const context = useRentalOrderContext();
  const { api: rentalCoreApi } = context;
  const queryScope = rentalOrderSessionIdentity(context.session, context.runtime.currentSessionEpoch());
  const { t, locale } = useLocale();
  const [form] = Form.useForm<FormValues>();
  const [quote, setQuote] = useState<RentalQuoteSnapshotV1>();
  const [failure, setFailure] = useState<string>();
  const currentQuote = useRef<RentalQuoteSnapshotV1 | undefined>(undefined);
  // 输入改变时递增代次，响应只更新其发起时的同一份草稿。
  const quoteGeneration = useRef(0);
  const invalidateQuote = () => {
    quoteGeneration.current += 1;
    currentQuote.current = undefined;
    setQuote(undefined);
    setFailure(undefined);
  };
  const [created, setCreated] = useState<{ id: string; orderNo: string }>();
  const [submissionMode, setSubmissionMode] = useState("ordinary");
  const currentSubmissionMode = useRef(submissionMode); currentSubmissionMode.current = submissionMode;
  const [selectedServices, setSelectedServices] = useState<SelectedService[]>([]);
  const customerId = Form.useWatch("customerId", form);
  const bookingIdentity = Form.useWatch("bookingIdentity", form);
  const fulfillmentMode = Form.useWatch("fulfillmentMode", form) as string | undefined;
  const deliveryAddressMode = Form.useWatch("deliveryAddressMode", form) as "saved" | "new" | undefined;
  const profile = useQuery({ queryKey: ["rental-core", "profile", queryScope], queryFn: rentalCoreApi.profile });
  const settings = useQuery({ queryKey: ["rental-core", "business-settings", queryScope], queryFn: rentalCoreApi.businessSettings });
  // 报价与订单都在本空间生成，币种就是本空间的结算币种；报价回来后优先用它自己的快照。
  const money = (value: number) => formatRentalMoney(Number(value), quote?.currency ?? settings.data?.pricing.currency);
  const pricingGroups = useQuery({ queryKey: ["rental-core", "pricing-groups", queryScope], queryFn: rentalCoreApi.pricingGroups });
  const locations = useQuery({ queryKey: ["rental-core", "locations", queryScope], queryFn: rentalCoreApi.locations });
  // 目的地策略和配送用语来自品类定义/档案，不按相机、车辆等品类写页面分支。
  const categoryDefinition = RENTAL_CATEGORY_DEFINITIONS.find((item) => item.code === profile.data?.categoryCode);
  const deliveryDestination = categoryDefinition?.businessModel.deliveryDestination ?? "customer_address";
  const pricing = useQuery({ queryKey: ["rental-core", "pricing-plans", queryScope], queryFn: rentalCoreApi.pricingPlans });
  const discounts = useQuery({ queryKey: ["rental-core", "discount-plans", queryScope], queryFn: rentalCoreApi.discountPlans });
  const services = useQuery({ queryKey: ["rental-core", "value-added-services", queryScope], queryFn: rentalCoreApi.valueAddedServices });
  // 下单只读取会员最小摘要，不依赖租户会员维护权限。
  const members = useQuery({ queryKey: ["rental-core", "booking-members", queryScope], queryFn: rentalCoreApi.bookingMembers });
  const bookingOptions = useQuery({
    queryKey: ["rental-core", "booking-options", customerId, queryScope],
    queryFn: ({ signal }) => rentalCoreApi.bookingOptions(customerId ?? "", { signal }),
    enabled: Boolean(customerId),
  });
  const coupons = useQuery({
    queryKey: ["rental-core", "customer-coupons", customerId, queryScope],
    queryFn: ({ signal }) => rentalCoreApi.customerCoupons(customerId, { signal }),
    enabled: Boolean(customerId),
  });
  // 只有配送到客户地址且选“已保存地址”时读取地址簿；自取/车辆据点方式不请求。
  const bookingAddresses = useQuery({
    queryKey: ["rental-core", "booking-delivery-addresses", customerId, queryScope],
    queryFn: ({ signal }) => rentalCoreApi.bookingDeliveryAddresses(customerId ?? "", { signal }),
    enabled: Boolean(customerId && deliveryDestination === "customer_address" && isDeliveryMode(fulfillmentMode) && deliveryAddressMode !== "new"),
  });
  const selectedMember = useMemo(() => members.data?.find((item) => item.customerId === customerId), [members.data, customerId]);
  const enterpriseMode = bookingIdentity?.bookingIdentity === "enterprise_employee";
  const deliveryLabel = profile.data?.terminology.deliveryLabel;
  const fulfillmentModeLabel = (value: string) => value === "delivery"
    ? t(deliveryLabel ?? fulfillmentModeLabels.delivery)
    : t(fulfillmentModeLabels[value] ?? value);
  const createQuote = useMutation({
    mutationFn: rentalCoreApi.createQuote,
  });
  const createOrder = useMutation({
    mutationFn: rentalCoreApi.createOrder,
  });

  // 结果页仍保留 Form 实例，编辑身份仅在常规表单可见时开放。
  const quoteEditor = useOrderEditor<FormValues>({
    form, identity: submissionMode === "ordinary" && !created ? queryScope : undefined,
    onSave: quoteOrder, disabled: createOrder.isPending
  });
  // 同一编辑代次复用表单身份，查询刷新不会中断已经开始的字段校验。
  const quoteForm = useMemo(() => ({ ...form, validateFields: quoteEditor.validate }), [form, quoteEditor.key]);

  useEffect(() => {
    if (locations.data?.length && pricingGroups.data?.length && pricing.data?.length && !form.getFieldValue("fulfillmentLocationId")) {
      setInitialValues();
    }
  }, [locations.data, pricingGroups.data, pricing.data, settings.data]);

  function setInitialValues() {
    form.setFieldsValue({
      customerType: "personal",
      bookingIdentity: { bookingIdentity: "personal", enterpriseContractAndPayer: false },
      deliveryAddressMode: "saved",
      fulfillmentMode: settings.data?.fulfillment.enabledModes[0] ?? "store_pickup_return",
      fulfillmentLocationId: locations.data?.[0]?.id,
      period: [dayjs().add(1, "day").hour(9).minute(0), dayjs().add(2, "day").hour(18).minute(0)],
      pricingPlanId: pricing.data?.find((item) => item.status === "enabled")?.id,
      lines: [{ pricingGroupId: pricingGroups.data?.find((item) => item.status === "enabled")?.id ?? "", quantity: 1 }],
    });
  }

  function updateService(serviceId: string, checked: boolean) {
    invalidateQuote();
    setSelectedServices((current) => checked
      ? [...current, { serviceId, quantity: 1 }]
      : current.filter((item) => item.serviceId !== serviceId));
  }

  function updateServiceQuantity(serviceId: string, quantity: number | null) {
    invalidateQuote();
    setSelectedServices((current) => current.map((item) => item.serviceId === serviceId ? { ...item, quantity: quantity ?? 1 } : item));
  }

  async function quoteOrder(values: FormValues): Promise<RentalQuoteSnapshotV1> {
    if (currentSubmissionMode.current !== "ordinary" || !quoteEditor.isCurrent()
      || formSnapshotFingerprint(values) !== formSnapshotFingerprint(form.getFieldsValue()))
      throw new DOMException("报价输入或页面已变化，请重新生成报价", "AbortError");
    if (!selectedMember || selectedMember.customerId !== values.customerId) {
      const error = new Error(t("请选择租户内的有效个人会员"));
      setFailure(error.message);
      throw error;
    }
    const generation = ++quoteGeneration.current;
    setFailure(undefined);
    try {
      const result = await createQuote.mutateAsync({
        customerType: "personal",
        customerId: values.customerId,
        bookingIdentity: values.bookingIdentity,
        fulfillmentMode: values.fulfillmentMode,
        fulfillmentLocationId: values.fulfillmentLocationId,
        returnLocationId: values.returnLocationId,
        deliveryAddressId: deliveryDestination === "customer_address" && isDeliveryMode(values.fulfillmentMode) && values.deliveryAddressMode !== "new"
          ? values.deliveryAddressId
          : undefined,
        deliveryAddressDraft: deliveryDestination === "customer_address" && isDeliveryMode(values.fulfillmentMode) && values.deliveryAddressMode === "new"
          ? values.deliveryAddressDraft
          : undefined,
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
      if (generation !== quoteGeneration.current || currentSubmissionMode.current !== "ordinary" || !quoteEditor.isCurrent())
        throw new DOMException("报价输入或页面已变化，请重新生成报价", "AbortError");
      currentQuote.current = result;
      setQuote(result);
      return result;
    } catch (error) {
      if (generation === quoteGeneration.current && quoteEditor.isCurrent())
        setFailure((error as Error).message || t("报价失败，请检查会员资格、价格、库存与规则"));
      throw error;
    }
  }

  async function submitOrder(): Promise<Awaited<ReturnType<typeof rentalCoreApi.createOrder>>> {
    const original = quote;
    if (currentSubmissionMode.current !== "ordinary" || !quoteEditor.isCurrent() || !original
      || currentQuote.current !== original || !selectedMember || selectedMember.customerId !== original.request.customerId)
      throw new DOMException("请核对当前会员的服务端报价后创建订单", "AbortError");
    const input: CreateRentalOrderRequest = {
      quoteId: original.id,
      customerType: "personal",
      customerId: selectedMember.customerId,
      customerName: selectedMember.name,
      bookingIdentity: original.request.bookingIdentity,
      fulfillmentMode: original.request.fulfillmentMode,
      fulfillmentLocationId: original.request.fulfillmentLocationId,
      returnLocationId: original.request.returnLocationId,
      startAt: original.request.startAt,
      endAt: original.request.endAt,
      lines: original.request.lines.map(({ itemGroupId, pricingGroupId, quantity, note }) => ({ itemGroupId: itemGroupId!, pricingGroupId, quantity, note })),
    };
    setFailure(undefined);
    try {
      const result = await createOrder.mutateAsync(input);
      if (quoteEditor.isCurrent() && currentQuote.current === original) setCreated(result);
      return result;
    } catch (error) {
      if (quoteEditor.isCurrent() && currentQuote.current === original)
        setFailure((error as Error).message || t("创建失败，报价可能过期或资格、库存已变化"));
      throw error;
    }
  }

  function startAnotherOrder() {
    setCreated(undefined);
    invalidateQuote();
    setSelectedServices([]);
    form.resetFields();
    setInitialValues();
    quoteEditor.markClean();
  }

  if (created) {
    const actions: CoreAdminPageAction<FormValues>[] = [
      { id: "back", kind: "navigate", label: { default: t("返回订单") }, icon: <ArrowLeftOutlined />, to: rentalOrderLocation() },
      { id: "detail", kind: "navigate", slot: "content:result", emphasis: "primary", label: { default: t("查看订单") }, to: rentalOrderLocation(created.id) },
      { id: "new", kind: "open", slot: "content:result", label: { default: t("继续新建") }, open: startAnotherOrder }
    ];
    return <CorePage title={t("新建租赁订单")} actions={actions}>
      <Card className="data-panel">
        <Result
          status="success"
          icon={<CheckCircleOutlined />}
          title={t("租赁订单已创建")}
          subTitle={`${created.orderNo} ${t("已进入订单主流程")}`}
          extra={<CorePageActions slot="content:result" />}
        />
      </Card>
    </CorePage>;
  }

  const itemLabel = t(profile.data?.terminology.itemLabel ?? "商品");
  const itemGroupLabel = locale === "en-US" ? `${itemLabel} ${t("定价分组")}` : `${itemLabel}定价分组`;
  const pickupLabel = t(profile.data?.terminology.pickupLabel ?? "领取");
  const returnLabel = t(profile.data?.terminology.returnLabel ?? "归还");

  const ordinaryForm = <Form<FormValues> form={form} layout="vertical" disabled={createOrder.isPending}
      onSubmitCapture={quoteEditor.formProps.onSubmitCapture}
      onValuesChange={(changed, values) => { quoteEditor.formProps.onValuesChange?.(changed, values); invalidateQuote(); }}>
      <Row gutter={[16, 16]} align="stretch">
        {failure && <Col span={24}><Alert showIcon type="error" title={failure} /></Col>}
        <Col xs={24} xl={17}>
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <div className={styles.bookingContext}>
                <Card className="data-panel" title={<Space><UserOutlined />{t("会员与预约身份")}</Space>} style={{ height: "100%" }}>
                  <Form.Item name="customerId" label={t("预约会员")} rules={[{ required: true, message: t("请选择个人会员") }]}>
                    <Select
                      showSearch={{ optionFilterProp: "label" }}
                      loading={members.isLoading}
                      placeholder={t("搜索姓名或手机号")}
                      options={(members.data ?? []).filter((item) => item.membershipStatus === "active").map((item) => ({
                        value: item.customerId,
                        label: `${item.name} · ${item.phoneMasked}`,
                      }))}
                      onChange={() => {
                        form.setFieldValue("bookingIdentity", { bookingIdentity: "personal", enterpriseContractAndPayer: false });
                        form.setFieldValue("deliveryAddressId", undefined);
                        form.setFieldValue("deliveryAddressDraft", undefined);
                      }}
                    />
                  </Form.Item>
                  <Form.Item name={["bookingIdentity", "bookingIdentity"]} label={t("以什么身份预约")} rules={[{ required: true }]}>
                    <Radio.Group
                      block
                      optionType="button"
                      buttonStyle="solid"
                      disabled={!customerId}
                      options={[
                        { value: "personal", label: t("个人（默认）") },
                        { value: "enterprise_employee", label: t("企业员工"), disabled: !(bookingOptions.data?.length) },
                      ]}
                      onChange={(event) => form.setFieldValue("bookingIdentity", {
                        bookingIdentity: event.target.value,
                        enterpriseContractAndPayer: false,
                      })}
                    />
                  </Form.Item>
                  {enterpriseMode && <Row gutter={12}>
                    <Col span={14}>
                      <Form.Item name={["bookingIdentity", "corporateCustomerId"]} label={t("所属企业")} rules={[{ required: true, message: t("请选择企业") }]}>
                        <Select loading={bookingOptions.isLoading} options={(bookingOptions.data ?? []).map((item) => ({
                          value: item.corporateCustomerId,
                          label: `${item.corporateCustomerName}${item.role === "admin" ? ` · ${t("企业管理员")}` : ""}`,
                        }))} />
                      </Form.Item>
                    </Col>
                    <Col span={10}>
                      <Form.Item name={["bookingIdentity", "enterpriseContractAndPayer"]} label={t("企业签约付款")} valuePropName="checked">
                        <Switch checkedChildren={t("企业")} unCheckedChildren={t("个人")} />
                      </Form.Item>
                    </Col>
                  </Row>}
                  {(members.error || bookingOptions.error) && <Alert showIcon type="error" title={t("会员或企业身份加载失败")} description={members.error?.message ?? bookingOptions.error?.message} style={{ marginBottom: 12 }} />}
                  {selectedMember
                    ? <Alert showIcon type="info" title={`${selectedMember.name} · ${selectedMember.phoneMasked}`} description={t("租户统一会员。下单仅显示必要信息，会员状态、资质及本空间适用权益由服务端在报价时复核。")} />
                    : <Alert showIcon type="info" title={t("先选择会员，再选择个人或企业预约身份")} />}
                </Card>
                <Card className="data-panel" title={<Space><CalendarOutlined />{t("租赁时间与履约")}</Space>} style={{ height: "100%" }}>
                  {/* 先选履约方式，再按方式驱动目的地：取还类选地点，配送到客户类选发货地点 + 收货地址。 */}
                  <Form.Item name="fulfillmentMode" label={t("履约方式")} rules={[{ required: true }]}>
                    <Select
                      onChange={() => {
                        form.setFieldValue("deliveryAddressId", undefined);
                        form.setFieldValue("deliveryAddressDraft", undefined);
                      }}
                      options={(settings.data?.fulfillment.enabledModes ?? []).map((value) => ({ value, label: fulfillmentModeLabel(value) }))}
                    />
                  </Form.Item>
                  <Form.Item name="period" label={t("租赁时间")} rules={[{ required: true }]}>
                    <DatePicker.RangePicker showTime style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(before, after) => before.fulfillmentMode !== after.fulfillmentMode}>
                    {({ getFieldValue }) => {
                      const mode = getFieldValue("fulfillmentMode") as string | undefined;
                      const toCustomerAddress = deliveryDestination === "customer_address" && isDeliveryMode(mode);
                      const locationOptions = (locations.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }));
                      return <>
                        <Row gutter={12}>
                          <Col span={toCustomerAddress ? 24 : 12}>
                            <Form.Item name="fulfillmentLocationId" label={toCustomerAddress ? t("发货地点") : `${pickupLabel}${t("地点")}`} rules={[{ required: true }]} style={toCustomerAddress ? { marginBottom: 0 } : undefined}>
                              <Select options={locationOptions} />
                            </Form.Item>
                          </Col>
                          {!toCustomerAddress && <Col span={12}>
                            <Form.Item name="returnLocationId" label={`${returnLabel}${t("地点")}`} style={{ marginBottom: 0 }}>
                              <Select allowClear placeholder={t("默认同领取地点")} options={locationOptions} />
                            </Form.Item>
                          </Col>}
                        </Row>
                        {toCustomerAddress && <Form.Item noStyle shouldUpdate={(before, after) => before.deliveryAddressMode !== after.deliveryAddressMode}>
                          {({ getFieldValue }) => {
                            const addressMode = (getFieldValue("deliveryAddressMode") ?? "saved") as "saved" | "new";
                            return <div style={{ marginTop: 12 }}>
                              <Form.Item name="deliveryAddressMode" label={t("收货地址方式")} style={{ marginBottom: 12 }}>
                                <Radio.Group
                                  optionType="button"
                                  buttonStyle="solid"
                                  onChange={(event) => {
                                    form.setFieldValue("deliveryAddressId", undefined);
                                    if (event.target.value === "saved") form.setFieldValue("deliveryAddressDraft", undefined);
                                  }}
                                  options={[{ value: "saved", label: t("选择已保存地址") }, { value: "new", label: t("填写本单地址") }]}
                                />
                              </Form.Item>
                              {addressMode === "saved" ? <>
                                <Form.Item
                                  name="deliveryAddressId"
                                  label={t("客户收货地址")}
                                  rules={[{ required: true, message: t("请选择客户收货地址") }]}
                                  extra={!customerId ? t("请先选择会员") : bookingAddresses.isError ? t("地址簿读取失败，请重试") : (bookingAddresses.data?.length ? undefined : t("该会员暂无已保存地址，可切换为填写本单地址"))}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Select
                                    loading={bookingAddresses.isFetching}
                                    disabled={!customerId || bookingAddresses.isError}
                                    placeholder={t("选择客户已保存的收货地址")}
                                    options={(bookingAddresses.data ?? []).map((address) => ({
                                      value: address.id,
                                      label: `${address.recipient} · ${address.phoneMasked} · ${address.province}${address.city}${address.district ?? ""}${address.detail}`,
                                    }))}
                                  />
                                </Form.Item>
                                {bookingAddresses.isError && <Button type="link" onClick={() => void bookingAddresses.refetch()}>{t("重新读取地址")}</Button>}
                              </> : <>
                                <Alert type="info" showIcon message={t("地址仅保存到本订单，不会修改客户地址簿")} style={{ marginBottom: 12 }} />
                                <Row gutter={12}>
                                  <Col xs={24} md={12}><Form.Item name={["deliveryAddressDraft", "recipient"]} label={t("收件人")} rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item></Col>
                                  <Col xs={24} md={12}><Form.Item name={["deliveryAddressDraft", "phone"]} label={t("联系电话")} rules={[{ required: true, whitespace: true }, { pattern: /^\+?[0-9][0-9\s()-]{5,38}$/u, message: t("请输入有效联系电话") }]}><Input type="tel" maxLength={40} /></Form.Item></Col>
                                  <Col xs={24} md={8}><Form.Item name={["deliveryAddressDraft", "province"]} label={t("省/州")} rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item></Col>
                                  <Col xs={24} md={8}><Form.Item name={["deliveryAddressDraft", "city"]} label={t("城市")} rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item></Col>
                                  <Col xs={24} md={8}><Form.Item name={["deliveryAddressDraft", "district"]} label={t("区/县")}><Input maxLength={100} /></Form.Item></Col>
                                  <Col span={24}><Form.Item name={["deliveryAddressDraft", "detail"]} label={t("详细地址")} rules={[{ required: true, whitespace: true }]}><Input maxLength={500} /></Form.Item></Col>
                                </Row>
                              </>}
                            </div>;
                          }}
                        </Form.Item>}
                      </>;
                    }}
                  </Form.Item>
                </Card>
            </div>

            <Card
              className="data-panel"
              title={<Space><AppstoreOutlined />{t("选择")}{itemGroupLabel}</Space>}
              extra={<Typography.Text type="secondary">{t("支持一张订单添加多项")}</Typography.Text>}
            >
              <Form.Item name="pricingPlanId" label={t("计价方案")} rules={[{ required: true }]} style={{ maxWidth: 420 }}>
                <Select options={(pricing.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.name} · v${item.version}` }))} />
              </Form.Item>
              <Form.List name="lines">
                {(fields, { add, remove }) => <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                  {fields.map((field, index) => <Card key={field.key} size="small" styles={{ body: { paddingBottom: 0 } }}>
                    <Row gutter={12} align="middle">
                      <Col xs={24} md={10}>
                        <Form.Item name={[field.name, "pricingGroupId"]} label={`${itemGroupLabel} ${index + 1}`} rules={[{ required: true }]}>
                          <Select
                            showSearch={{ optionFilterProp: "label" }}
                            options={(pricingGroups.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: `${item.code} · ${item.name}（${item.members.map((member) => member.name).join("、")}）` }))}
                            onChange={() => form.setFieldValue(["lines", field.name, "itemGroupId"], undefined)}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={8} md={4}>
                        <Form.Item name={[field.name, "quantity"]} label={t("数量")} rules={[{ required: true }]}>
                          <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={8} md={5}>
                        <Form.Item name={[field.name, "pricingUnit"]} label={t("计价单位")}>
                          <Select allowClear placeholder={t("自动")} options={[...new Set((pricing.data ?? []).flatMap((plan) => plan.rates.map((rate) => rate.unit)))].map((value) => ({ value, label: t(unitLabels[value] ?? value) }))} />
                        </Form.Item>
                      </Col>
                      <Col xs={6} md={3}>
                        <Form.Item name={[field.name, "usageQuantity"]} label={t("使用量")}>
                          <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={2} md={2}>
                        {fields.length > 1 && <Button danger type="text" icon={<DeleteOutlined />} aria-label={`${t("删除")}${itemLabel}`} onClick={() => remove(field.name)} />}
                      </Col>
                    </Row>
                    <Form.Item noStyle shouldUpdate={(before, after) => before.lines?.[field.name]?.pricingGroupId !== after.lines?.[field.name]?.pricingGroupId}>
                      {({ getFieldValue }) => {
                        const selectedGroup = (pricingGroups.data ?? []).find((item) => item.id === getFieldValue(["lines", field.name, "pricingGroupId"]));
                        return <Form.Item
                          name={[field.name, "itemGroupId"]}
                          label={t("预约型号（可选）")}
                          extra={t("不选表示按定价分组预约；选定后只能分配该准确型号，不会静默替换。")}
                          style={{ maxWidth: 520 }}
                        >
                          <Select
                            allowClear
                            showSearch={{ optionFilterProp: "label" }}
                            placeholder={t("按分组预约")}
                            disabled={!selectedGroup}
                            options={(selectedGroup?.members ?? []).map((member) => ({ value: member.id, label: `${member.code} · ${member.name}` }))}
                          />
                        </Form.Item>;
                      }}
                    </Form.Item>
                  </Card>)}
                  <Button block type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>{t("继续添加定价分组")}</Button>
                </Space>}
              </Form.List>
            </Card>

            <Card className="data-panel" title={<Space><GiftOutlined />{t("增值服务")}</Space>}>
              {(services.data ?? []).filter((item) => item.status === "enabled").length === 0
                ? <Typography.Text type="secondary">{t("当前没有可选增值服务")}</Typography.Text>
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
                          style={{ width: "var(--rental-control-width-compact)" }}
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
              <Card className="data-panel" title={<Space><TagsOutlined />{t("优惠与权益")}</Space>}>
                <Form.Item name="discountPlanId" label={t("优惠方案")} extra={t("可留空，由服务端自动匹配最优方案。")}>
                  <Select allowClear placeholder={t("自动匹配")} options={(discounts.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.id, label: item.name }))} />
                </Form.Item>
                <Form.Item name="customerCouponId" label={t("会员优惠券")} style={{ marginBottom: 0 }}>
                  <Select
                    allowClear
                    disabled={!customerId}
                    placeholder={customerId ? t("选择可用优惠券") : t("请先选择会员")}
                    options={(coupons.data ?? []).filter((item) => item.status === "claimed").map((item) => ({
                      value: item.id,
                      label: `${item.templateName} · ${item.effectiveTo.slice(0, 10)} ${t("到期")}`,
                    }))}
                  />
                </Form.Item>
              </Card>

              <Card className="data-panel" title={<Space><CalculatorOutlined />{t("费用明细")}</Space>}>
                {quote && <>
                  <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                    {quote.chargeLines.map((line) => <Row key={line.code} justify="space-between" wrap={false} gutter={12}>
                      <Col flex="auto">
                        <Typography.Text>{t(line.name)}</Typography.Text>
                        {line.detail && <div><Typography.Text type="secondary" className="text-meta">{t(line.detail)}</Typography.Text></div>}
                      </Col>
                      <Col><Typography.Text strong={line.amount > 0}>{money(line.amount)}</Typography.Text></Col>
                    </Row>)}
                  </Space>
                  <Divider style={{ margin: "16px 0" }} />
                  <Descriptions
                    size="small"
                    column={1}
                    items={[
                      { key: "identity", label: t("预约身份"), children: quote.membershipSnapshot ? <Space wrap><span>{quote.membershipSnapshot.personalCustomerName}</span>{quote.membershipSnapshot.corporateCustomerName && <Tag color="blue">{quote.membershipSnapshot.corporateCustomerName}</Tag>}</Space> : t("个人") },
                      { key: "discount", label: t("优惠合计"), children: `-${money(quote.discountAmount + quote.couponAmount)}` },
                      { key: "deposit", label: t("押金/预授权"), children: money(quote.depositAmount) },
                    ]}
                  />
                  <Divider style={{ margin: "16px 0 12px" }} />
                  <Row justify="space-between" align="middle">
                    <Typography.Text>{t("应付金额")}</Typography.Text>
                    <Typography.Text strong className="order-quote-total">{money(quote.payableAmount)}</Typography.Text>
                  </Row>
                </>}
                <CorePageActions slot="content:quote" />
              </Card>
            </Space>
          </div>
        </Col>
      </Row>
    </Form>;
  const pageActions: CoreAdminPageAction<FormValues>[] = [{
    id: "back", kind: "navigate", label: { default: t("返回订单") }, icon: <ArrowLeftOutlined />, to: rentalOrderLocation()
  }];
  if (submissionMode === "ordinary") {
    pageActions.push({
      id: "quote", kind: "save", slot: "content:quote", emphasis: quote ? "secondary" : "primary",
      label: { default: t(quote ? "重新计算报价" : "生成报价") },
      permissions: [{ resource: "order", action: "create" }],
      form: quoteForm, onSave: quoteEditor.submit,
      presentation: { control: "button", block: true, size: "large", style: { marginTop: quote ? "var(--space-4)" : 0 } },
      pending: createQuote.isPending || quoteEditor.busy, disabled: createOrder.isPending
    });
    if (quote) pageActions.push({
      id: "create", kind: "command", slot: "content:quote", emphasis: "primary", label: { default: t("确认并创建订单") },
      presentation: { control: "button", block: true, size: "large", style: { marginTop: "var(--space-3)" } },
      permissions: [{ resource: "order", action: "create" }], execute: submitOrder,
      pending: createOrder.isPending, disabled: createQuote.isPending || quoteEditor.busy
    });
  }
  return <CorePage title={t("新建租赁订单")} actions={pageActions}>
    <Tabs activeKey={submissionMode} destroyOnHidden={false}
      onChange={mode => { currentSubmissionMode.current = mode; quoteGeneration.current += 1; setSubmissionMode(mode); }} items={[
      { key: "ordinary", label: locale === "en-US" ? "Ordinary order" : "常规订单", children: ordinaryForm,
        disabled: createQuote.isPending || createOrder.isPending },
      { key: "delegated", label: locale === "en-US" ? "Customer delegation" : "客户本次委托",
        children: <EnterpriseMerchantOrderDelegationPanel active={submissionMode === "delegated"} />,
        disabled: createQuote.isPending || createOrder.isPending },
    ]} />
  </CorePage>;
}
