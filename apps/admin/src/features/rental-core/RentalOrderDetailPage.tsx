import { ArrowLeftOutlined, CheckCircleOutlined, DollarOutlined, MinusCircleOutlined, PlusOutlined, RetweetOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { RentalCoreOrderStatus, type CreateRentalInspectionRequest, type RentalAllocation, type RentalFundingAction, type RentalFundingInstrument, type RentalInspectionTemplate, type RentalReservation } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

type FundingOperation = {
  instrument: RentalFundingInstrument;
  action: RentalFundingAction;
};

const FUNDING_ACTION_LABELS: Record<RentalFundingAction, string> = {
  initiate: "发起",
  append: "追加",
  capture: "抵扣",
  refund: "退款",
  release: "释放",
  fail: "记录失败"
};

const FUNDING_INSTRUMENT_LABELS: Record<RentalFundingInstrument, string> = {
  deposit: "押金",
  preauthorization: "预授权"
};

export function RentalOrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canViewFunding = hasPermission("store-rental:order:view") || hasPermission("store-rental:order:settle");
  const canSettleFunding = hasPermission("store-rental:order:settle");
  const [inspection, setInspection] = useState<RentalInspectionTemplate>();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [substitution, setSubstitution] = useState<{ orderLineId: string; fromItemGroupId: string }>();
  const [partialReturnOpen, setPartialReturnOpen] = useState(false);
  const [fundingOperation, setFundingOperation] = useState<FundingOperation>();
  const [exceptionReview, setExceptionReview] = useState<{ inspectionId: string; exceptionIndex: number; description: string; suggested?: number }>();
  const [inspectionForm] = Form.useForm<Record<string, unknown> & { exceptionCode?: string; exceptionDescription?: string; exceptionChargeAmount?: number }>();
  const [cancelForm] = Form.useForm<{ reason: string; weatherException?: boolean }>();
  const [substitutionForm] = Form.useForm<{ toItemGroupId: string }>();
  const [partialReturnForm] = Form.useForm<{ items: Array<{ allocationId: string; quantity: number }> }>();
  const [fundingForm] = Form.useForm<{ amount?: number; reason: string; failureCode?: string }>();
  const [exceptionReviewForm] = Form.useForm<{ decision: "approved" | "rejected"; approvedChargeAmount?: number; reason: string }>();
  const order = useQuery({ queryKey: ["rental-core", "order", id], queryFn: () => rentalCoreApi.order(id), enabled: Boolean(id) });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const templates = useQuery({ queryKey: ["rental-core", "templates"], queryFn: () => rentalCoreApi.inspectionTemplates() });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const funding = useQuery({ queryKey: ["rental-core", "order", id, "funding"], queryFn: () => rentalCoreApi.fundingEvents(id), enabled: Boolean(id) && canViewFunding });
  const inspections = useQuery({ queryKey: ["rental-core", "order", id, "inspections"], queryFn: () => rentalCoreApi.inspections(id), enabled: Boolean(id) });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "orders"] })]); };
  const action = useMutation({ mutationFn: (type: "confirm" | "allocate") => type === "confirm" ? rentalCoreApi.confirmOrder(id) : rentalCoreApi.allocateOrder(id), onSuccess: async () => { await refresh(); message.success("订单状态已更新"); }, onError: () => message.error("操作失败，请检查状态、库存或优惠券") });
  const cancel = useMutation({ mutationFn: (values: { reason: string; weatherException?: boolean }) => rentalCoreApi.cancelOrder(id, values), onSuccess: async () => { setCancelOpen(false); cancelForm.resetFields(); await refresh(); message.success("订单已取消，费用和优惠券状态已更新"); }, onError: () => message.error("取消失败，请检查规则与订单状态") });
  const handover = useMutation({ mutationFn: (stage: "pickup" | "return") => rentalCoreApi.handoverOrder(id, stage), onSuccess: async () => { await refresh(); message.success("交接已完成"); }, onError: () => message.error("当前规则要求检查，或订单状态不允许直接交接") });
  const settle = useMutation({ mutationFn: () => rentalCoreApi.settleOrder(id), onSuccess: async () => { await refresh(); await queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] }); message.success("订单已结算并关闭"); }, onError: () => message.error("结算失败，请先处理全部押金和预授权余额") });
  const substitute = useMutation({ mutationFn: (values: { toItemGroupId: string }) => rentalCoreApi.substituteBundleComponent(id, { ...substitution!, toItemGroupId: values.toItemGroupId }), onSuccess: async () => { setSubstitution(undefined); substitutionForm.resetFields(); await refresh(); message.success("套装组成已替换并重新预占"); }, onError: () => message.error("替换失败，请检查替代组、订单状态和候选库存") });
  const partialReturn = useMutation({ mutationFn: rentalCoreApi.partialReturnOrder.bind(null, id), onSuccess: async () => { setPartialReturnOpen(false); partialReturnForm.resetFields(); await refresh(); message.success("部分归还已完成，剩余项目继续在租"); }, onError: () => message.error("部分归还失败；最后一批请使用归还检查或整单归还") });
  const inspect = useMutation({ mutationFn: (values: Record<string, unknown> & { exceptionCode?: string; exceptionDescription?: string; exceptionChargeAmount?: number }) => { const { exceptionCode, exceptionDescription, exceptionChargeAmount, ...results } = values; const exceptions: CreateRentalInspectionRequest["exceptions"] = exceptionDescription ? [{ code: exceptionCode || "damage", description: exceptionDescription, chargeAmount: Number(exceptionChargeAmount) || undefined }] : []; return rentalCoreApi.createInspection(id, { templateId: inspection!.id, results, exceptions }); }, onSuccess: async () => { setInspection(undefined); inspectionForm.resetFields(); await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "inspections"] })]); message.success("检查记录已保存；异常建议须由结算人员审核后才计费"); }, onError: () => message.error("检查提交失败") });
  const fundingAction = useMutation({
    mutationFn: async (values: { amount?: number; reason: string; failureCode?: string }) => {
      const operation = fundingOperation!;
      const idempotencyKey = crypto.randomUUID();
      if (operation.action === "initiate") return rentalCoreApi.initiateFunding(id, { instrument: operation.instrument, idempotencyKey, reason: values.reason });
      if (operation.action === "release") return rentalCoreApi.releaseFunding(id, { idempotencyKey, reason: values.reason });
      if (operation.action === "fail") return rentalCoreApi.failFunding(id, { instrument: operation.instrument, failureCode: values.failureCode!, idempotencyKey, reason: values.reason });
      const request = { instrument: operation.instrument, amount: Number(values.amount), idempotencyKey, reason: values.reason };
      if (operation.action === "append") return rentalCoreApi.appendFunding(id, request);
      if (operation.action === "capture") return rentalCoreApi.captureFunding(id, request);
      return rentalCoreApi.refundFunding(id, request);
    },
    onSuccess: async () => {
      setFundingOperation(undefined);
      fundingForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "funding"] });
      message.success("模拟资金事件已记录");
    },
    onError: () => message.error("操作失败，请检查当前余额、动作顺序和订单范围")
  });
  const reviewException = useMutation({
    mutationFn: (values: { decision: "approved" | "rejected"; approvedChargeAmount?: number; reason: string }) => rentalCoreApi.reviewInspectionException(id, exceptionReview!.inspectionId, exceptionReview!.exceptionIndex, values),
    onSuccess: async () => {
      setExceptionReview(undefined);
      exceptionReviewForm.resetFields();
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id, "inspections"] })]);
      message.success("检查异常已审核");
    },
    onError: () => message.error("审核失败，请检查订单状态或该异常是否已处理")
  });
  const detail = order.data;
  const substitutionLine = detail?.lines.find((line) => line.id === substitution?.orderLineId);
  const substitutionBundle = groups.data?.find((group) => group.id === substitutionLine?.itemGroupId);
  const substitutionSource = substitutionBundle?.bundleComponents.find((component) => component.itemGroupId === substitution?.fromItemGroupId);
  const substitutionOptions = substitutionBundle?.bundleComponents.filter((component) => component.substitutionGroup && component.substitutionGroup === substitutionSource?.substitutionGroup && component.itemGroupId !== substitutionSource?.itemGroupId).map((component) => ({ value: component.itemGroupId, label: `${component.itemGroupCode} · ${component.itemGroupName} × ${component.quantity}` })) ?? [];
  const canSubstituteReservation = (row: { orderLineId: string; itemGroupId: string }) => {
    const line = detail?.lines.find((item) => item.id === row.orderLineId);
    const bundle = groups.data?.find((group) => group.id === line?.itemGroupId);
    const component = bundle?.bundleComponents.find((item) => item.itemGroupId === row.itemGroupId);
    return Boolean(component?.substitutionGroup && bundle?.bundleComponents.some((item) => item.substitutionGroup === component.substitutionGroup && item.itemGroupId !== component.itemGroupId));
  };

  return <>
    <PageHeader title={detail?.orderNo ?? "订单详情"} description="订单保存价格、优惠、规则、日历、服务条款和履约检查快照。" extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/rental/orders")}>返回列表</Button>} />
    <QueryState loading={order.isLoading} error={order.error}>{detail && <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card><Descriptions column={{ xs: 1, md: 2, xl: 4 }} items={[
        { key: "status", label: "状态", children: <Tag>{detail.status}</Tag> },
        { key: "customer", label: "客户", children: detail.customerName },
        { key: "mode", label: "租赁方式", children: detail.fulfillmentMode },
        { key: "location", label: "领取/归还", children: `${detail.fulfillmentLocationSnapshot.name}（${detail.fulfillmentLocationSnapshot.operator.name}） → ${detail.returnLocationSnapshot.name}（${detail.returnLocationSnapshot.operator.name}）` },
        { key: "quote", label: "报价", children: detail.quoteNo },
        { key: "pricing", label: "价格版本", children: detail.pricingPlanVersion },
        { key: "rule", label: "规则版本", children: detail.ruleVersion },
        { key: "calendar", label: "日历版本", children: detail.calendarVersion ?? "未发布" },
        { key: "payable", label: "原应付/最终应付/押金", children: `¥${detail.payableAmount.toFixed(2)} / ¥${(detail.finalPayableAmount ?? detail.payableAmount).toFixed(2)} / ¥${detail.depositAmount.toFixed(2)}` }
      ]} /></Card>
      <Card title="商品明细"><Table rowKey="id" pagination={false} dataSource={detail.lines} columns={[{ title: "商品", dataIndex: "itemGroupName" }, { title: "数量", dataIndex: "quantity" }, { title: "租金", dataIndex: "amount", render: (value) => `¥${Number(value).toFixed(2)}` }]} /></Card>
      <Card title="库存拆分与归还">{detail.allocations.length ? <Table<RentalAllocation> rowKey="id" pagination={false} dataSource={detail.allocations} columns={[
        { title: "实际商品", render: (_, row) => groups.data?.find((group) => group.id === row.itemGroupId)?.name ?? row.assetNo ?? "历史分配" },
        { title: "资产 / 数量", render: (_, row) => row.assetNo ?? `${row.quantity} 件` },
        { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }
      ]} /> : <Table<RentalReservation> rowKey="id" pagination={false} dataSource={detail.reservations} columns={[
        { title: "实际预占商品", render: (_, row) => groups.data?.find((group) => group.id === row.itemGroupId)?.name ?? row.itemGroupId },
        { title: "数量", render: (_, row) => `${Math.max(0, row.quantity - row.releasedQuantity)} / ${row.quantity}` },
        { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
        { title: "操作", render: (_, row) => detail.status === RentalCoreOrderStatus.Reserved && canSubstituteReservation(row) ? <Button type="link" icon={<RetweetOutlined />} onClick={() => setSubstitution({ orderLineId: row.orderLineId, fromItemGroupId: row.itemGroupId })}>替换组成</Button> : "-" }
      ]} />}</Card>
      <Card title="费用与版本快照"><Table rowKey="code" pagination={false} dataSource={detail.chargeLines} columns={[{ title: "费用项", dataIndex: "name" }, { title: "类型", dataIndex: "type" }, { title: "来源版本", dataIndex: "sourceVersion", render: (value) => value ?? "-" }, { title: "说明", dataIndex: "detail", render: (value) => value ?? "-" }, { title: "金额", dataIndex: "amount", render: (value) => `¥${Number(value).toFixed(2)}` }]} /></Card>
      <Card title="检查、使用量与异常审核"><Space direction="vertical" style={{ width: "100%" }} size={16}>
        <Table rowKey={(row) => `${row.inspectionId}:${row.fieldCode}`} size="small" pagination={false} dataSource={(inspections.data ?? []).flatMap((record) => (record.usageReadings ?? []).map((reading) => ({ ...reading, inspectionId: record.id, stage: record.stage })))} columns={[
          { title: "阶段", dataIndex: "stage", render: (value) => value === "pickup" ? "领取基线" : "归还读数" },
          { title: "读数字段", dataIndex: "fieldCode" },
          { title: "领取基线", dataIndex: "baseline", render: (value) => value ?? "-" },
          { title: "归还原始值", dataIndex: "current" },
          { title: "使用量", dataIndex: "delta", render: (value) => value ?? "-" }
        ]} />
        <Table rowKey={(row) => `${row.inspectionId}:${row.exceptionIndex}`} pagination={false} dataSource={(inspections.data ?? []).flatMap((record) => record.exceptions.map((exception, exceptionIndex) => ({ ...exception, inspectionId: record.id, exceptionIndex, stage: record.stage, operator: record.operator })))} columns={[
        { title: "阶段", dataIndex: "stage", render: (value) => value === "pickup" ? "领取" : "归还" },
        { title: "异常", render: (_, row) => `${row.code} · ${row.description}` },
        { title: "建议费用", dataIndex: "suggestedChargeAmount", render: (value) => value === undefined ? "-" : `¥${Number(value).toFixed(2)}` },
        { title: "审核", dataIndex: "reviewStatus", render: (value) => <Tag color={value === "approved" ? "green" : value === "rejected" ? "default" : "orange"}>{value === "approved" ? "已通过" : value === "rejected" ? "已驳回" : "待审核"}</Tag> },
        { title: "最终费用", dataIndex: "approvedChargeAmount", render: (value) => value === undefined ? "-" : `¥${Number(value).toFixed(2)}` },
        { title: "操作", render: (_, row) => canSettleFunding && row.reviewStatus === "pending" ? <Button type="link" onClick={() => { setExceptionReview({ inspectionId: row.inspectionId, exceptionIndex: row.exceptionIndex, description: row.description, suggested: row.suggestedChargeAmount }); exceptionReviewForm.setFieldsValue({ decision: "approved", approvedChargeAmount: row.suggestedChargeAmount }); }}>审核</Button> : "-" }
        ]} />
      </Space></Card>
      {canViewFunding && <Card title={<Space><DollarOutlined />押金与预授权 <Tag color="orange">模拟资金</Tag></Space>}>
        <Alert type="warning" showIcon message="当前未接入真实支付机构；以下操作只记录可追溯的模拟资金事件，不代表真实收款、冻结或退款。" style={{ marginBottom: 16 }} />
        <Descriptions column={{ xs: 1, md: 2 }} items={[
          { key: "deposit", label: `应收押金 ¥${detail.depositAmount.toFixed(2)}`, children: funding.data ? `已收 ¥${funding.data.deposit.collected.toFixed(2)} / 已抵扣 ¥${funding.data.deposit.captured.toFixed(2)} / 已退 ¥${funding.data.deposit.refunded.toFixed(2)} / 余额 ¥${funding.data.deposit.balance.toFixed(2)}` : "加载中" },
          { key: "preauth", label: `应冻结预授权 ¥${detail.preAuthAmount.toFixed(2)}`, children: funding.data ? `已冻结 ¥${funding.data.preauthorization.frozen.toFixed(2)} / 已转扣 ¥${funding.data.preauthorization.captured.toFixed(2)} / 已释放 ¥${funding.data.preauthorization.released.toFixed(2)} / 余额 ¥${funding.data.preauthorization.balance.toFixed(2)}` : "加载中" }
        ]} />
        {canSettleFunding && <Space wrap style={{ margin: "12px 0" }}>
          {detail.depositAmount > 0 && !funding.data?.deposit.collected && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "initiate" })}>模拟收取押金</Button>}
          {(funding.data?.deposit.collected ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "append" })}>追加押金</Button>}
          {(funding.data?.deposit.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "capture" })}>押金抵扣</Button>}
          {(funding.data?.deposit.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "deposit", action: "refund" })}>押金退款</Button>}
          {detail.preAuthAmount > 0 && !funding.data?.preauthorization.frozen && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "initiate" })}>模拟冻结预授权</Button>}
          {(funding.data?.preauthorization.frozen ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "append" })}>追加预授权</Button>}
          {(funding.data?.preauthorization.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "capture" })}>预授权转扣</Button>}
          {(funding.data?.preauthorization.balance ?? 0) > 0 && <Button onClick={() => setFundingOperation({ instrument: "preauthorization", action: "release" })}>释放全部预授权</Button>}
          <Button danger onClick={() => setFundingOperation({ instrument: detail.preAuthAmount > 0 ? "preauthorization" : "deposit", action: "fail" })}>记录资金失败</Button>
        </Space>}
        <Table rowKey="id" size="small" pagination={false} loading={funding.isLoading} dataSource={funding.data?.events ?? []} columns={[
          { title: "时间", dataIndex: "at", render: (value) => new Date(String(value)).toLocaleString() },
          { title: "对象", dataIndex: "instrument", render: (value) => FUNDING_INSTRUMENT_LABELS[value as RentalFundingInstrument] },
          { title: "动作", dataIndex: "action", render: (value) => FUNDING_ACTION_LABELS[value as RentalFundingAction] },
          { title: "金额", dataIndex: "amount", render: (value) => `¥${Number(value).toFixed(2)}` },
          { title: "事件后余额", dataIndex: "balanceAfter", render: (value) => `¥${Number(value).toFixed(2)}` },
          { title: "原因", dataIndex: "reason" },
          { title: "状态", render: (_, row) => <Tag color={row.action === "fail" ? "red" : "orange"}>{row.action === "fail" ? `失败 · ${row.failureCode}` : "模拟成功"}</Tag> }
        ]} />
      </Card>}
      <Space>
        {detail.status === RentalCoreOrderStatus.Draft && <Button type="primary" onClick={() => action.mutate("confirm")}>确认订单并核销优惠券</Button>}
        {detail.status === RentalCoreOrderStatus.Reserved && <Button type="primary" onClick={() => action.mutate("allocate")}>执行配货</Button>}
        {detail.status === RentalCoreOrderStatus.ReadyForPickup && ((detail.ruleSnapshot?.fulfillment.pickupInspectionRequired ?? true) ? <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setInspection(templates.data?.find((item) => item.stage === "pickup"))}>{profile.data?.terminology.pickupLabel}检查</Button> : <Button type="primary" onClick={() => handover.mutate("pickup")}>直接完成{profile.data?.terminology.pickupLabel}</Button>)}
        {detail.status === RentalCoreOrderStatus.Renting && ((detail.ruleSnapshot?.fulfillment.returnInspectionRequired ?? true) ? <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => setInspection(templates.data?.find((item) => item.stage === "return"))}>{profile.data?.terminology.returnLabel}检查</Button> : <Button type="primary" onClick={() => handover.mutate("return")}>直接完成{profile.data?.terminology.returnLabel}</Button>)}
        {detail.status === RentalCoreOrderStatus.Renting && (detail.allocations.filter((allocation) => allocation.status === "picked_up").length > 1 || detail.allocations.some((allocation) => allocation.status === "picked_up" && allocation.quantity > 1)) && <Button onClick={() => { partialReturnForm.setFieldsValue({ items: [{ allocationId: "", quantity: 1 }] }); setPartialReturnOpen(true); }}>部分归还</Button>}
        {detail.status === RentalCoreOrderStatus.Settling && canSettleFunding && <Button type="primary" loading={settle.isPending} onClick={() => settle.mutate()}>结算并关闭订单</Button>}
        {[RentalCoreOrderStatus.Draft, RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(detail.status) && <Button danger onClick={() => setCancelOpen(true)}>取消并按规则计费</Button>}
      </Space>
    </Space>}</QueryState>
    <Modal title={inspection?.name} open={Boolean(inspection)} onCancel={() => setInspection(undefined)} onOk={() => inspectionForm.submit()} confirmLoading={inspect.isPending} destroyOnHidden>{inspection && <Form form={inspectionForm} layout="vertical" onFinish={(values) => inspect.mutate(values)}>{inspection.fields.map((field) => <Form.Item key={field.code} name={field.code} label={field.label} rules={[{ required: field.required }]}>{field.type === "number" ? <InputNumber addonAfter={field.unit} style={{ width: "100%" }} /> : field.type === "boolean" ? <SelectBoolean /> : <Input />}</Form.Item>)}{inspection.stage === "return" && <Card size="small" title="异常与损坏建议（可选）"><Alert type="info" showIcon message="检查员只记录事实和建议损失额，不会直接向客户计费。" style={{ marginBottom: 12 }} /><Form.Item name="exceptionCode" label="异常编码"><Input placeholder="damage / missing_item / cleaning" /></Form.Item><Form.Item name="exceptionDescription" label="异常说明"><Input.TextArea rows={2} /></Form.Item><Form.Item name="exceptionChargeAmount" label="建议损失金额"><InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} /></Form.Item></Card>}</Form>}</Modal>
    <Modal title="取消租赁订单" open={cancelOpen} onCancel={() => setCancelOpen(false)} onOk={() => cancelForm.submit()} confirmLoading={cancel.isPending} destroyOnHidden><Form form={cancelForm} layout="vertical" onFinish={(values) => cancel.mutate(values)}><Form.Item name="reason" label="取消原因" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="weatherException" label="适用天气例外"><Select options={[{ value: false, label: "否" }, { value: true, label: "是" }]} /></Form.Item></Form></Modal>
    <Modal title="替换套装组成" open={Boolean(substitution)} onCancel={() => setSubstitution(undefined)} onOk={() => substitutionForm.submit()} confirmLoading={substitute.isPending} destroyOnHidden><Form form={substitutionForm} layout="vertical" onFinish={(values) => substitute.mutate(values)}><Form.Item label="当前组成"><Input disabled value={groups.data?.find((group) => group.id === substitution?.fromItemGroupId)?.name} /></Form.Item><Form.Item name="toItemGroupId" label="替代商品" rules={[{ required: true }]}><Select options={substitutionOptions} placeholder="选择同一替代组的候选商品" /></Form.Item></Form></Modal>
    <Modal title="部分归还" open={partialReturnOpen} onCancel={() => setPartialReturnOpen(false)} onOk={() => partialReturnForm.submit()} confirmLoading={partialReturn.isPending} destroyOnHidden><Form form={partialReturnForm} layout="vertical" onFinish={(values) => partialReturn.mutate(values)}><Form.List name="items">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: "100%" }}>{fields.map((field) => <Space key={field.key} align="start"><Form.Item {...field} name={[field.name, "allocationId"]} rules={[{ required: true }]}><Select style={{ width: 320 }} placeholder="选择待归还资产或数量项" options={detail?.allocations.filter((allocation) => allocation.status === "picked_up").map((allocation) => ({ value: allocation.id, label: allocation.assetNo ?? `${groups.data?.find((group) => group.id === allocation.itemGroupId)?.name ?? "数量库存"} · 剩余 ${allocation.quantity}` }))} /></Form.Item><Form.Item {...field} name={[field.name, "quantity"]} rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: 100 }} /></Form.Item><Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} /></Space>)}<Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>增加归还项</Button></Space>}</Form.List></Form></Modal>
    <Modal title={fundingOperation ? `${FUNDING_ACTION_LABELS[fundingOperation.action]}${FUNDING_INSTRUMENT_LABELS[fundingOperation.instrument]}（模拟）` : "模拟资金操作"} open={Boolean(fundingOperation)} onCancel={() => { setFundingOperation(undefined); fundingForm.resetFields(); }} onOk={() => fundingForm.submit()} confirmLoading={fundingAction.isPending} destroyOnHidden>
      <Alert type="warning" showIcon message="本操作仅写入模拟资金流水，不会发起真实扣款或冻结。" style={{ marginBottom: 16 }} />
      <Form form={fundingForm} layout="vertical" onFinish={(values) => fundingAction.mutate(values)}>
        {fundingOperation && !["initiate", "release", "fail"].includes(fundingOperation.action) && <Form.Item name="amount" label="金额" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} prefix="¥" style={{ width: "100%" }} /></Form.Item>}
        {fundingOperation?.action === "fail" && <Form.Item name="failureCode" label="失败原因码" rules={[{ required: true }]}><Input placeholder="例如 provider_timeout" /></Form.Item>}
        <Form.Item name="reason" label="操作原因" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="审核检查异常" open={Boolean(exceptionReview)} onCancel={() => { setExceptionReview(undefined); exceptionReviewForm.resetFields(); }} onOk={() => exceptionReviewForm.submit()} confirmLoading={reviewException.isPending} destroyOnHidden>
      <Alert type="info" showIcon message={exceptionReview?.description} description={`检查员建议费用：${exceptionReview?.suggested === undefined ? "未填写" : `¥${exceptionReview.suggested.toFixed(2)}`}。最终费用由具备结算权限的人员确认。`} style={{ marginBottom: 16 }} />
      <Form form={exceptionReviewForm} layout="vertical" onFinish={(values) => reviewException.mutate(values)}>
        <Form.Item name="decision" label="审核结论" rules={[{ required: true }]}><Select options={[{ value: "approved", label: "通过并计费" }, { value: "rejected", label: "驳回，不计费" }]} /></Form.Item>
        <Form.Item noStyle shouldUpdate={(before, after) => before.decision !== after.decision}>{({ getFieldValue }) => getFieldValue("decision") === "approved" ? <Form.Item name="approvedChargeAmount" label="最终费用" rules={[{ required: true }]}><InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} /></Form.Item> : null}</Form.Item>
        <Form.Item name="reason" label="审核理由" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
  </>;
}

function SelectBoolean() {
  return <Select options={[{ value: true, label: "是 / 正常" }, { value: false, label: "否 / 异常" }]} />;
}
