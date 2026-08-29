import { EditOutlined, HistoryOutlined, PlusOutlined } from "@ant-design/icons";
import { RENTAL_PRICING_UNIT_LABELS } from "@store-rental/shared";
import type { CreateRentalPriceAdjustmentRequest, RentalDiscountPlan, RentalPriceAdjustmentPreviewRow, RentalPricingPlanV1, RentalValueAddedService, SaveRentalDiscountPlanRequest, SaveRentalPricingPlanRequest, SaveRentalValueAddedServiceRequest } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

export type RentalCommercialSection = "pricing" | "discounts" | "services";

const unitLabels = RENTAL_PRICING_UNIT_LABELS;
const money = (value: number | undefined) => `¥${Number(value ?? 0).toFixed(2)}`;
const serviceTypeLabels: Record<string, string> = {
  insurance: "保险",
  damage_waiver: "损坏免赔",
  delivery: "配送/运输",
  consumable: "耗材/配件",
  operator: "操作员",
  support: "技术支持",
  other: "其他",
};

export function RentalCommercialPage({ section }: { section: RentalCommercialSection }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pricingEditor, setPricingEditor] = useState<RentalPricingPlanV1 | null>();
  const [adjustmentPlan, setAdjustmentPlan] = useState<RentalPricingPlanV1 | null>();
  const [adjustmentPreview, setAdjustmentPreview] = useState<RentalPriceAdjustmentPreviewRow[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionSequence, setVersionSequence] = useState<number>();
  const [restoreSequence, setRestoreSequence] = useState<number>();
  const [restoreReason, setRestoreReason] = useState("");
  const [cancelAdjustmentId, setCancelAdjustmentId] = useState<string>();
  const [cancelReason, setCancelReason] = useState("");
  const [discountEditor, setDiscountEditor] = useState<RentalDiscountPlan | null>();
  const [serviceEditor, setServiceEditor] = useState<RentalValueAddedService | null>();
  const [pricingForm] = Form.useForm<SaveRentalPricingPlanRequest>();
  const [adjustmentForm] = Form.useForm<CreateRentalPriceAdjustmentRequest & { scheduledAtValue?: dayjs.Dayjs }>();
  const [discountForm] = Form.useForm<SaveRentalDiscountPlanRequest>();
  const [serviceForm] = Form.useForm<SaveRentalValueAddedServiceRequest>();
  const profile = useQuery({
    queryKey: ["rental-core", "profile"],
    queryFn: rentalCoreApi.profile,
  });
  const settings = useQuery({
    queryKey: ["rental-core", "business-settings"],
    queryFn: rentalCoreApi.businessSettings,
  });
  const groups = useQuery({
    queryKey: ["rental-core", "groups"],
    queryFn: rentalCoreApi.itemGroups,
  });
  const pricing = useQuery({
    queryKey: ["rental-core", "pricing-plans"],
    queryFn: rentalCoreApi.pricingPlans,
  });
  const discounts = useQuery({
    queryKey: ["rental-core", "discount-plans"],
    queryFn: rentalCoreApi.discountPlans,
  });
  const services = useQuery({
    queryKey: ["rental-core", "value-added-services"],
    queryFn: rentalCoreApi.valueAddedServices,
  });
  const versions = useQuery({
    queryKey: ["rental-core", "price-versions"],
    queryFn: () => rentalCoreApi.priceVersions(1, 100),
    enabled: versionsOpen,
  });
  const versionDetail = useQuery({
    queryKey: ["rental-core", "price-version", versionSequence],
    queryFn: () => rentalCoreApi.priceVersion(versionSequence!),
    enabled: versionSequence !== undefined,
  });
  const previousVersion = useQuery({
    queryKey: ["rental-core", "price-version", versionSequence ? versionSequence - 1 : undefined],
    queryFn: () => rentalCoreApi.priceVersion(versionSequence! - 1),
    enabled: versionSequence !== undefined && versionSequence > 1,
  });
  const adjustments = useQuery({
    queryKey: ["rental-core", "price-adjustments", adjustmentPlan?.id],
    queryFn: () => rentalCoreApi.priceAdjustments(adjustmentPlan!.id),
    enabled: Boolean(adjustmentPlan?.id),
  });

  const savePricing = useMutation({
    mutationFn: rentalCoreApi.savePricingPlan,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "pricing-plans"],
      });
      setPricingEditor(null);
      pricingForm.resetFields();
      message.success("基础定价新版本已保存");
    },
    onError: () => message.error("保存失败，请检查商品、计价单位和价格参数"),
  });
  const createAdjustment = useMutation({
    mutationFn: (values: CreateRentalPriceAdjustmentRequest & { scheduledAtValue?: dayjs.Dayjs }) => {
      const { scheduledAtValue, ...request } = values;
      return rentalCoreApi.createPriceAdjustment(adjustmentPlan!.id, {
        ...request,
        scheduledAt: scheduledAtValue?.toISOString(),
      });
    },
    onSuccess: async (result) => {
      setAdjustmentPreview(result.preview);
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "price-adjustments", adjustmentPlan?.id] });
      message.success("调价计划草稿已创建，请核对最终价后确认");
    },
    onError: () => message.error("创建调价计划失败，请检查时间线、范围与调价值"),
  });
  const confirmAdjustment = useMutation({
    mutationFn: (id: string) => rentalCoreApi.confirmPriceAdjustment(adjustmentPlan!.id, id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-adjustments", adjustmentPlan?.id] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "pricing-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-versions"] }),
      ]);
      message.success("调价计划已确认");
    },
    onError: () => message.error("确认失败：请检查是否存在待生效调价或未来价格版本"),
  });
  const cancelAdjustment = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rentalCoreApi.cancelPriceAdjustment(adjustmentPlan!.id, id, { reason }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "price-adjustments", adjustmentPlan?.id] });
      setCancelAdjustmentId(undefined);
      setCancelReason("");
      message.success("调价计划已取消");
    },
  });
  const restoreVersion = useMutation({
    mutationFn: ({ sequence, reason }: { sequence: number; reason: string }) => rentalCoreApi.restorePriceVersion(sequence, { reason }),
    onSuccess: async (result) => {
      setRestoreSequence(undefined);
      setRestoreReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-core", "price-versions"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-core", "pricing-plans"] }),
      ]);
      message.success(`已基于 ${result.restoredFromVersion} 生成新版本 ${result.version}`);
    },
    onError: () => message.error("恢复失败：请检查未来版本、待生效调价或价格行结构变化"),
  });
  const saveDiscount = useMutation({
    mutationFn: rentalCoreApi.saveDiscountPlan,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "discount-plans"],
      });
      setDiscountEditor(null);
      discountForm.resetFields();
      message.success("优惠方案新版本已保存");
    },
    onError: () => message.error("保存失败，请检查优惠范围、有效期和叠加规则"),
  });
  const saveService = useMutation({
    mutationFn: rentalCoreApi.saveValueAddedService,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["rental-core", "value-added-services"],
      });
      setServiceEditor(null);
      serviceForm.resetFields();
      message.success("增值服务及条款版本已保存");
    },
    onError: () => message.error("保存失败，请检查服务条款、价格和适用商品"),
  });

  function editPricing(record?: RentalPricingPlanV1) {
    const rates: SaveRentalPricingPlanRequest["rates"] = record
      ? record.rates.map(({ id: _id, itemGroupCode: _code, itemGroupName: _name, ...rate }) => rate)
      : (groups.data ?? []).map((group) => ({
          itemGroupId: group.id,
          unit: settings.data?.pricing.defaultUnit ?? "calendar_day",
          baseAmount: 0,
          weekendMultiplier: 1.1,
          holidayMultiplier: 1.25,
          depositAmount: 0,
          minimumUnits: 1,
        }));
    pricingForm.setFieldsValue(
      record
        ? {
            id: record.id,
            code: record.code,
            name: record.name,
            status: record.status,
            effectiveFrom: record.effectiveFrom,
            effectiveTo: record.effectiveTo,
            changeReason: "调整基础价格",
            rates,
          }
        : {
            code: "",
            name: "",
            status: "draft",
            effectiveFrom: new Date().toISOString(),
            changeReason: "新建定价计划",
            rates,
          },
    );
    setPricingEditor(record ?? ({} as RentalPricingPlanV1));
  }

  function openAdjustment(record: RentalPricingPlanV1) {
    setAdjustmentPreview([]);
    adjustmentForm.setFieldsValue({
      code: `ADJ-${dayjs().format("YYYYMMDD-HHmm")}`,
      name: `${record.name} 调价`,
      changeReason: "经营价格调整",
      changes: [{ itemGroupId: record.rates[0]?.itemGroupId, unit: record.rates[0]?.unit, op: "set_base", value: record.rates[0]?.baseAmount ?? 0 }],
    });
    setAdjustmentPlan(record);
  }

  function editDiscount(record?: RentalDiscountPlan) {
    discountForm.setFieldsValue(
      record
        ? { ...record, changeReason: "调整优惠方案" }
        : {
            code: "",
            name: "",
            status: "draft",
            discountType: "percentage",
            discountValue: 5,
            minimumSpend: 0,
            customerScope: "all",
            applicableItemGroupIds: [],
            applicableDayTypes: [],
            priority: 100,
            stackableWithCoupon: true,
            effectiveFrom: new Date().toISOString(),
            changeReason: "新建优惠方案",
          },
    );
    setDiscountEditor(record ?? ({} as RentalDiscountPlan));
  }

  function editService(record?: RentalValueAddedService) {
    serviceForm.setFieldsValue(
      record ?? {
        code: "",
        name: "",
        serviceType: "other",
        billingUnit: "per_order",
        price: 0,
        maximumQuantity: 1,
        termsVersion: "1.0",
        terms: "",
        applicableItemGroupIds: [],
        status: "enabled",
      },
    );
    setServiceEditor(record ?? ({} as RentalValueAddedService));
  }

  const sectionTitle = section === "pricing" ? "基础定价" : section === "discounts" ? "优惠方案" : "增值服务";
  const sectionDescription = section === "pricing" ? "按当前经营品类、商品型号和计价单位维护服务端基础价格。" : section === "discounts" ? "在基础价格之上配置自动优惠、客户范围、日期范围与优惠券叠加规则。" : "维护配送、保险、损坏免赔等可选服务，并对保障条款进行版本化。";

  return (
    <>
      <PageHeader
        title={sectionTitle}
        description={sectionDescription}
        extra={
          <Space>
            {section === "pricing" && <Button icon={<HistoryOutlined />} onClick={() => setVersionsOpen(true)}>价格版本</Button>}
            <Button type="primary" icon={<PlusOutlined />} onClick={() => (section === "pricing" ? editPricing() : section === "discounts" ? editDiscount() : editService())}>
              新增{sectionTitle}
            </Button>
          </Space>
        }
      />
      <div className="context-note">
        <span>
          {profile.data?.terminology.itemGroupLabel ?? "商品"} · {profile.data?.categoryCode ?? "-"}
        </span>
        <span>订单只能引用服务端报价快照，前端不能直接决定成交单价。</span>
      </div>
      <div className="commercial-switcher">
        <Button type={section === "pricing" ? "primary" : "text"} onClick={() => navigate("/rental/pricing")}>
          基础定价
        </Button>
        <Button type={section === "discounts" ? "primary" : "text"} onClick={() => navigate("/rental/discounts")}>
          优惠方案
        </Button>
        <Button type={section === "services" ? "primary" : "text"} onClick={() => navigate("/rental/services")}>
          增值服务
        </Button>
      </div>

      {section === "pricing" && (
        <Card
          className="data-panel"
          title={
            <Space>
              <span>定价计划</span>
              <Tag>{pricing.data?.length ?? 0}</Tag>
            </Space>
          }
        >
          <QueryState loading={pricing.isLoading} error={pricing.error}>
            <Table<RentalPricingPlanV1>
              rowKey="id"
              dataSource={pricing.data ?? []}
              columns={[
                {
                  title: "计划",
                  render: (_, row) => (
                    <>
                      <b>{row.name}</b>
                      <br />
                      <span className="muted">
                        {row.code} · v{row.version}
                      </span>
                    </>
                  ),
                },
                {
                  title: "价格条目",
                  render: (_, row) => `${row.rates.length} 条`,
                },
                {
                  title: "计价单位",
                  render: (_, row) => [...new Set(row.rates.map((rate) => unitLabels[rate.unit] ?? rate.unit))].join("、"),
                },
                { title: "生效时间", dataIndex: "effectiveFrom" },
                {
                  title: "状态",
                  dataIndex: "status",
                  render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{value}</Tag>,
                },
                {
                  title: "操作",
                  render: (_, row) => (
                    <Space size={0}>
                      <Button type="link" icon={<EditOutlined />} onClick={() => editPricing(row)}>
                        {row.status === "enabled" ? "编辑资料" : "编辑"}
                      </Button>
                      {row.status === "enabled" && <Button type="link" onClick={() => openAdjustment(row)}>调价计划</Button>}
                    </Space>
                  ),
                },
              ]}
            />
          </QueryState>
        </Card>
      )}
      {section === "discounts" && (
        <Card
          className="data-panel"
          title={
            <Space>
              <span>自动优惠方案</span>
              <Tag>{discounts.data?.length ?? 0}</Tag>
            </Space>
          }
        >
          <QueryState loading={discounts.isLoading} error={discounts.error}>
            <Table<RentalDiscountPlan>
              rowKey="id"
              dataSource={discounts.data ?? []}
              columns={[
                {
                  title: "方案",
                  render: (_, row) => (
                    <>
                      <b>{row.name}</b>
                      <br />
                      <span className="muted">
                        {row.code} · v{row.version}
                      </span>
                    </>
                  ),
                },
                {
                  title: "优惠",
                  render: (_, row) => (row.discountType === "percentage" ? `${row.discountValue}%` : money(row.discountValue)),
                },
                { title: "门槛", dataIndex: "minimumSpend", render: money },
                { title: "客户范围", dataIndex: "customerScope" },
                { title: "优先级", dataIndex: "priority" },
                {
                  title: "与券叠加",
                  dataIndex: "stackableWithCoupon",
                  render: (value) => (value ? "允许" : "不允许"),
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{value}</Tag>,
                },
                {
                  title: "操作",
                  render: (_, row) => (
                    <Button type="link" icon={<EditOutlined />} onClick={() => editDiscount(row)}>
                      编辑
                    </Button>
                  ),
                },
              ]}
            />
          </QueryState>
        </Card>
      )}
      {section === "services" && (
        <Card
          className="data-panel"
          title={
            <Space>
              <span>增值服务及保障</span>
              <Tag>{services.data?.length ?? 0}</Tag>
            </Space>
          }
        >
          <QueryState loading={services.isLoading} error={services.error}>
            <Table<RentalValueAddedService>
              rowKey="id"
              dataSource={services.data ?? []}
              columns={[
                {
                  title: "服务",
                  render: (_, row) => (
                    <>
                      <b>{row.name}</b>
                      <br />
                      <span className="muted">
                        {row.code} · v{row.version}
                      </span>
                    </>
                  ),
                },
                {
                  title: "类型",
                  dataIndex: "serviceType",
                  render: (value) => <Tag>{serviceTypeLabels[value] ?? value}</Tag>,
                },
                {
                  title: "价格",
                  render: (_, row) => `${money(row.price)} / ${row.billingUnit}`,
                },
                {
                  title: "保障额度",
                  dataIndex: "coverageLimit",
                  render: (value) => (value === undefined ? "-" : money(value)),
                },
                {
                  title: "免赔额",
                  dataIndex: "deductible",
                  render: (value) => (value === undefined ? "-" : money(value)),
                },
                { title: "条款版本", dataIndex: "termsVersion" },
                {
                  title: "状态",
                  dataIndex: "status",
                  render: (value) => <Tag color={value === "enabled" ? "success" : "default"}>{value}</Tag>,
                },
                {
                  title: "操作",
                  render: (_, row) => (
                    <Button type="link" icon={<EditOutlined />} onClick={() => editService(row)}>
                      编辑
                    </Button>
                  ),
                },
              ]}
            />
          </QueryState>
        </Card>
      )}

      <Drawer
        title={pricingForm.getFieldValue("id") ? "编辑基础定价" : "新增基础定价"}
        width={820}
        open={Boolean(pricingEditor)}
        destroyOnHidden
        onClose={() => setPricingEditor(null)}
        extra={
          <Button type="primary" loading={savePricing.isPending} onClick={() => pricingForm.submit()}>
            保存新版本
          </Button>
        }
      >
        <Form<SaveRentalPricingPlanRequest> form={pricingForm} layout="vertical" onFinish={(values) => savePricing.mutate(values)}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="code" label="计划编码" rules={[{ required: true }]}>
                <Input disabled={Boolean(pricingForm.getFieldValue("id"))} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="name" label="计划名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="status" label="状态" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: "draft", label: "草稿" },
                    { value: "enabled", label: "启用" },
                    { value: "disabled", label: "停用" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="effectiveFrom" label="生效时间" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="effectiveTo" label="失效时间">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.List name="fulfillmentFees">
            {(feeFields, { add, remove }) => (
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                {feeFields.map((fee) => (
                  <Row gutter={10} key={fee.key}>
                    <Col span={8}>
                      <Form.Item name={[fee.name, "mode"]} label="履约方式" rules={[{ required: true }]}>
                        <Select options={(settings.data?.fulfillment.enabledModes ?? []).map((mode) => ({ value: mode, label: mode }))} />
                      </Form.Item>
                    </Col>
                    <Col span={5}>
                      <Form.Item name={[fee.name, "amount"]} label="履约费" rules={[{ required: true }]}>
                        <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name={[fee.name, "crossLocationAmount"]} label="异地归还附加费" tooltip="归还地点与取件地点不同时追加；0 表示异地免费">
                        <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Button danger onClick={() => remove(fee.name)}>
                        移除
                      </Button>
                    </Col>
                  </Row>
                ))}
                <Button
                  onClick={() =>
                    add({
                      mode: settings.data?.fulfillment.enabledModes?.[0],
                      amount: 0,
                    })
                  }
                >
                  新增履约费
                </Button>
              </Space>
            )}
          </Form.List>
          <Form.List name="rates">
            {(fields) => (
              <Space direction="vertical" style={{ width: "100%" }}>
                {fields.map((field) => (
                  <Card size="small" key={field.key}>
                    <Row gutter={10}>
                      <Col span={7}>
                        <Form.Item name={[field.name, "itemGroupId"]} label="商品" rules={[{ required: true }]}>
                          <Select
                            options={(groups.data ?? []).map((group) => ({
                              value: group.id,
                              label: `${group.code} · ${group.name}`,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item name={[field.name, "unit"]} label="计价单位" rules={[{ required: true }]}>
                          <Select
                            options={(settings.data?.pricing.enabledUnits ?? []).map((unit) => ({
                              value: unit,
                              label: unitLabels[unit] ?? unit,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item name={[field.name, "baseAmount"]} label="基础价">
                          <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item name={[field.name, "depositAmount"]} label="每件固定押金" tooltip="仅押金规则为按商品固定金额时生效">
                          <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item name={[field.name, "preAuthAmount"]} label="每件预授权额度" tooltip="与押金独立；仅预授权规则为按商品固定金额时生效">
                          <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item name={[field.name, "minimumUnits"]} label="最低单位">
                          <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={[field.name, "weekendMultiplier"]} label="周末系数">
                          <InputNumber min={0} step={0.05} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name={[field.name, "holidayMultiplier"]} label="节假日系数">
                          <InputNumber min={0} step={0.05} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={10}>
                      <Col span={5}>
                        <Form.Item name={[field.name, "maxAmount"]} label="封顶价" tooltip="单件、单次租期的租金上限；留空表示不封顶，填 0 表示免租">
                          <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item name={[field.name, "depositMultiple"]} label="租金倍数押金" tooltip="仅当规则的押金模式为「租金倍数」时生效：该行押金 = 该行租金 × 本值">
                          <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item name={[field.name, "preAuthMultiple"]} label="租金倍数预授权" tooltip="与押金倍数独立；仅预授权规则为租金倍数时生效">
                          <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item name={[field.name, "hourGranularityMinutes"]} label="小时粒度(分)" tooltip="仅小时计价使用；例如 30 表示不足半小时按半小时计。留空按 60">
                          <InputNumber min={1} max={1440} precision={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item name={[field.name, "includedUsage"]} label="包含使用量" tooltip="仅使用量计价使用">
                          <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item name={[field.name, "excessUsageAmount"]} label="超额单价" tooltip="仅使用量计价使用；留空按基础价">
                          <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.List name={[field.name, "tiers"]}>
                      {(tierFields, { add, remove }) => (
                        <Space direction="vertical" size={4} style={{ width: "100%" }}>
                          {tierFields.map((tier) => (
                            <Row gutter={10} key={tier.key}>
                              <Col span={7}>
                                <Form.Item name={[tier.name, "minUnits"]} label="阶梯起始单位数" rules={[{ required: true }]}>
                                  <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                                </Form.Item>
                              </Col>
                              <Col span={7}>
                                <Form.Item name={[tier.name, "unitAmount"]} label="该档单价" rules={[{ required: true }]}>
                                  <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                                </Form.Item>
                              </Col>
                              <Col span={4}>
                                <Button danger onClick={() => remove(tier.name)}>
                                  移除档位
                                </Button>
                              </Col>
                            </Row>
                          ))}
                          <Button onClick={() => add({ minUnits: 1, unitAmount: 0 })}>新增阶梯档位</Button>
                        </Space>
                      )}
                    </Form.List>
                    <Typography.Title level={5}>日期类型价格系数</Typography.Title>
                    <Row gutter={10}>
                      {[
                        ["workday", "工作日"], ["weekend", "周末"], ["statutory_holiday", "法定节假日"],
                        ["makeup_workday", "调休工作日"], ["tenant_special", "空间特殊日"],
                      ].map(([key, label]) => (
                        <Col span={4} key={key}>
                          <Form.Item name={[field.name, "dayTypePrices", key]} label={label}>
                            <InputNumber min={0} step={0.05} style={{ width: "100%" }} />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                    <Form.List name={[field.name, "periodicWindows"]}>
                      {(windowFields, { add, remove }) => (
                        <Space direction="vertical" size={4} style={{ width: "100%" }}>
                          <Typography.Text strong>周期性计价时段</Typography.Text>
                          {windowFields.map((windowField) => (
                            <Row gutter={8} key={windowField.key}>
                              <Col span={4}><Form.Item name={[windowField.name, "fromWeekday"]} label="起始星期" rules={[{ required: true }]}><Select options={[0,1,2,3,4,5,6].map((value) => ({ value, label: `周${"日一二三四五六"[value]}` }))} /></Form.Item></Col>
                              <Col span={4}><Form.Item name={[windowField.name, "fromTime"]} label="起始时刻" rules={[{ required: true }]}><Input placeholder="12:00" /></Form.Item></Col>
                              <Col span={4}><Form.Item name={[windowField.name, "toWeekday"]} label="结束星期" rules={[{ required: true }]}><Select options={[0,1,2,3,4,5,6].map((value) => ({ value, label: `周${"日一二三四五六"[value]}` }))} /></Form.Item></Col>
                              <Col span={4}><Form.Item name={[windowField.name, "toTime"]} label="结束时刻" rules={[{ required: true }]}><Input placeholder="00:00" /></Form.Item></Col>
                              <Col span={4}><Form.Item name={[windowField.name, "multiplier"]} label="价格系数" rules={[{ required: true }]}><InputNumber min={0} step={0.05} style={{ width: "100%" }} /></Form.Item></Col>
                              <Col span={4}><Button danger onClick={() => remove(windowField.name)}>移除</Button></Col>
                            </Row>
                          ))}
                          <Button onClick={() => add({ fromWeekday: 5, fromTime: "12:00", toWeekday: 1, toTime: "00:00", multiplier: 1.1 })}>新增周期时段</Button>
                        </Space>
                      )}
                    </Form.List>
                    <Form.List name={[field.name, "datetimeOverrides"]}>
                      {(overrideFields, { add, remove }) => (
                        <Space direction="vertical" size={4} style={{ width: "100%", marginTop: 12 }}>
                          <Typography.Text strong>一次性日期时间价格</Typography.Text>
                          {overrideFields.map((overrideField) => (
                            <Row gutter={8} key={overrideField.key}>
                              <Col span={5}><Form.Item name={[overrideField.name, "id"]} label="引用标识" rules={[{ required: true }]}><Input placeholder="NATIONAL-DAY-2026" /></Form.Item></Col>
                              <Col span={6}><Form.Item name={[overrideField.name, "start"]} label="开始时点" rules={[{ required: true }]}><Input placeholder="2026-10-01T00:00:00+08:00" /></Form.Item></Col>
                              <Col span={6}><Form.Item name={[overrideField.name, "end"]} label="结束时点" rules={[{ required: true }]}><Input placeholder="2026-10-08T00:00:00+08:00" /></Form.Item></Col>
                              <Col span={3}><Form.Item name={[overrideField.name, "multiplier"]} label="系数" rules={[{ required: true }]}><InputNumber min={0} step={0.05} style={{ width: "100%" }} /></Form.Item></Col>
                              <Col span={4}><Button danger onClick={() => remove(overrideField.name)}>移除</Button></Col>
                            </Row>
                          ))}
                          <Button onClick={() => add({ id: "", start: "", end: "", multiplier: 1 })}>新增一次性价格</Button>
                        </Space>
                      )}
                    </Form.List>
                  </Card>
                ))}
              </Space>
            )}
          </Form.List>
          <Form.Item name="changeReason" label="变更原因" rules={[{ required: true }]} style={{ marginTop: 16 }}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title={`调价计划 · ${adjustmentPlan?.name ?? ""}`}
        size={900}
        open={Boolean(adjustmentPlan)}
        destroyOnHidden
        onClose={() => { setAdjustmentPlan(null); setAdjustmentPreview([]); adjustmentForm.resetFields(); }}
      >
        <Alert
          type="info"
          showIcon
          title="已启用价格只通过调价计划变更"
          description="草稿先保存差异并展示最终价；确认后立即生效或进入待生效。空间存在未来价格版本或其他待生效调价时会阻止确认。"
          style={{ marginBottom: 16 }}
        />
        <Form form={adjustmentForm} layout="vertical" onFinish={(values) => createAdjustment.mutate(values)}>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="code" label="计划编码" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={10}><Form.Item name="name" label="计划名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="scheduledAtValue" label="定时生效（留空立即）"><DatePicker showTime style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
          <Form.List name="changes">
            {(fields, { add, remove }) => (
              <Space orientation="vertical" style={{ width: "100%" }}>
                {fields.map((field) => (
                  <Row gutter={8} key={field.key}>
                    <Col span={7}><Form.Item name={[field.name, "itemGroupId"]} label="商品" rules={[{ required: true }]}><Select options={(adjustmentPlan?.rates ?? []).map((rate) => ({ value: rate.itemGroupId, label: `${rate.itemGroupCode} · ${rate.itemGroupName}` }))} /></Form.Item></Col>
                    <Col span={5}><Form.Item name={[field.name, "unit"]} label="计价单位" rules={[{ required: true }]}><Select options={(adjustmentPlan?.rates ?? []).map((rate) => ({ value: rate.unit, label: unitLabels[rate.unit] ?? rate.unit }))} /></Form.Item></Col>
                    <Col span={5}><Form.Item name={[field.name, "op"]} label="调整方式" rules={[{ required: true }]}><Select options={[{ value: "set_base", label: "设为指定价格" }, { value: "percent", label: "按百分比增减" }, { value: "fixed", label: "按固定金额增减" }]} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, "value"]} label="调整值" rules={[{ required: true }]}><InputNumber precision={2} style={{ width: "100%" }} /></Form.Item></Col>
                    <Col span={3}><Button danger onClick={() => remove(field.name)}>移除</Button></Col>
                  </Row>
                ))}
                <Button onClick={() => add({ op: "set_base", value: 0 })}>新增调价条目</Button>
              </Space>
            )}
          </Form.List>
          <Form.Item name="changeReason" label="调价原因" rules={[{ required: true }]} style={{ marginTop: 12 }}><Input.TextArea rows={2} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={createAdjustment.isPending}>创建草稿并预览</Button>
        </Form>
        {adjustmentPreview.length > 0 && (
          <Card title="本次最终价预览" size="small" style={{ marginTop: 16 }}>
            <Table rowKey={(row) => `${row.itemGroupId}:${row.unit}`} pagination={false} dataSource={adjustmentPreview} columns={[
              { title: "商品", dataIndex: "itemGroupCode" },
              { title: "计价单位", dataIndex: "unit", render: (value) => unitLabels[value as keyof typeof unitLabels] ?? value },
              { title: "调整前", dataIndex: "beforeBaseAmount", render: money },
              { title: "调整后", dataIndex: "afterBaseAmount", render: money },
            ]} />
          </Card>
        )}
        <Card title="调价计划记录" size="small" style={{ marginTop: 16 }}>
          <Table rowKey="id" loading={adjustments.isLoading} dataSource={adjustments.data ?? []} columns={[
            { title: "计划", render: (_, row) => <><b>{row.name}</b><br/><Typography.Text type="secondary">{row.code}</Typography.Text></> },
            { title: "生效时间", render: (_, row) => row.scheduledAt ?? "确认后立即" },
            { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
            { title: "原因", dataIndex: "changeReason" },
            { title: "操作", render: (_, row) => row.status === "draft" ? <Space size={0}><Popconfirm title="确认后将立即生效或进入待生效，是否继续？" onConfirm={() => confirmAdjustment.mutate(row.id)}><Button type="link">确认</Button></Popconfirm><Button type="link" danger onClick={() => setCancelAdjustmentId(row.id)}>取消</Button></Space> : row.status === "pending" ? <Button type="link" danger onClick={() => setCancelAdjustmentId(row.id)}>取消</Button> : <Typography.Text type="secondary">—</Typography.Text> },
          ]} />
        </Card>
      </Drawer>

      <Modal
        title="取消调价计划"
        open={Boolean(cancelAdjustmentId)}
        okText="确认取消"
        okButtonProps={{ danger: true, disabled: !cancelReason.trim(), loading: cancelAdjustment.isPending }}
        onCancel={() => { setCancelAdjustmentId(undefined); setCancelReason(""); }}
        onOk={() => cancelAdjustmentId && cancelAdjustment.mutate({ id: cancelAdjustmentId, reason: cancelReason.trim() })}
      >
        <Input.TextArea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="请填写取消原因" />
      </Modal>

      <Drawer title="空间价格版本" size={760} open={versionsOpen} destroyOnHidden onClose={() => setVersionsOpen(false)}>
        <Alert type="info" showIcon title="每一版都是该经营空间全部有效商品价格的完整不可变快照" style={{ marginBottom: 16 }} />
        <Table rowKey="id" loading={versions.isLoading} dataSource={versions.data?.rows ?? []} columns={[
          { title: "版本", dataIndex: "version" },
          { title: "生效时间", dataIndex: "effectiveFrom" },
          { title: "价格条目", dataIndex: "rateCount", render: (value) => `${value} 条` },
          { title: "变更原因", dataIndex: "changeReason" },
          { title: "创建人", dataIndex: "createdBy" },
          { title: "操作", render: (_, row) => <Space size={0}><Button type="link" onClick={() => setVersionSequence(row.sequence)}>查看 / 对比</Button><Button type="link" onClick={() => setRestoreSequence(row.sequence)}>恢复</Button></Space> },
        ]} />
      </Drawer>

      <Drawer title={`价格版本详情 · v${versionSequence ?? ""}`} size={820} open={versionSequence !== undefined} destroyOnHidden onClose={() => setVersionSequence(undefined)}>
        <Alert type="info" showIcon title={versionSequence && versionSequence > 1 ? `以下价格与 v${versionSequence - 1} 对比` : "首个价格版本"} style={{ marginBottom: 16 }} />
        <Table
          rowKey={(row) => `${row.itemGroupId}:${row.unit}`}
          loading={versionDetail.isLoading || previousVersion.isLoading}
          dataSource={versionDetail.data?.rates ?? []}
          columns={[
            { title: "商品", render: (_, row) => `${row.itemGroupCode} · ${row.itemGroupName}` },
            { title: "计价单位", dataIndex: "unit", render: (value) => unitLabels[value as keyof typeof unitLabels] ?? value },
            { title: "上一版基础价", render: (_, row) => money(previousVersion.data?.rates.find((item) => item.itemGroupId === row.itemGroupId && item.unit === row.unit)?.baseAmount) },
            { title: "本版基础价", dataIndex: "baseAmount", render: money },
            { title: "变化", render: (_, row) => {
              const before = previousVersion.data?.rates.find((item) => item.itemGroupId === row.itemGroupId && item.unit === row.unit)?.baseAmount;
              return before === undefined ? "新增" : before === row.baseAmount ? "未变" : `${row.baseAmount - before > 0 ? "+" : ""}${(row.baseAmount - before).toFixed(2)}`;
            } },
          ]}
        />
      </Drawer>

      <Modal
        title={`恢复价格版本 v${restoreSequence ?? ""}`}
        open={restoreSequence !== undefined}
        okText="生成恢复版本"
        okButtonProps={{ disabled: !restoreReason.trim(), loading: restoreVersion.isPending }}
        onCancel={() => { setRestoreSequence(undefined); setRestoreReason(""); }}
        onOk={() => restoreSequence !== undefined && restoreVersion.mutate({ sequence: restoreSequence, reason: restoreReason.trim() })}
      >
        <Alert type="warning" showIcon title="不会修改或删除历史版本，而是以旧快照追加一个新的当前版本。" style={{ marginBottom: 12 }} />
        <Input.TextArea rows={3} value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} placeholder="请填写恢复原因" />
      </Modal>

      <Drawer
        title={discountForm.getFieldValue("id") ? "编辑优惠方案" : "新增优惠方案"}
        width={680}
        open={Boolean(discountEditor)}
        destroyOnHidden
        onClose={() => setDiscountEditor(null)}
        extra={
          <Button type="primary" loading={saveDiscount.isPending} onClick={() => discountForm.submit()}>
            保存新版本
          </Button>
        }
      >
        <Form<SaveRentalDiscountPlanRequest> form={discountForm} layout="vertical" onFinish={(values) => saveDiscount.mutate(values)}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="code" label="方案编码" rules={[{ required: true }]}>
                <Input disabled={Boolean(discountForm.getFieldValue("id"))} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="name" label="方案名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="status" label="状态">
                <Select
                  options={[
                    { value: "draft", label: "草稿" },
                    { value: "enabled", label: "启用" },
                    { value: "disabled", label: "停用" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="discountType" label="优惠类型">
                <Select
                  options={[
                    { value: "percentage", label: "百分比减免" },
                    { value: "fixed_amount", label: "固定减免" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="discountValue" label="优惠值">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="maximumDiscount" label="最高减免">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="minimumSpend" label="最低消费">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="customerScope" label="客户范围">
                <Select
                  options={[
                    { value: "all", label: "全部" },
                    { value: "personal", label: "个人" },
                    { value: "corporate", label: "企业" },
                    { value: "member", label: "会员" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="priority" label="优先级">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="applicableItemGroupIds" label="适用商品（空为全部）">
            <Select
              mode="multiple"
              allowClear
              options={(groups.data ?? []).map((group) => ({
                value: group.id,
                label: group.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="applicableDayTypes" label="适用日期类型（空为全部）">
            <Select mode="multiple" allowClear options={["workday", "weekend", "statutory_holiday", "makeup_workday", "tenant_special"].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="effectiveFrom" label="生效时间">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="effectiveTo" label="失效时间">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="stackableWithCoupon" label="允许与优惠券叠加" valuePropName="checked">
            <Select
              options={[
                { value: true, label: "允许" },
                { value: false, label: "不允许" },
              ]}
            />
          </Form.Item>
          <Form.Item name="changeReason" label="变更原因" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title={serviceForm.getFieldValue("id") ? "编辑增值服务" : "新增增值服务"}
        width={680}
        open={Boolean(serviceEditor)}
        destroyOnHidden
        onClose={() => setServiceEditor(null)}
        extra={
          <Button type="primary" loading={saveService.isPending} onClick={() => serviceForm.submit()}>
            保存服务
          </Button>
        }
      >
        <Form<SaveRentalValueAddedServiceRequest> form={serviceForm} layout="vertical" onFinish={(values) => saveService.mutate(values)}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="code" label="服务编码">
                <Input disabled={Boolean(serviceForm.getFieldValue("id"))} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="name" label="服务名称">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="status" label="状态">
                <Select
                  options={[
                    { value: "enabled", label: "启用" },
                    { value: "disabled", label: "停用" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="serviceType" label="服务类型">
                <Select options={Object.entries(serviceTypeLabels).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="billingUnit" label="计费方式">
                <Select
                  options={[
                    { value: "per_order", label: "每订单" },
                    { value: "per_day", label: "每天" },
                    { value: "per_unit", label: "每件" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="price" label="价格">
                <InputNumber min={0} precision={2} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="maximumQuantity" label="最大数量">
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="coverageLimit" label="保障限额">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="deductible" label="免赔额">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="applicableItemGroupIds" label="适用商品（空为全部）">
            <Select
              mode="multiple"
              options={(groups.data ?? []).map((group) => ({
                value: group.id,
                label: group.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="termsVersion" label="条款版本">
            <Input />
          </Form.Item>
          <Form.Item name="terms" label="服务/保障条款" rules={[{ required: true }]}>
            <Input.TextArea rows={6} />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
