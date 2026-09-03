import { CheckOutlined, PlusOutlined, RobotOutlined, StopOutlined } from "@ant-design/icons";
import type {
  CorporateDetail,
  CreateCorporateContractAttachmentRequest,
  CreatePriceAdjustmentScheduleRequest,
  CreateStoreRentalFeeRequest,
  CreateStoreRentalNotificationRequest,
  CreateStoreRentalRemarkRequest,
  CreateStoreRentalTransactionRequest,
  PriceAdjustmentSchedule,
  SettleCorporateMonthlyBillRequest,
  StoreRentalDispatchPlan,
  StoreRentalOrderDetail
} from "@store-rental/shared";
import { App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/rental";
import {
  analyzeDispatchWithAi,
  applyDispatchOptimization,
  cancelPriceSchedule,
  closeDispatchTask,
  closeStoreRentalOrderRemark,
  createCorporateContractAttachment,
  createPriceSchedule,
  createStoreRentalOrderFee,
  createStoreRentalOrderNotification,
  createStoreRentalOrderRemark,
  createStoreRentalOrderTransaction,
  getDispatchEvents,
  hardLockDispatchOrders,
  manualReassignFromDispatch,
  previewDispatchOptimization,
  processDispatchVehicleUnavailable,
  settleCorporateMonthlyBill,
  waiveStoreRentalOrderFee
} from "@/api/operations";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

type OrderTool = "fee" | "transaction" | "notification" | "remark" | undefined;
type CorporateTool = "settle" | "attachment" | undefined;

export function BusinessToolsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const operator = useAuthStore((state) => state.user?.displayName ?? "运营管理员");
  const [pricingId, setPricingId] = useState<string>();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [dispatchPlan, setDispatchPlan] = useState<StoreRentalDispatchPlan>();
  const [selectedOrderId, setSelectedOrderId] = useState<string>();
  const [orderTool, setOrderTool] = useState<OrderTool>();
  const [selectedCorporateId, setSelectedCorporateId] = useState<string>();
  const [corporateTool, setCorporateTool] = useState<CorporateTool>();
  const [selectedBillId, setSelectedBillId] = useState<string>();
  const [selectedContractId, setSelectedContractId] = useState<string>();
  const [scheduleForm] = Form.useForm<CreatePriceAdjustmentScheduleRequest>();
  const [dispatchForm] = Form.useForm<{ windowDays: 3 | 7 | 14; storeName?: string; vehicleGroupName?: string }>();
  const [manualForm] = Form.useForm<{ orderId: string; targetVehicleId?: string; reason: string }>();
  const [unavailableForm] = Form.useForm<{ vehicleId: string; reason: string; targetOperationStatus: "controlled" | "maintenance" | "disabled"; tryAutoReassign: boolean; memo?: string }>();
  const [orderForm] = Form.useForm<Record<string, unknown>>();
  const [corporateForm] = Form.useForm<Record<string, unknown>>();

  const pricing = useQuery({ queryKey: ["pricing", "tools"], queryFn: api.pricing });
  const pricingDetail = useQuery({ queryKey: ["pricing-plan", pricingId, "tools"], queryFn: () => api.pricingPlan(pricingId!), enabled: Boolean(pricingId) });
  const board = useQuery({ queryKey: ["dispatch-board", "tools"], queryFn: api.dispatchBoard });
  const tasks = useQuery({ queryKey: ["dispatch-tasks", "tools"], queryFn: api.dispatchTasks });
  const events = useQuery({ queryKey: ["dispatch-events"], queryFn: () => getDispatchEvents({}) });
  const assets = useQuery({ queryKey: ["assets", "business-tools"], queryFn: () => api.assets({ page: 1, pageSize: 300 }) });
  const orders = useQuery({ queryKey: ["orders", "business-tools"], queryFn: api.orders });
  const orderDetail = useQuery({ queryKey: ["order", selectedOrderId, "business-tools"], queryFn: () => api.order(selectedOrderId!), enabled: Boolean(selectedOrderId) });
  const corporates = useQuery({ queryKey: ["corporates", "business-tools"], queryFn: () => api.corporates({ page: 1, pageSize: 200 }) });
  const corporate = useQuery({ queryKey: ["corporate", selectedCorporateId, "business-tools"], queryFn: () => api.corporate(selectedCorporateId!), enabled: Boolean(selectedCorporateId) });
  const bills = useQuery({ queryKey: ["corporate-bills", selectedCorporateId], queryFn: () => api.corporateMonthlyBills(selectedCorporateId!), enabled: Boolean(selectedCorporateId) });

  const scheduleMutation = useMutation({ mutationFn: createPriceSchedule, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["pricing-plan", pricingId] }); setScheduleOpen(false); scheduleForm.resetFields(); message.success("动态调价计划已创建"); }, onError: () => message.error("调价计划创建失败") });
  const cancelSchedule = useMutation({ mutationFn: cancelPriceSchedule, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["pricing-plan", pricingId] }); message.success("调价计划已取消"); }, onError: () => message.error("调价计划取消失败") });
  const preview = useMutation({ mutationFn: previewDispatchOptimization, onSuccess: (result) => { setDispatchPlan(result); message.success("调度优化预览已生成"); }, onError: () => message.error("优化预览失败") });
  const ai = useMutation({ mutationFn: analyzeDispatchWithAi, onSuccess: (result) => modal.info({ title: "AI 调度分析", width: 720, content: <pre style={{ whiteSpace: "pre-wrap", maxHeight: 480, overflow: "auto" }}>{JSON.stringify(result, null, 2)}</pre> }), onError: () => message.error("AI 调度分析失败") });
  const apply = useMutation({ mutationFn: () => applyDispatchOptimization({ planId: dispatchPlan?.planId, rows: dispatchPlan?.rows ?? [], operator }), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["dispatch-board"] }), queryClient.invalidateQueries({ queryKey: ["dispatch-events"] })]); message.success("调度方案已应用"); }, onError: () => message.error("调度方案应用失败") });
  const hardLock = useMutation({ mutationFn: () => hardLockDispatchOrders({ orderIds: dispatchPlan?.rows.map((item) => item.orderId), operator }), onSuccess: () => message.success("订单已执行硬锁"), onError: () => message.error("硬锁失败") });
  const manual = useMutation({ mutationFn: (values: { orderId: string; targetVehicleId?: string; reason: string }) => manualReassignFromDispatch({ ...values, operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["dispatch-board"] }); manualForm.resetFields(); message.success("人工改派已完成"); }, onError: () => message.error("人工改派失败") });
  const unavailable = useMutation({ mutationFn: (values: { vehicleId: string; reason: string; targetOperationStatus: "controlled" | "maintenance" | "disabled"; tryAutoReassign: boolean; memo?: string }) => processDispatchVehicleUnavailable({ ...values, reason: values.reason as never, operator }), onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ["dispatch-board"] }); unavailableForm.resetFields(); message.success(result.message); }, onError: () => message.error("车辆不可用处理失败") });
  const closeTask = useMutation({ mutationFn: (task: { id: string; orderId: string; taskType: string }) => closeDispatchTask({ taskId: task.id, orderId: task.orderId, taskType: task.taskType as never, reason: "React 运营端关闭", operator }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["dispatch-tasks"] }); message.success("任务已关闭"); }, onError: () => message.error("任务关闭失败") });

  const orderMutation = useMutation({
    mutationFn: async ({ tool, values }: { tool: Exclude<OrderTool, undefined>; values: Record<string, unknown> }) => {
      const id = selectedOrderId!;
      if (tool === "fee") return createStoreRentalOrderFee(id, { ...(values as unknown as CreateStoreRentalFeeRequest), operator });
      if (tool === "transaction") return createStoreRentalOrderTransaction(id, { ...(values as unknown as CreateStoreRentalTransactionRequest), relatedFeeIds: [], operator });
      if (tool === "notification") return createStoreRentalOrderNotification(id, { ...(values as unknown as CreateStoreRentalNotificationRequest), operator });
      return createStoreRentalOrderRemark(id, { ...(values as unknown as CreateStoreRentalRemarkRequest), operator });
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["order", selectedOrderId] }); setOrderTool(undefined); orderForm.resetFields(); message.success("订单辅助记录已保存"); },
    onError: () => message.error("订单记录保存失败")
  });
  const waiveFee = useMutation({ mutationFn: ({ feeId, amount }: { feeId: string; amount: number }) => waiveStoreRentalOrderFee(selectedOrderId!, feeId, { amount, operator, reason: "React 运营端费用减免" }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["order", selectedOrderId] }); message.success("费用已减免"); }, onError: () => message.error("费用减免失败") });
  const closeRemark = useMutation({ mutationFn: (remarkId: string) => closeStoreRentalOrderRemark(selectedOrderId!, remarkId, { operator, closeNote: "React 运营端关闭跟进" }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["order", selectedOrderId] }); message.success("跟进备注已关闭"); }, onError: () => message.error("备注关闭失败") });
  const corporateMutation = useMutation({
    mutationFn: async ({ tool, values }: { tool: Exclude<CorporateTool, undefined>; values: Record<string, unknown> }) => tool === "settle"
      ? settleCorporateMonthlyBill(selectedCorporateId!, selectedBillId!, { ...(values as unknown as SettleCorporateMonthlyBillRequest), operator })
      : createCorporateContractAttachment(selectedCorporateId!, selectedContractId!, { ...(values as unknown as CreateCorporateContractAttachmentRequest), uploadedBy: operator }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["corporate-bills", selectedCorporateId] }), queryClient.invalidateQueries({ queryKey: ["corporate", selectedCorporateId] })]); setCorporateTool(undefined); corporateForm.resetFields(); message.success("企业结算资料已更新"); },
    onError: () => message.error("企业操作失败")
  });

  function openSchedule() {
    if (!pricingDetail.data) return;
    scheduleForm.setFieldsValue({ effectiveAt: "", summary: "计划调价", operator, changes: pricingDetail.data.ruleLines.map((item) => ({ vehicleGroupCode: item.vehicleGroupCode, vehicleGroupName: item.vehicleGroupName, currentPrice: item.baseDailyAmount, newPrice: item.baseDailyAmount })) });
    setScheduleOpen(true);
  }
  function openOrderTool(tool: Exclude<OrderTool, undefined>) {
    const defaults = { fee: { code: "MANUAL_FEE", name: "手工费用", stage: "post_charge", direction: "charge", amount: 0, description: "" }, transaction: { type: "charge", channel: "offline", amount: 0, note: "" }, notification: { scene: "manual", channel: "APP", target: orderDetail.data?.customerName ?? "", content: "", status: "sent" }, remark: { category: "operation", content: "", visibility: "internal", status: "open" } }[tool];
    orderForm.setFieldsValue(defaults);
    setOrderTool(tool);
  }

  return <>
    <PageHeader title="业务控制台" description="补充动态调价、高级调度、订单辅助台账和企业月结等低频但关键的运营能力。" />
    <Card className="tabbed-workspace"><Tabs className="standalone-tabs" items={[
      { key: "pricing", label: "动态调价", children: <><div className="table-toolbar"><Select placeholder="选择定价计划" style={{ width: 340 }} options={(pricing.data ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.version}` }))} value={pricingId} onChange={setPricingId} /><Button type="primary" icon={<PlusOutlined />} disabled={!pricingDetail.data} onClick={openSchedule}>新建调价计划</Button></div><QueryState loading={pricingDetail.isLoading} error={pricingDetail.error}>{pricingDetail.data ? <Tabs items={[
        { key: "versions", label: `版本 ${pricingDetail.data.versions?.length ?? 0}`, children: <Table rowKey="version" dataSource={pricingDetail.data.versions ?? []} columns={[{ title: "版本", dataIndex: "version" }, { title: "标题", dataIndex: "title" }, { title: "保存人", dataIndex: "savedBy" }, { title: "保存时间", dataIndex: "savedAt" }, { title: "原因", dataIndex: "changeReason" }]} /> },
        { key: "schedules", label: `计划 ${pricingDetail.data.schedules?.length ?? 0}`, children: <Table<PriceAdjustmentSchedule> rowKey="id" dataSource={pricingDetail.data.schedules ?? []} columns={[{ title: "生效时间", dataIndex: "effectiveAt" }, { title: "摘要", dataIndex: "summary" }, { title: "变更数", dataIndex: "changes", render: (values) => values.length }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "创建人", dataIndex: "createdBy" }, { title: "操作", render: (_, record) => record.status === "scheduled" ? <Button type="link" danger loading={cancelSchedule.isPending} onClick={() => cancelSchedule.mutate(record.id)}>取消</Button> : "—" }]} /> }
      ]} /> : <Typography.Text type="secondary">请选择定价计划。</Typography.Text>}</QueryState></> },
      { key: "dispatch", label: "高级调度", children: <><Row gutter={16}><Col xs={24} xl={8}><Card size="small" title="优化分析"><Form form={dispatchForm} layout="vertical" initialValues={{ windowDays: 7 }}><Form.Item name="windowDays" label="窗口天数"><Select options={[3, 7, 14].map((value) => ({ value, label: `${value} 天` }))} /></Form.Item><Form.Item name="storeName" label="门店"><Input /></Form.Item><Form.Item name="vehicleGroupName" label="标的分组"><Input /></Form.Item><Space><Button type="primary" loading={preview.isPending} onClick={() => dispatchForm.validateFields().then((values) => preview.mutate({ ...values, operator }))}>生成预览</Button><Button icon={<RobotOutlined />} loading={ai.isPending} onClick={() => dispatchForm.validateFields().then((values) => ai.mutate({ ...values, operator }))}>AI 分析</Button></Space></Form></Card></Col><Col xs={24} xl={8}><Card size="small" title="人工改派"><Form form={manualForm} layout="vertical" onFinish={(values) => manual.mutate(values)}><Form.Item name="orderId" label="订单" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(orders.data ?? []).map((item) => ({ value: item.id, label: `${item.orderNo} · ${item.customerName}` }))} /></Form.Item><Form.Item name="targetVehicleId" label="目标资产"><Select allowClear showSearch optionFilterProp="label" options={(assets.data?.rows ?? []).map((item) => ({ value: item.id, label: `${item.licensePlate} · ${item.vehicleGroupName}` }))} /></Form.Item><Form.Item name="reason" label="原因" rules={[{ required: true }]}><Input /></Form.Item><Button htmlType="submit" loading={manual.isPending}>执行改派</Button></Form></Card></Col><Col xs={24} xl={8}><Card size="small" title="资产不可用"><Form form={unavailableForm} layout="vertical" initialValues={{ reason: "maintenance", targetOperationStatus: "maintenance", tryAutoReassign: true }} onFinish={(values) => unavailable.mutate(values)}><Form.Item name="vehicleId" label="资产" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(assets.data?.rows ?? []).map((item) => ({ value: item.id, label: item.licensePlate }))} /></Form.Item><Form.Item name="reason" label="原因"><Select options={["disabled", "controlled", "maintenance", "accident", "license_issue", "insurance_issue", "cleaning_unready", "other"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="targetOperationStatus" label="目标状态"><Select options={["controlled", "maintenance", "disabled"].map((value) => ({ value, label: value }))} /></Form.Item><Button htmlType="submit" danger loading={unavailable.isPending}>确认不可用</Button></Form></Card></Col></Row>{dispatchPlan && <Card size="small" title={`优化方案 ${dispatchPlan.planId}`} style={{ marginTop: 16 }} extra={<Space><Button icon={<CheckOutlined />} loading={apply.isPending} onClick={() => apply.mutate()}>应用方案</Button><Button icon={<StopOutlined />} danger loading={hardLock.isPending} onClick={() => hardLock.mutate()}>硬锁订单</Button></Space>}><Table rowKey="id" dataSource={dispatchPlan.rows} columns={[{ title: "订单", dataIndex: "orderNo" }, { title: "当前资产", dataIndex: "beforeVehicle" }, { title: "目标资产", dataIndex: "targetVehicle" }, { title: "结果", dataIndex: "resultStatus", render: (value) => <Tag>{value}</Tag> }, { title: "原因", dataIndex: "reasonText" }, { title: "风险", dataIndex: "riskLevel" }]} /></Card>}<Tabs style={{ marginTop: 16 }} items={[{ key: "events", label: `事件 ${events.data?.length ?? 0}`, children: <Table rowKey="id" dataSource={events.data ?? []} columns={[{ title: "时间", dataIndex: "at" }, { title: "事件", dataIndex: "eventType" }, { title: "订单", dataIndex: "orderNo" }, { title: "操作人", dataIndex: "operator" }, { title: "说明", dataIndex: "message" }]} /> }, { key: "tasks", label: "任务关闭", children: <Table rowKey="id" dataSource={tasks.data?.tasks ?? []} columns={[{ title: "任务", dataIndex: "title" }, { title: "订单", dataIndex: "orderNo" }, { title: "状态", dataIndex: "taskStatus" }, { title: "操作", render: (_, record) => !["completed", "closed"].includes(record.taskStatus ?? "") ? <Button type="link" danger onClick={() => closeTask.mutate(record)}>关闭</Button> : "—" }]} /> }]} /></> },
      { key: "order", label: "订单辅助台账", children: <><div className="table-toolbar"><Select showSearch optionFilterProp="label" placeholder="选择订单" style={{ width: 380 }} options={(orders.data ?? []).map((item) => ({ value: item.id, label: `${item.orderNo} · ${item.customerName}` }))} value={selectedOrderId} onChange={setSelectedOrderId} /><Space>{(["fee", "transaction", "notification", "remark"] as const).map((tool) => <Button key={tool} disabled={!orderDetail.data} onClick={() => openOrderTool(tool)}>{({ fee: "新增费用", transaction: "补录交易", notification: "订单通知", remark: "新增备注" } as const)[tool]}</Button>)}</Space></div><QueryState loading={orderDetail.isLoading} error={orderDetail.error}>{orderDetail.data ? <OrderLedger detail={orderDetail.data} onWaive={(feeId, amount) => modal.confirm({ title: "确认减免费用？", onOk: () => waiveFee.mutateAsync({ feeId, amount }) })} onCloseRemark={(id) => closeRemark.mutate(id)} /> : <Typography.Text type="secondary">请选择订单查看辅助台账。</Typography.Text>}</QueryState></> },
      { key: "corporate", label: "企业月结与合同", children: <><div className="table-toolbar"><Select showSearch optionFilterProp="label" placeholder="选择企业" style={{ width: 380 }} options={(corporates.data?.rows ?? []).map((item) => ({ value: item.id, label: `${item.shortName} · ${item.fullName}` }))} value={selectedCorporateId} onChange={setSelectedCorporateId} /><Typography.Text type="secondary">结算与附件操作都写入企业审计记录。</Typography.Text></div><QueryState loading={corporate.isLoading || bills.isLoading} error={corporate.error ?? bills.error}>{corporate.data ? <CorporateLedger detail={corporate.data} bills={bills.data ?? []} onSettle={(id, balance) => { setSelectedBillId(id); corporateForm.setFieldsValue({ amount: balance, channel: "offline", note: "" }); setCorporateTool("settle"); }} onAttachment={(id) => { setSelectedContractId(id); corporateForm.setFieldsValue({ fileName: "", mimeType: "application/pdf", sizeBytes: 0 }); setCorporateTool("attachment"); }} /> : <Typography.Text type="secondary">请选择企业查看月结账单与合同。</Typography.Text>}</QueryState></> }
    ]} /></Card>

    <Drawer title="新建动态调价计划" open={scheduleOpen} size={700} destroyOnHidden onClose={() => setScheduleOpen(false)} extra={<Button type="primary" loading={scheduleMutation.isPending} onClick={() => scheduleForm.submit()}>创建计划</Button>}><Form form={scheduleForm} layout="vertical" onFinish={(values) => scheduleMutation.mutate(values)}><Form.Item name="effectiveAt" label="生效时间" rules={[{ required: true }]}><Input placeholder="ISO 时间，例如 2026-08-20T00:00:00+08:00" /></Form.Item><Form.Item name="summary" label="调整摘要" rules={[{ required: true }]}><Input /></Form.Item><Form.List name="changes">{(fields) => <Space orientation="vertical" style={{ width: "100%" }}>{fields.map(({ key, name }) => <Row key={key} gutter={12}><Col span={8}><Form.Item name={[name, "vehicleGroupCode"]} hidden><Input /></Form.Item><Form.Item name={[name, "vehicleGroupName"]} label="标的分组"><Input disabled /></Form.Item></Col><Col span={8}><Form.Item name={[name, "currentPrice"]} label="当前价格"><InputNumber disabled style={{ width: "100%" }} /></Form.Item></Col><Col span={8}><Form.Item name={[name, "newPrice"]} label="新价格"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item></Col></Row>)}</Space>}</Form.List></Form></Drawer>
    <Drawer title="订单辅助记录" open={Boolean(orderTool)} size={520} destroyOnHidden onClose={() => setOrderTool(undefined)} extra={<Button type="primary" loading={orderMutation.isPending} onClick={() => orderForm.submit()}>保存</Button>}><Form form={orderForm} layout="vertical" onFinish={(values) => orderTool && orderMutation.mutate({ tool: orderTool, values })}>{orderTool === "fee" && <><Form.Item name="code" label="费用编码"><Input /></Form.Item><Form.Item name="name" label="费用名称"><Input /></Form.Item><Form.Item name="stage" label="费用阶段"><Select options={["pickup", "rental", "return_settlement", "cancellation", "post_charge"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="direction" label="方向"><Select options={["charge", "refund", "waiver"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="amount" label="金额"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item><Form.Item name="description" label="说明"><Input.TextArea /></Form.Item></>}{orderTool === "transaction" && <><Form.Item name="type" label="交易类型"><Select options={["charge", "refund", "pre_auth", "pre_auth_release", "pre_auth_capture"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="channel" label="渠道"><Select options={["online", "offline", "internal"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="amount" label="金额"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item><Form.Item name="note" label="说明"><Input.TextArea /></Form.Item></>}{orderTool === "notification" && <><Form.Item name="scene" label="场景"><Input /></Form.Item><Form.Item name="channel" label="渠道"><Select options={["APP", "SMS", "EMAIL"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="target" label="接收方"><Input /></Form.Item><Form.Item name="content" label="内容"><Input.TextArea rows={4} /></Form.Item></>}{orderTool === "remark" && <><Form.Item name="category" label="分类"><Select options={["operation", "customer_service", "finance", "risk", "other"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="visibility" label="可见范围"><Select options={["internal", "customer"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="content" label="备注内容"><Input.TextArea rows={4} /></Form.Item></>}</Form></Drawer>
    <Drawer title={corporateTool === "settle" ? "结算月结账单" : "上传企业合同附件"} open={Boolean(corporateTool)} size={480} destroyOnHidden onClose={() => setCorporateTool(undefined)} extra={<Button type="primary" loading={corporateMutation.isPending} onClick={() => corporateForm.submit()}>确认</Button>}><Form form={corporateForm} layout="vertical" onFinish={(values) => corporateTool && corporateMutation.mutate({ tool: corporateTool, values })}>{corporateTool === "settle" ? <><Form.Item name="amount" label="结算金额"><InputNumber min={0.01} precision={2} style={{ width: "100%" }} /></Form.Item><Form.Item name="channel" label="渠道"><Select options={["online", "offline", "internal"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="note" label="说明"><Input.TextArea /></Form.Item></> : <><Form.Item name="fileName" label="文件名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="mimeType" label="文件类型"><Input /></Form.Item><Form.Item name="sizeBytes" label="文件大小（字节）"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></>}</Form></Drawer>
  </>;
}

function OrderLedger({ detail, onWaive, onCloseRemark }: { detail: StoreRentalOrderDetail; onWaive: (feeId: string, amount: number) => void; onCloseRemark: (id: string) => void }) {
  return <Tabs items={[
    { key: "fees", label: `费用 ${detail.feeLedgerItems.length}`, children: <Table rowKey="id" dataSource={detail.feeLedgerItems} columns={[{ title: "费用", render: (_, record) => `${record.name} · ${record.code}` }, { title: "阶段", dataIndex: "stage" }, { title: "方向", dataIndex: "direction" }, { title: "金额", dataIndex: "amount" }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "操作", render: (_, record) => record.status !== "waived" ? <Button type="link" danger onClick={() => onWaive(record.id, record.pendingAmount || record.amount)}>减免</Button> : "—" }]} /> },
    { key: "transactions", label: `交易 ${detail.transactionRecords.length}`, children: <Table rowKey="id" dataSource={detail.transactionRecords} columns={[{ title: "时间", dataIndex: "at" }, { title: "类型", dataIndex: "type" }, { title: "渠道", dataIndex: "channel" }, { title: "金额", dataIndex: "amount" }, { title: "操作人", dataIndex: "operator" }]} /> },
    { key: "notifications", label: `通知 ${detail.notifications.length}`, children: <Table rowKey="id" dataSource={detail.notifications} columns={[{ title: "时间", dataIndex: "at" }, { title: "场景", dataIndex: "scene" }, { title: "渠道", dataIndex: "channel" }, { title: "接收方", dataIndex: "target" }, { title: "状态", dataIndex: "status" }]} /> },
    { key: "remarks", label: `备注 ${detail.remarks.length}`, children: <Table rowKey="id" dataSource={detail.remarks} columns={[{ title: "时间", dataIndex: "at" }, { title: "分类", dataIndex: "category" }, { title: "内容", dataIndex: "content" }, { title: "状态", dataIndex: "status" }, { title: "操作", render: (_, record) => record.status === "open" ? <Button type="link" onClick={() => onCloseRemark(record.id)}>关闭</Button> : "—" }]} /> }
  ]} />;
}

function CorporateLedger({ detail, bills, onSettle, onAttachment }: { detail: CorporateDetail; bills: Awaited<ReturnType<typeof api.corporateMonthlyBills>>; onSettle: (id: string, balance: number) => void; onAttachment: (id: string) => void }) {
  return <Tabs items={[
    { key: "bills", label: `月结账单 ${bills.length}`, children: <Table rowKey="id" dataSource={bills} columns={[{ title: "账单", dataIndex: "billNo" }, { title: "账期", dataIndex: "period" }, { title: "订单数", dataIndex: "orderCount" }, { title: "总额", dataIndex: "totalAmount" }, { title: "余额", dataIndex: "balanceAmount" }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "操作", render: (_, record) => record.balanceAmount > 0 && !["paid", "void"].includes(record.status) ? <Button type="link" onClick={() => onSettle(record.id, record.balanceAmount)}>结算</Button> : "—" }]} /> },
    { key: "contracts", label: `合同 ${detail.contracts.length}`, children: <Table rowKey="id" dataSource={detail.contracts} columns={[{ title: "合同号", dataIndex: "contractNo" }, { title: "合同名称", dataIndex: "contractName" }, { title: "有效期", render: (_, record) => `${record.startDate} → ${record.endDate}` }, { title: "附件数", dataIndex: "attachments", render: (values: string[]) => values.length }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "操作", render: (_, record) => <Button type="link" onClick={() => onAttachment(record.id)}>添加附件</Button> }]} /> }
  ]} />;
}
