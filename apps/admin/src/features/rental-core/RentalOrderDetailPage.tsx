import { ArrowLeftOutlined, CheckCircleOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { RentalCoreOrderStatus, type CreateRentalInspectionRequest, type RentalInspectionTemplate } from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

export function RentalOrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [inspection, setInspection] = useState<RentalInspectionTemplate>();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [inspectionForm] = Form.useForm<Record<string, unknown> & { exceptionCode?: string; exceptionDescription?: string; exceptionChargeAmount?: number }>();
  const [cancelForm] = Form.useForm<{ reason: string; weatherException?: boolean }>();
  const order = useQuery({ queryKey: ["rental-core", "order", id], queryFn: () => rentalCoreApi.order(id), enabled: Boolean(id) });
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const templates = useQuery({ queryKey: ["rental-core", "templates"], queryFn: () => rentalCoreApi.inspectionTemplates() });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["rental-core", "order", id] }), queryClient.invalidateQueries({ queryKey: ["rental-core", "orders"] })]); };
  const action = useMutation({ mutationFn: (type: "confirm" | "allocate") => type === "confirm" ? rentalCoreApi.confirmOrder(id) : rentalCoreApi.allocateOrder(id), onSuccess: async () => { await refresh(); message.success("订单状态已更新"); }, onError: () => message.error("操作失败，请检查状态、库存或优惠券") });
  const cancel = useMutation({ mutationFn: (values: { reason: string; weatherException?: boolean }) => rentalCoreApi.cancelOrder(id, values), onSuccess: async () => { setCancelOpen(false); cancelForm.resetFields(); await refresh(); message.success("订单已取消，费用和优惠券状态已更新"); }, onError: () => message.error("取消失败，请检查规则与订单状态") });
  const handover = useMutation({ mutationFn: (stage: "pickup" | "return") => rentalCoreApi.handoverOrder(id, stage), onSuccess: async () => { await refresh(); message.success("交接已完成"); }, onError: () => message.error("当前规则要求检查，或订单状态不允许直接交接") });
  const inspect = useMutation({ mutationFn: (values: Record<string, unknown> & { exceptionCode?: string; exceptionDescription?: string; exceptionChargeAmount?: number }) => { const { exceptionCode, exceptionDescription, exceptionChargeAmount, ...results } = values; const exceptions: CreateRentalInspectionRequest["exceptions"] = exceptionDescription ? [{ code: exceptionCode || "damage", description: exceptionDescription, chargeAmount: Number(exceptionChargeAmount) || undefined }] : []; return rentalCoreApi.createInspection(id, { templateId: inspection!.id, results, exceptions }); }, onSuccess: async () => { setInspection(undefined); inspectionForm.resetFields(); await refresh(); message.success("检查记录及应计费用已保存"); }, onError: () => message.error("检查提交失败") });
  const detail = order.data;

  return <>
    <PageHeader title={detail?.orderNo ?? "订单详情"} description="订单保存价格、优惠、规则、日历、服务条款和履约检查快照。" extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/rental/orders")}>返回列表</Button>} />
    <QueryState loading={order.isLoading} error={order.error}>{detail && <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card><Descriptions column={{ xs: 1, md: 2, xl: 4 }} items={[
        { key: "status", label: "状态", children: <Tag>{detail.status}</Tag> },
        { key: "customer", label: "客户", children: detail.customerName },
        { key: "mode", label: "租赁方式", children: detail.fulfillmentMode },
        { key: "location", label: "领取/归还", children: `${detail.fulfillmentLocationName} → ${detail.returnLocationName ?? detail.fulfillmentLocationName}` },
        { key: "quote", label: "报价", children: detail.quoteNo },
        { key: "pricing", label: "价格版本", children: detail.pricingPlanVersion },
        { key: "rule", label: "规则版本", children: detail.ruleVersion },
        { key: "calendar", label: "日历版本", children: detail.calendarVersion ?? "未发布" },
        { key: "payable", label: "原应付/最终应付/押金", children: `¥${detail.payableAmount.toFixed(2)} / ¥${(detail.finalPayableAmount ?? detail.payableAmount).toFixed(2)} / ¥${detail.depositAmount.toFixed(2)}` }
      ]} /></Card>
      <Card title="商品明细"><Table rowKey="id" pagination={false} dataSource={detail.lines} columns={[{ title: "商品", dataIndex: "itemGroupName" }, { title: "数量", dataIndex: "quantity" }, { title: "租金", dataIndex: "amount", render: (value) => `¥${Number(value).toFixed(2)}` }]} /></Card>
      <Card title="费用与版本快照"><Table rowKey="code" pagination={false} dataSource={detail.chargeLines} columns={[{ title: "费用项", dataIndex: "name" }, { title: "类型", dataIndex: "type" }, { title: "来源版本", dataIndex: "sourceVersion", render: (value) => value ?? "-" }, { title: "说明", dataIndex: "detail", render: (value) => value ?? "-" }, { title: "金额", dataIndex: "amount", render: (value) => `¥${Number(value).toFixed(2)}` }]} /></Card>
      <Space>
        {detail.status === RentalCoreOrderStatus.Draft && <Button type="primary" onClick={() => action.mutate("confirm")}>确认订单并核销优惠券</Button>}
        {detail.status === RentalCoreOrderStatus.Reserved && <Button type="primary" onClick={() => action.mutate("allocate")}>执行配货</Button>}
        {detail.status === RentalCoreOrderStatus.ReadyForPickup && ((detail.ruleSnapshot?.fulfillment.pickupInspectionRequired ?? true) ? <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setInspection(templates.data?.find((item) => item.stage === "pickup"))}>{profile.data?.terminology.pickupLabel}检查</Button> : <Button type="primary" onClick={() => handover.mutate("pickup")}>直接完成{profile.data?.terminology.pickupLabel}</Button>)}
        {detail.status === RentalCoreOrderStatus.Renting && ((detail.ruleSnapshot?.fulfillment.returnInspectionRequired ?? true) ? <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => setInspection(templates.data?.find((item) => item.stage === "return"))}>{profile.data?.terminology.returnLabel}检查</Button> : <Button type="primary" onClick={() => handover.mutate("return")}>直接完成{profile.data?.terminology.returnLabel}</Button>)}
        {[RentalCoreOrderStatus.Draft, RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(detail.status) && <Button danger onClick={() => setCancelOpen(true)}>取消并按规则计费</Button>}
      </Space>
    </Space>}</QueryState>
    <Modal title={inspection?.name} open={Boolean(inspection)} onCancel={() => setInspection(undefined)} onOk={() => inspectionForm.submit()} confirmLoading={inspect.isPending} destroyOnHidden>{inspection && <Form form={inspectionForm} layout="vertical" onFinish={(values) => inspect.mutate(values)}>{inspection.fields.map((field) => <Form.Item key={field.code} name={field.code} label={field.label} rules={[{ required: field.required }]}>{field.type === "number" ? <InputNumber addonAfter={field.unit} style={{ width: "100%" }} /> : field.type === "boolean" ? <SelectBoolean /> : <Input />}</Form.Item>)}{inspection.stage === "return" && <Card size="small" title="异常与损坏计费（可选）"><Form.Item name="exceptionCode" label="异常编码"><Input placeholder="damage / missing_item / cleaning" /></Form.Item><Form.Item name="exceptionDescription" label="异常说明"><Input.TextArea rows={2} /></Form.Item><Form.Item name="exceptionChargeAmount" label="原始损失金额"><InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} /></Form.Item></Card>}</Form>}</Modal>
    <Modal title="取消租赁订单" open={cancelOpen} onCancel={() => setCancelOpen(false)} onOk={() => cancelForm.submit()} confirmLoading={cancel.isPending} destroyOnHidden><Form form={cancelForm} layout="vertical" onFinish={(values) => cancel.mutate(values)}><Form.Item name="reason" label="取消原因" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="weatherException" label="适用天气例外"><Select options={[{ value: false, label: "否" }, { value: true, label: "是" }]} /></Form.Item></Form></Modal>
  </>;
}

function SelectBoolean() {
  return <Select options={[{ value: true, label: "是 / 正常" }, { value: false, label: "否 / 异常" }]} />;
}
