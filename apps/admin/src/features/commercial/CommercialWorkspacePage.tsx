import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import { ConfigStatus, StoreRentalMode } from "@store-rental/shared";
import type { MarketingPlanDetail, PricingPlanDetail, PricingRuleLine, SaveMarketingPlanRequest, StoreRentalRuleVersionRecord, StoreValueAddedServiceSummary } from "@store-rental/shared";
import { App, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/rental";
import { getRentalRuleVersion, listRentalRuleVersions } from "@/api/operations";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

type RuleEditorValues = {
  pendingPayment: { enabled: boolean; holdMinutes: number };
  oneWayReturn: { enabled: boolean; baseFeeAmount: number; crossCityFeeAmount: number };
  dispatch: { autoAssignEnabled: boolean; minTurnoverMinutes: number };
  durationBilling: { minBillableHours: number; chargeAsDayAfterHours: number; billingUnitMinutes: number };
  overdue: { graceMinutes: number; billingUnitMinutes: number; feeMultiplier: number };
  inspection: { requirePickupPhotos: boolean; requireReturnPhotos: boolean };
  enterpriseBilling: { monthlySettlementEnabled: boolean };
  changeReason: string;
};
type PricingEditorValues = { ruleLines: PricingRuleLine[]; changeReason: string };
type MarketingEditorValues = Omit<SaveMarketingPlanRequest, "rules" | "operator">;

const money = (value: number | undefined) => `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CommercialWorkspacePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const operator = useAuthStore((state) => state.user?.displayName ?? "规则管理员");
  const [serviceDrawer, setServiceDrawer] = useState(false);
  const [ruleDrawer, setRuleDrawer] = useState(false);
  const [pricingDetail, setPricingDetail] = useState<PricingPlanDetail>();
  const [marketingDetail, setMarketingDetail] = useState<MarketingPlanDetail>();
  const [ruleVersionDetail, setRuleVersionDetail] = useState<StoreRentalRuleVersionRecord>();
  const [marketingOpen, setMarketingOpen] = useState(false);
  const [serviceForm] = Form.useForm<StoreValueAddedServiceSummary>();
  const [ruleForm] = Form.useForm<RuleEditorValues>();
  const [pricingForm] = Form.useForm<PricingEditorValues>();
  const [marketingForm] = Form.useForm<MarketingEditorValues>();
  const pricing = useQuery({ queryKey: ["pricing"], queryFn: api.pricing });
  const rules = useQuery({ queryKey: ["rental-rules"], queryFn: api.rules });
  const ruleVersions = useQuery({ queryKey: ["rental-rule-versions"], queryFn: listRentalRuleVersions });
  const services = useQuery({ queryKey: ["value-added-services"], queryFn: api.valueAddedServices });
  const marketing = useQuery({ queryKey: ["marketing-plans"], queryFn: api.marketingPlans });
  const saveService = useMutation({
    mutationFn: api.saveValueAddedService,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["value-added-services"] });
      setServiceDrawer(false);
      serviceForm.resetFields();
      message.success("增值服务已保存");
    },
    onError: () => message.error("保存失败，请检查服务编码和后端状态")
  });
  const saveRules = useMutation({
    mutationFn: (values: RuleEditorValues) => {
      if (!rules.data) throw new Error("规则尚未加载");
      return api.saveRules({
        ...rules.data,
        pendingPayment: { ...rules.data.pendingPayment, ...values.pendingPayment },
        oneWayReturn: { ...rules.data.oneWayReturn, ...values.oneWayReturn },
        dispatch: { ...rules.data.dispatch, ...values.dispatch },
        durationBilling: { ...rules.data.durationBilling, ...values.durationBilling },
        overdue: { ...rules.data.overdue, ...values.overdue },
        inspection: { ...rules.data.inspection, ...values.inspection },
        enterpriseBilling: { ...rules.data.enterpriseBilling, ...values.enterpriseBilling },
        operator,
        changeReason: values.changeReason
      });
    },
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-rules"] }), queryClient.invalidateQueries({ queryKey: ["rental-rule-versions"] })]); setRuleDrawer(false); ruleForm.resetFields(); message.success("租赁规则新版本已保存"); },
    onError: () => message.error("规则保存失败，请检查联动字段和版本状态")
  });
  const savePricing = useMutation({
    mutationFn: (values: PricingEditorValues) => {
      if (!pricingDetail) throw new Error("定价计划尚未加载");
      return api.savePricingPlan(pricingDetail.id, { ...values, operator });
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["pricing"] }); setPricingDetail(undefined); pricingForm.resetFields(); message.success("定价计划新版本已保存"); },
    onError: () => message.error("定价计划保存失败")
  });
  const saveMarketing = useMutation({
    mutationFn: (values: MarketingEditorValues) => api.saveMarketingPlan({
      ...values,
      rules: marketingDetail?.rules ?? [{
        id: `rule-${Date.now()}`,
        name: "默认规则",
        vehicleGroupCodes: values.vehicleGroupCodes,
        membershipLevels: [],
        weekdayAction: { type: "discount", value: values.weekdayRate, label: "工作日折扣" },
        holidayAction: { type: "discount", value: values.holidayRate, label: "节假日折扣" },
        maxDeductionAmount: values.fixedDeductionAmount
      }],
      operator,
      changeReason: values.changeReason || "React 营运端方案调整"
    }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["marketing-plans"] }); setMarketingOpen(false); setMarketingDetail(undefined); marketingForm.resetFields(); message.success("营销方案已保存"); },
    onError: () => message.error("营销方案保存失败")
  });

  function editService(record?: StoreValueAddedServiceSummary) {
    serviceForm.setFieldsValue(record ?? {
      id: "",
      name: "",
      code: "",
      category: "service",
      memberLimit: "全部客户",
      price: 0,
      unit: "/次",
      maxQuantity: 1,
      trackInventory: false,
      status: "enabled",
      version: "",
      description: ""
    });
    setServiceDrawer(true);
  }

  async function toggleService(record: StoreValueAddedServiceSummary, enabled: boolean) {
    await saveService.mutateAsync({ ...record, status: enabled ? "enabled" : "disabled" });
  }

  function openRuleEditor() {
    if (!rules.data) return;
    ruleForm.setFieldsValue({
      pendingPayment: rules.data.pendingPayment,
      oneWayReturn: rules.data.oneWayReturn,
      dispatch: rules.data.dispatch,
      durationBilling: rules.data.durationBilling,
      overdue: rules.data.overdue,
      inspection: rules.data.inspection,
      enterpriseBilling: rules.data.enterpriseBilling,
      changeReason: "React 营运端规则调整"
    });
    setRuleDrawer(true);
  }

  async function editPricing(id: string) {
    try {
      const detail = await api.pricingPlan(id);
      setPricingDetail(detail);
      pricingForm.setFieldsValue({ ruleLines: detail.ruleLines, changeReason: "React 营运端定价调整" });
    } catch { message.error("定价计划详情加载失败"); }
  }

  async function editMarketing(id?: string) {
    try {
      const detail = id ? await api.marketingPlan(id) : undefined;
      setMarketingDetail(detail);
      marketingForm.setFieldsValue(detail ? {
        id: detail.id, code: detail.code, name: detail.name, displayName: detail.displayName, status: detail.status,
        customerScope: detail.customerScope, supportedModes: detail.supportedModes, priority: detail.priority,
        effectiveFrom: detail.effectiveFrom, effectiveTo: detail.effectiveTo, storeCodes: detail.storeCodes,
        vehicleGroupCodes: detail.vehicleGroupCodes, manualVerification: detail.manualVerification,
        qualificationName: detail.qualificationName, requiredDocText: detail.requiredDocText, weekdayRate: detail.weekdayRate,
        holidayRate: detail.holidayRate, fixedDeductionAmount: detail.fixedDeductionAmount, description: detail.description,
        changeReason: "React 营运端方案调整"
      } : {
        name: "", displayName: "", status: ConfigStatus.Draft, customerScope: "all", supportedModes: [StoreRentalMode.Store], priority: 100,
        effectiveFrom: "", effectiveTo: "", storeCodes: [], vehicleGroupCodes: [], manualVerification: false,
        weekdayRate: 1, holidayRate: 1, fixedDeductionAmount: 0, description: "", changeReason: "新建营销方案"
      });
      setMarketingOpen(true);
    } catch { message.error("营销方案详情加载失败"); }
  }

  return (
    <>
      <PageHeader title="商业规则中心" description="统一查看定价、租赁规则、增值服务与营销方案。规则仍使用现有车辆租赁内核，通用品类模型尚未落地。" />
      <Card className="tabbed-workspace">
        <Tabs
          className="standalone-tabs"
          items={[
            {
              key: "pricing",
              label: "定价计划",
              children: (
                <QueryState loading={pricing.isLoading} error={pricing.error}>
                  <Table
                    rowKey="id"
                    dataSource={pricing.data ?? []}
                    columns={[
                      { title: "计划", render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code}</span></> },
                      { title: "版本", dataIndex: "version" },
                      { title: "标的分组", dataIndex: "vehicleGroupCount", render: (value) => `${value} 个` },
                      { title: "币种", dataIndex: "currency" },
                      { title: "生效时间", dataIndex: "effectiveAt" },
                      { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "effective" ? "success" : "default"}>{value}</Tag> },
                      { title: "操作", render: (_, record) => <Button type="link" icon={<EditOutlined />} onClick={() => editPricing(record.id)}>编辑价格</Button> }
                    ]}
                  />
                </QueryState>
              )
            },
            {
              key: "rules",
              label: "租赁规则",
              children: (
                <QueryState loading={rules.isLoading} error={rules.error}>
                  {rules.data && <>
                    <div className="table-toolbar"><Space><Tag color={rules.data.status === "effective" ? "success" : "default"}>{rules.data.status}</Tag><Typography.Text>版本 {rules.data.version}</Typography.Text><Typography.Text type="secondary">生效时间 {rules.data.effectiveAt}</Typography.Text></Space><Button icon={<EditOutlined />} onClick={openRuleEditor}>调整规则</Button></div>
                    <Descriptions bordered size="small" column={{ xs: 1, md: 2, xl: 3 }} items={[
                      { key: "mode", label: "启用履约模式", children: rules.data.enabledModes.join("、") },
                      { key: "hold", label: "待支付保留", children: rules.data.pendingPayment.enabled ? `${rules.data.pendingPayment.holdMinutes} 分钟` : "关闭" },
                      { key: "dispatch", label: "自动调度", children: rules.data.dispatch.autoAssignEnabled ? `开启 · 周转 ${rules.data.dispatch.minTurnoverMinutes} 分钟` : "关闭" },
                      { key: "duration", label: "计费阈值", children: `${rules.data.durationBilling.chargeAsDayAfterHours} 小时按日计费` },
                      { key: "oneWay", label: "异地归还", children: rules.data.oneWayReturn.enabled ? `基础费 ${money(rules.data.oneWayReturn.baseFeeAmount)}` : "关闭" },
                      { key: "overdue", label: "逾期规则", children: `${rules.data.overdue.graceMinutes} 分钟宽限 · ${rules.data.overdue.feeMultiplier} 倍` },
                      { key: "inspection", label: "交接检查", children: `领取照片 ${rules.data.inspection.requirePickupPhotos ? "必需" : "可选"} · 归还照片 ${rules.data.inspection.requireReturnPhotos ? "必需" : "可选"}` },
                      { key: "enterprise", label: "企业月结", children: rules.data.enterpriseBilling.monthlySettlementEnabled ? "启用" : "关闭" }
                    ]} />
                    <Typography.Title level={5} style={{ marginTop: 24 }}>规则版本历史</Typography.Title>
                    <Table<StoreRentalRuleVersionRecord> size="small" rowKey="version" loading={ruleVersions.isLoading} dataSource={ruleVersions.data ?? []} columns={[
                      { title: "版本", dataIndex: "version" },
                      { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
                      { title: "变更原因", dataIndex: "changeReason" },
                      { title: "保存人", dataIndex: "savedBy" },
                      { title: "保存时间", dataIndex: "savedAt" },
                      { title: "操作", render: (_, record) => <Button type="link" onClick={async () => { try { setRuleVersionDetail(await getRentalRuleVersion(record.version)); } catch { message.error("规则版本详情加载失败"); } }}>查看快照</Button> }
                    ]} />
                    <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>表单只开放高频字段，但保存时基于当前完整规则合并并生成版本，避免丢失取消、爽约、续租等未展示的联动字段。</Typography.Paragraph>
                  </>}
                </QueryState>
              )
            },
            {
              key: "services",
              label: "增值服务",
              children: (
                <QueryState loading={services.isLoading} error={services.error}>
                  <div className="table-toolbar"><Typography.Text type="secondary">保险、配件与履约服务可参与订单报价。</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => editService()}>新增服务</Button></div>
                  <Table
                    rowKey="id"
                    dataSource={services.data ?? []}
                    columns={[
                      { title: "服务", render: (_, record) => <><b>{record.name}</b><br /><span className="muted">{record.code} · {record.version}</span></> },
                      { title: "分类", dataIndex: "category", render: (value) => <Tag>{value}</Tag> },
                      { title: "价格", render: (_, record) => `${money(record.price)}${record.unit}` },
                      { title: "数量上限", dataIndex: "maxQuantity" },
                      { title: "库存跟踪", render: (_, record) => record.trackInventory ? `${record.currentStock ?? 0} / ${record.totalStock ?? 0}` : "不跟踪" },
                      { title: "启用", render: (_, record) => <Switch checked={record.status === "enabled"} loading={saveService.isPending} onChange={(checked) => toggleService(record, checked)} /> },
                      { title: "操作", render: (_, record) => <Button type="link" onClick={() => editService(record)}>编辑</Button> }
                    ]}
                  />
                </QueryState>
              )
            },
            {
              key: "marketing",
              label: "营销方案",
              children: (
                <QueryState loading={marketing.isLoading} error={marketing.error}>
                  <div className="table-toolbar"><Typography.Text type="secondary">方案保存会生成版本；详细优惠规则在编辑既有方案时原样保留。</Typography.Text><Button type="primary" icon={<PlusOutlined />} onClick={() => editMarketing()}>新增方案</Button></div>
                  <Table
                    rowKey="id"
                    scroll={{ x: 1080 }}
                    dataSource={marketing.data ?? []}
                    columns={[
                      { title: "方案", fixed: "left", render: (_, record) => <><b>{record.displayName}</b><br /><span className="muted">{record.code} · {record.version}</span></> },
                      { title: "客户范围", dataIndex: "customerScope" },
                      { title: "优先级", dataIndex: "priority" },
                      { title: "工作日折扣", dataIndex: "weekdayRate", render: (value) => `${Number(value) * 10} 折` },
                      { title: "节假日折扣", dataIndex: "holidayRate", render: (value) => `${Number(value) * 10} 折` },
                      { title: "固定减免", dataIndex: "fixedDeductionAmount", render: money },
                      { title: "有效期", render: (_, record) => `${record.effectiveFrom} → ${record.effectiveTo}` },
                      { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "effective" ? "success" : "default"}>{value}</Tag> },
                      { title: "操作", fixed: "right", render: (_, record) => <Button type="link" icon={<EditOutlined />} onClick={() => editMarketing(record.id)}>编辑</Button> }
                    ]}
                  />
                </QueryState>
              )
            }
          ]}
        />
      </Card>

      <Drawer title={`规则版本 ${ruleVersionDetail?.version ?? ""}`} open={Boolean(ruleVersionDetail)} width={720} onClose={() => setRuleVersionDetail(undefined)}>
        {ruleVersionDetail && <>
          <Descriptions bordered size="small" column={2} items={[
            { key: "status", label: "状态", children: ruleVersionDetail.status },
            { key: "effective", label: "生效时间", children: ruleVersionDetail.effectiveAt },
            { key: "savedBy", label: "保存人", children: ruleVersionDetail.savedBy },
            { key: "savedAt", label: "保存时间", children: ruleVersionDetail.savedAt },
            { key: "reason", label: "变更原因", span: 2, children: ruleVersionDetail.changeReason }
          ]} />
          <Typography.Title level={5} style={{ marginTop: 20 }}>完整配置快照</Typography.Title>
          <Input.TextArea readOnly autoSize={{ minRows: 12, maxRows: 24 }} value={JSON.stringify(ruleVersionDetail.snapshot, null, 2)} />
        </>}
      </Drawer>
      <Drawer title={serviceForm.getFieldValue("id") ? "编辑增值服务" : "新增增值服务"} open={serviceDrawer} width={520} onClose={() => setServiceDrawer(false)} destroyOnHidden extra={<Button type="primary" loading={saveService.isPending} onClick={() => serviceForm.submit()}>保存</Button>}>
        <Form form={serviceForm} layout="vertical" onFinish={(values) => saveService.mutate({ ...services.data?.find((item) => item.id === values.id), ...values })}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Form.Item name="version" hidden><Input /></Form.Item>
          <Form.Item name="name" label="服务名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="code" label="服务编码" rules={[{ required: true }]}><Input disabled={Boolean(serviceForm.getFieldValue("id"))} /></Form.Item>
          <Space align="start" style={{ width: "100%" }}>
            <Form.Item name="category" label="分类" rules={[{ required: true }]}><Select style={{ width: 150 }} options={[{ value: "insurance", label: "保险" }, { value: "equipment", label: "配件" }, { value: "service", label: "服务" }]} /></Form.Item>
            <Form.Item name="price" label="单价" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: 140 }} /></Form.Item>
            <Form.Item name="unit" label="单位" rules={[{ required: true }]}><Select style={{ width: 100 }} options={[{ value: "/天", label: "/天" }, { value: "/次", label: "/次" }]} /></Form.Item>
          </Space>
          <Form.Item name="maxQuantity" label="单订单最大数量" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="memberLimit" label="客户限制" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="服务说明" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
          <Form.Item name="trackInventory" label="跟踪库存" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></Form.Item>
        </Form>
      </Drawer>
      <Drawer title="调整租赁规则" open={ruleDrawer} width={620} onClose={() => setRuleDrawer(false)} destroyOnHidden extra={<Button type="primary" loading={saveRules.isPending} onClick={() => ruleForm.submit()}>保存新版本</Button>}>
        <Form<RuleEditorValues> form={ruleForm} layout="vertical" onFinish={(values) => saveRules.mutate(values)}>
          <Card size="small" title="预订与调度">
            <Space align="start" size="large" wrap>
              <Form.Item name={["pendingPayment", "enabled"]} label="启用待支付占位" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name={["pendingPayment", "holdMinutes"]} label="占位时长（分钟）"><InputNumber min={1} /></Form.Item>
              <Form.Item name={["dispatch", "autoAssignEnabled"]} label="自动分配资产" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name={["dispatch", "minTurnoverMinutes"]} label="最小周转（分钟）"><InputNumber min={0} /></Form.Item>
            </Space>
          </Card>
          <Card size="small" title="计费与异地履约" style={{ marginTop: 12 }}>
            <Space align="start" size="large" wrap>
              <Form.Item name={["durationBilling", "minBillableHours"]} label="最低计费小时"><InputNumber min={0} /></Form.Item>
              <Form.Item name={["durationBilling", "chargeAsDayAfterHours"]} label="按日阈值（小时）"><InputNumber min={1} max={24} /></Form.Item>
              <Form.Item name={["durationBilling", "billingUnitMinutes"]} label="计费单位（分钟）"><InputNumber min={1} /></Form.Item>
              <Form.Item name={["oneWayReturn", "enabled"]} label="允许异地归还" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name={["oneWayReturn", "baseFeeAmount"]} label="异地基础费"><InputNumber min={0} precision={2} /></Form.Item>
              <Form.Item name={["oneWayReturn", "crossCityFeeAmount"]} label="跨城费用"><InputNumber min={0} precision={2} /></Form.Item>
            </Space>
          </Card>
          <Card size="small" title="逾期、检查与月结" style={{ marginTop: 12 }}>
            <Space align="start" size="large" wrap>
              <Form.Item name={["overdue", "graceMinutes"]} label="逾期宽限（分钟）"><InputNumber min={0} /></Form.Item>
              <Form.Item name={["overdue", "billingUnitMinutes"]} label="逾期计费单位"><InputNumber min={1} /></Form.Item>
              <Form.Item name={["overdue", "feeMultiplier"]} label="逾期倍率"><InputNumber min={1} precision={2} /></Form.Item>
              <Form.Item name={["inspection", "requirePickupPhotos"]} label="领取必须拍照" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name={["inspection", "requireReturnPhotos"]} label="归还必须拍照" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name={["enterpriseBilling", "monthlySettlementEnabled"]} label="允许企业月结" valuePropName="checked"><Switch /></Form.Item>
            </Space>
          </Card>
          <Form.Item name="changeReason" label="变更原因" rules={[{ required: true }]} style={{ marginTop: 16 }}><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Drawer>
      <Drawer title={`编辑定价 · ${pricingDetail?.name ?? ""}`} open={Boolean(pricingDetail)} width={760} onClose={() => setPricingDetail(undefined)} destroyOnHidden extra={<Button type="primary" loading={savePricing.isPending} onClick={() => pricingForm.submit()}>保存新版本</Button>}>
        <Form<PricingEditorValues> form={pricingForm} layout="vertical" onFinish={(values) => savePricing.mutate(values)}>
          <Form.List name="ruleLines">
            {(fields) => <Space direction="vertical" style={{ width: "100%" }} size={12}>{fields.map(({ key, name }) => <Card key={key} size="small">
              <Form.Item name={[name, "vehicleGroupCode"]} hidden><Input /></Form.Item>
              <Form.Item name={[name, "vehicleGroupName"]} label="标的分组"><Input disabled /></Form.Item>
              <Space align="start" wrap>
                <Form.Item name={[name, "baseDailyAmount"]} label="基础日租" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item>
                <Form.Item name={[name, "weekendDailyAmount"]} label="周末日租" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item>
                <Form.Item name={[name, "depositAmount"]} label="押金" rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item>
              </Space>
            </Card>)}</Space>}
          </Form.List>
          <Form.Item name="changeReason" label="变更原因" rules={[{ required: true }]} style={{ marginTop: 16 }}><Input.TextArea rows={3} /></Form.Item>
          <Typography.Paragraph type="secondary">当前接口只允许调整标的分组基础价、周末价和押金；服务费、时长折扣和网点调价保持现有版本不变。</Typography.Paragraph>
        </Form>
      </Drawer>
      <Drawer title={marketingDetail ? `编辑营销方案 · ${marketingDetail.displayName}` : "新增营销方案"} open={marketingOpen} width={680} onClose={() => { setMarketingOpen(false); setMarketingDetail(undefined); }} destroyOnHidden extra={<Button type="primary" loading={saveMarketing.isPending} onClick={() => marketingForm.submit()}>保存方案</Button>}>
        <Form<MarketingEditorValues> form={marketingForm} layout="vertical" onFinish={(values) => saveMarketing.mutate(values)}>
          <Form.Item name="id" hidden><Input /></Form.Item>
          <Space align="start" style={{ width: "100%" }} wrap>
            <Form.Item name="code" label="方案编码"><Input disabled={Boolean(marketingDetail)} style={{ width: 190 }} /></Form.Item>
            <Form.Item name="name" label="内部名称" rules={[{ required: true }]}><Input style={{ width: 190 }} /></Form.Item>
            <Form.Item name="displayName" label="展示名称" rules={[{ required: true }]}><Input style={{ width: 190 }} /></Form.Item>
          </Space>
          <Space align="start" wrap>
            <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select style={{ width: 150 }} options={Object.values(ConfigStatus).map((value) => ({ value, label: value }))} /></Form.Item>
            <Form.Item name="customerScope" label="客户范围" rules={[{ required: true }]}><Select style={{ width: 150 }} options={[{ value: "all", label: "全部" }, { value: "personal", label: "个人" }, { value: "enterprise", label: "企业" }]} /></Form.Item>
            <Form.Item name="priority" label="优先级" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item>
          </Space>
          <Form.Item name="supportedModes" label="适用履约模式" rules={[{ required: true }]}><Select mode="tags" /></Form.Item>
          <Form.Item name="storeCodes" label="适用网点编码"><Select mode="tags" /></Form.Item>
          <Form.Item name="vehicleGroupCodes" label="适用标的分组编码"><Select mode="tags" /></Form.Item>
          <Space align="start" wrap>
            <Form.Item name="effectiveFrom" label="生效时间" rules={[{ required: true }]}><Input placeholder="YYYY-MM-DD HH:mm:ss" style={{ width: 200 }} /></Form.Item>
            <Form.Item name="effectiveTo" label="失效时间" rules={[{ required: true }]}><Input placeholder="YYYY-MM-DD HH:mm:ss" style={{ width: 200 }} /></Form.Item>
          </Space>
          <Space align="start" wrap>
            <Form.Item name="weekdayRate" label="工作日折扣系数" rules={[{ required: true }]}><InputNumber min={0} max={1} step={0.05} /></Form.Item>
            <Form.Item name="holidayRate" label="节假日折扣系数" rules={[{ required: true }]}><InputNumber min={0} max={1} step={0.05} /></Form.Item>
            <Form.Item name="fixedDeductionAmount" label="固定减免"><InputNumber min={0} precision={2} /></Form.Item>
          </Space>
          <Form.Item name="manualVerification" label="需要人工核验" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="qualificationName" label="资质名称"><Input /></Form.Item>
          <Form.Item name="requiredDocText" label="所需材料"><Input /></Form.Item>
          <Form.Item name="description" label="方案说明" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="changeReason" label="变更原因" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
          {marketingDetail && <Typography.Paragraph type="secondary">此表单更新方案主属性，并保留当前 {marketingDetail.rules.length} 条详细优惠规则；详细规则编排仍受现有车辆分组编码约束。</Typography.Paragraph>}
        </Form>
      </Drawer>
    </>
  );
}
