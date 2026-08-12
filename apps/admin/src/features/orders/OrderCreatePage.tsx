import { ArrowLeftOutlined, CheckCircleOutlined } from "@ant-design/icons";
import type { BillingMode, CreateStoreRentalOrderRequest, PricingQuoteRequest, StoreRentalAvailabilityGroup, StoreRentalMode } from "@store-rental/shared";
import { App, Button, Card, Col, DatePicker, Descriptions, Divider, Form, Input, Radio, Result, Row, Select, Space, Steps, Table, Tag, Typography } from "antd";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";

type OrderFormValues = {
  planId: string;
  storeRange: [string, string];
  rentalRange: [Dayjs, Dayjs];
  vehicleGroupCode: string;
  billingMode: BillingMode;
  serviceCodes?: string[];
  marketingPlanId?: string;
  customerName: string;
  customerPhone: string;
  memberId?: string;
  corporateId?: string;
  corporateShortName?: string;
  collectionMode: "deposit" | "pending" | "monthly";
};

const money = (value: number | undefined) => `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const billingModes = { customerPay: "customer_pay" as BillingMode, monthly: "monthly" as BillingMode };
const storeRentalMode = "store_rental" as StoreRentalMode;

export function OrderCreatePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<OrderFormValues>();
  const [step, setStep] = useState(0);
  const [createdOrder, setCreatedOrder] = useState<{ id: string; orderNo: string }>();
  const selectedPlanId = Form.useWatch("planId", form);
  const selectedGroupCode = Form.useWatch("vehicleGroupCode", form);

  const plans = useQuery({ queryKey: ["pricing"], queryFn: api.pricing });
  const plan = useQuery({ queryKey: ["pricing-plan", selectedPlanId], queryFn: () => api.pricingPlan(selectedPlanId), enabled: Boolean(selectedPlanId) });
  const locations = useQuery({ queryKey: ["locations", "order-create"], queryFn: () => api.locations({ page: 1, pageSize: 200 }) });
  const services = useQuery({ queryKey: ["value-added-services"], queryFn: api.valueAddedServices });
  const marketing = useQuery({ queryKey: ["marketing-plans"], queryFn: api.marketingPlans });
  const members = useQuery({ queryKey: ["members", "order-create"], queryFn: () => api.members({ page: 1, pageSize: 100 }) });
  const corporates = useQuery({ queryKey: ["corporates", "order-create"], queryFn: () => api.corporates({ page: 1, pageSize: 100 }) });

  const availability = useMutation({ mutationFn: api.availability });
  const quote = useMutation({ mutationFn: api.quote });
  const createOrder = useMutation({ mutationFn: api.createOrder });

  const storeOptions = useMemo(() => {
    const seen = new Set<string>();
    return (locations.data?.rows ?? []).flatMap((item) => {
      const code = item.storeCode ?? item.stationCode;
      if (!code || seen.has(code)) return [];
      seen.add(code);
      return [{ value: code, label: `${item.parentStoreName || item.name} · ${code}` }];
    });
  }, [locations.data]);

  const availabilityRows = availability.data?.groups ?? [];
  const selectedGroup = availabilityRows.find((item) => item.vehicleGroupCode === selectedGroupCode);

  async function checkAvailability() {
    try {
      const values = await form.validateFields(["planId", "storeRange", "rentalRange"]);
      const [pickupStoreCode, returnStoreCode] = values.storeRange;
      const [pickupAt, returnAt] = values.rentalRange;
      const result = await availability.mutateAsync({
        mode: storeRentalMode,
        pickupStoreCode,
        returnStoreCode,
        pickupAt: pickupAt.toISOString(),
        returnAt: returnAt.toISOString(),
        vehicleGroupCodes: plan.data?.ruleLines.map((item) => item.vehicleGroupCode)
      });
      const recommended = result.groups.find((item) => item.availableCount > 0);
      if (recommended) form.setFieldValue("vehicleGroupCode", recommended.vehicleGroupCode);
      setStep(1);
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) return;
      message.error("可用性检查失败，请核对时间、网点和后端服务");
    }
  }

  async function createQuote() {
    if (!selectedGroupCode) {
      message.warning("请选择一个有可用库存的标的分组");
      return;
    }
    try {
      const values = await form.validateFields();
      const [pickupStoreCode, returnStoreCode] = values.storeRange;
      const [pickupAt, returnAt] = values.rentalRange;
      const member = members.data?.rows.find((item) => item.id === values.memberId);
      const payload: PricingQuoteRequest = {
        planId: values.planId,
        vehicleGroupCode: values.vehicleGroupCode,
        pickupStoreCode,
        returnStoreCode,
        pickupAt: pickupAt.toISOString(),
        returnAt: returnAt.toISOString(),
        billingMode: values.billingMode,
        serviceCodes: values.serviceCodes,
        corporateId: values.corporateId,
        customerType: values.billingMode === billingModes.monthly ? "enterprise" : "personal",
        membershipLevel: member?.levelName,
        marketingPlanId: values.marketingPlanId
      };
      await quote.mutateAsync(payload);
      setStep(2);
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) return;
      message.error("计价失败，请检查定价计划与标的分组是否匹配");
    }
  }

  async function submitOrder() {
    const values = form.getFieldsValue(true);
    if (!quote.data) return;
    const payload: CreateStoreRentalOrderRequest = {
      quoteNo: quote.data.quoteNo,
      memberId: values.memberId,
      corporateId: values.corporateId,
      customerName: values.customerName,
      customerPhone: values.customerPhone,
      corporateShortName: values.corporateShortName,
      billingMode: values.billingMode,
      collectionMode: values.collectionMode
    };
    try {
      const result = await createOrder.mutateAsync(payload);
      setCreatedOrder({ id: result.id, orderNo: result.orderNo });
      setStep(3);
      message.success(result.message || "订单创建成功");
    } catch {
      message.error("订单创建失败，报价可能已失效或客户信息不完整");
    }
  }

  if (step === 3 && createdOrder) {
    return (
      <Card className="data-panel">
        <Result
          status="success"
          icon={<CheckCircleOutlined />}
          title={`订单 ${createdOrder.orderNo} 已创建`}
          subTitle="订单已进入现有单标的履约流程；多数量、多行标的仍需后端领域模型升级后开放。"
          extra={[
            <Button type="primary" key="detail" onClick={() => navigate(`/rental/orders/${createdOrder.id}`)}>查看订单</Button>,
            <Button key="again" onClick={() => { form.resetFields(); availability.reset(); quote.reset(); setCreatedOrder(undefined); setStep(0); }}>继续创建</Button>
          ]}
        />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="新建租赁订单"
        description="先检查网点和标的库存，再生成可追溯报价，确认客户信息后创建订单。"
        extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/rental/orders")}>返回订单列表</Button>}
      />
      <Card className="data-panel order-create-shell">
        <Steps current={step} items={[{ title: "租赁需求" }, { title: "客户与方案" }, { title: "报价确认" }]} />
        <Divider />
        <Form<OrderFormValues>
          form={form}
          layout="vertical"
          initialValues={{
            rentalRange: [dayjs().add(1, "day").hour(9).minute(0), dayjs().add(4, "day").hour(9).minute(0)],
            billingMode: billingModes.customerPay,
            collectionMode: "deposit"
          }}
        >
          <section hidden={step !== 0}>
            <Row gutter={16}>
              <Col xs={24} lg={8}>
                <Form.Item name="planId" label="定价计划" rules={[{ required: true, message: "请选择定价计划" }]}>
                  <Select loading={plans.isLoading} placeholder="选择生效中的定价计划" options={(plans.data ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.version}` }))} />
                </Form.Item>
              </Col>
              <Col xs={24} lg={8}>
                <Form.Item name="storeRange" label="领取 / 归还网点" rules={[{ validator: async (_, value?: string[]) => value?.length === 2 ? Promise.resolve() : Promise.reject(new Error("请依次选择领取和归还网点")) }]}>
                  <Select mode="multiple" maxCount={2} loading={locations.isLoading} placeholder="依次选择领取、归还网点" options={storeOptions} />
                </Form.Item>
              </Col>
              <Col xs={24} lg={8}>
                <Form.Item name="rentalRange" label="租赁时段" rules={[{ required: true, message: "请选择租赁时段" }]}>
                  <DatePicker.RangePicker showTime style={{ width: "100%" }} disabledDate={(date) => date.isBefore(dayjs().startOf("day"))} />
                </Form.Item>
              </Col>
            </Row>
            <Typography.Paragraph type="secondary">当前后端仍按车辆分组校验库存。未来品类内核会把这里的分组替换为露营套装、摄影套装、工程设备型号或载具级别。</Typography.Paragraph>
            <div className="form-actions"><Button type="primary" loading={availability.isPending} onClick={checkAvailability}>检查可用标的</Button></div>
          </section>

          <section hidden={step !== 1}>
            <Typography.Title level={4}>选择可用标的</Typography.Title>
            <Form.Item name="vehicleGroupCode" hidden rules={[{ required: true, message: "请选择可用标的分组" }]}><Input /></Form.Item>
            <Table<StoreRentalAvailabilityGroup>
              rowKey="vehicleGroupCode"
              pagination={false}
              dataSource={availabilityRows}
              onRow={(record) => ({ onClick: () => record.availableCount > 0 && form.setFieldValue("vehicleGroupCode", record.vehicleGroupCode), style: { cursor: record.availableCount > 0 ? "pointer" : "not-allowed" } })}
              columns={[
                { title: "选择", width: 72, render: (_, record) => <Radio checked={selectedGroupCode === record.vehicleGroupCode} disabled={record.availableCount < 1} /> },
                { title: "标的分组", dataIndex: "vehicleGroupName" },
                { title: "可用 / 总量", render: (_, record) => <b>{record.availableCount} / {record.totalCount}</b> },
                { title: "状态", render: (_, record) => record.availableCount > 0 ? <Tag color="success">可预订</Tag> : <Tag>无库存</Tag> },
                { title: "建议履约点", render: (_, record) => record.recommendedStationNames.join("、") || "—" },
                { title: "提示", render: (_, record) => record.warnings.join("；") || "—" }
              ]}
            />
            <Divider />
            <Row gutter={16}>
              <Col xs={24} lg={8}>
                <Form.Item name="customerName" label="客户姓名" rules={[{ required: true, message: "请输入客户姓名" }]}><Input /></Form.Item>
              </Col>
              <Col xs={24} lg={8}>
                <Form.Item name="customerPhone" label="联系电话" rules={[{ required: true, message: "请输入联系电话" }]}><Input /></Form.Item>
              </Col>
              <Col xs={24} lg={8}>
                <Form.Item name="memberId" label="关联会员"><Select allowClear showSearch optionFilterProp="label" options={(members.data?.rows ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.phoneMasked} · ${item.levelName}` }))} /></Form.Item>
              </Col>
              <Col xs={24} lg={8}>
                <Form.Item name="billingMode" label="计费主体" rules={[{ required: true }]}><Select options={[{ value: billingModes.customerPay, label: "个人现付" }, { value: billingModes.monthly, label: "企业月结" }]} /></Form.Item>
              </Col>
              <Col xs={24} lg={8}>
                <Form.Item noStyle shouldUpdate={(before, after) => before.billingMode !== after.billingMode}>
                  {({ getFieldValue }) => getFieldValue("billingMode") === billingModes.monthly ? (
                    <Form.Item name="corporateId" label="企业客户" rules={[{ required: true, message: "请选择企业客户" }]}>
                      <Select showSearch optionFilterProp="label" onChange={(id) => form.setFieldValue("corporateShortName", corporates.data?.rows.find((item) => item.id === id)?.shortName)} options={(corporates.data?.rows ?? []).map((item) => ({ value: item.id, label: `${item.shortName} · 额度 ${money(item.creditLimitAmount)}` }))} />
                    </Form.Item>
                  ) : null}
                </Form.Item>
              </Col>
              <Col xs={24} lg={8}>
                <Form.Item name="collectionMode" label="收款方式" rules={[{ required: true }]}><Select options={[{ value: "deposit", label: "押金 / 预授权" }, { value: "pending", label: "待支付占位" }, { value: "monthly", label: "企业月结" }]} /></Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item name="serviceCodes" label="增值服务"><Select mode="multiple" allowClear options={(services.data ?? []).filter((item) => item.status === "enabled").map((item) => ({ value: item.code, label: `${item.name} · ${money(item.price)}${item.unit}` }))} /></Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item name="marketingPlanId" label="营销方案"><Select allowClear options={(marketing.data ?? []).filter((item) => item.status === "effective").map((item) => ({ value: item.id, label: `${item.displayName} · ${item.version}` }))} /></Form.Item>
              </Col>
            </Row>
            {selectedGroup?.warnings.length ? <Typography.Paragraph type="warning">{selectedGroup.warnings.join("；")}</Typography.Paragraph> : null}
            <div className="form-actions"><Space><Button onClick={() => setStep(0)}>上一步</Button><Button type="primary" loading={quote.isPending} onClick={createQuote}>生成报价</Button></Space></div>
          </section>

          <section hidden={step !== 2}>
            {quote.data && (
              <Row gutter={[20, 20]}>
                <Col xs={24} xl={15}>
                  <Card title="费用明细" size="small">
                    <Table rowKey="code" pagination={false} dataSource={quote.data.feeItems} columns={[{ title: "费用项", dataIndex: "name" }, { title: "来源", dataIndex: "source", render: (value) => value || "规则引擎" }, { title: "金额", dataIndex: "amount", align: "right", render: money }]} />
                  </Card>
                </Col>
                <Col xs={24} xl={9}>
                  <Card title="报价摘要" size="small">
                    <Descriptions column={1} items={[
                      { key: "quote", label: "报价单号", children: quote.data.quoteNo },
                      { key: "days", label: "计费天数", children: `${quote.data.billableDays} 天` },
                      { key: "rental", label: "租赁金额", children: money(quote.data.rentalAmount) },
                      { key: "service", label: "增值服务", children: money(quote.data.serviceFeeAmount) },
                      { key: "discount", label: "优惠", children: `-${money(quote.data.discountAmount)}` },
                      { key: "deposit", label: "押金 / 预授权", children: money(quote.data.depositAmount) },
                      { key: "payable", label: "应付金额", children: <Typography.Text strong style={{ fontSize: 20 }}>{money(quote.data.payableAmount)}</Typography.Text> }
                    ]} />
                  </Card>
                  {quote.data.warnings.length > 0 && <Card size="small" title="风险提示" style={{ marginTop: 16 }}><Space direction="vertical">{quote.data.warnings.map((item) => <Tag color="warning" key={item}>{item}</Tag>)}</Space></Card>}
                </Col>
              </Row>
            )}
            <div className="form-actions"><Space><Button onClick={() => setStep(1)}>返回修改</Button><Button type="primary" loading={createOrder.isPending} onClick={submitOrder}>确认创建订单</Button></Space></div>
          </section>
        </Form>
      </Card>
    </>
  );
}
