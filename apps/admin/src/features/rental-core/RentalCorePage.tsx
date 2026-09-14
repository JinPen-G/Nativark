import { ApartmentOutlined, CheckCircleOutlined, InfoCircleOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { RentalCoreOrderStatus, RentalInventoryMode, formatRentalMoney, type CreateRentalOrderRequest, type RentalInspectionTemplate, type RentalOrder } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

type OrderForm = Omit<CreateRentalOrderRequest, "quoteId" | "startAt" | "endAt" | "lines"> & { period: [Dayjs, Dayjs]; lines: Array<{ itemGroupId: string; quantity: number; note?: string }> };
const orderStatus: Record<string, { label: string; color: string }> = {
  draft: { label: "软预占", color: "default" }, reserved: { label: "已确认", color: "processing" },
  pickup_overdue: { label: "待确认爽约", color: "warning" },
  ready_for_pickup: { label: "待取件", color: "cyan" }, renting: { label: "租赁中", color: "blue" },
  return_inspection: { label: "归还检查", color: "orange" }, settling: { label: "待结算", color: "gold" }, completed: { label: "已关闭", color: "success" }, cancelled: { label: "已取消", color: "default" }, no_show: { label: "已爽约", color: "error" }
};
const modeLabel: Record<string, string> = { serialized: "序列化资产", quantity: "数量库存", consumable: "一次性耗材", bundle: "套装" };

export function RentalCorePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [orderOpen, setOrderOpen] = useState(false);
  const [detail, setDetail] = useState<RentalOrder>();
  const [inspection, setInspection] = useState<{ order: RentalOrder; template: RentalInspectionTemplate }>();
  const [orderForm] = Form.useForm<OrderForm>();
  const [inspectionForm] = Form.useForm<Record<string, unknown>>();
  const profile = useQuery({ queryKey: ["rental-core", "profile"], queryFn: rentalCoreApi.profile });
  const settings = useQuery({ queryKey: ["rental-core", "business-settings"], queryFn: rentalCoreApi.businessSettings });
  const categories = useQuery({ queryKey: ["rental-core", "categories"], queryFn: rentalCoreApi.categories });
  const locations = useQuery({ queryKey: ["rental-core", "locations"], queryFn: rentalCoreApi.locations });
  const groups = useQuery({ queryKey: ["rental-core", "groups"], queryFn: rentalCoreApi.itemGroups });
  const assets = useQuery({ queryKey: ["rental-core", "assets"], queryFn: rentalCoreApi.assets });
  const stocks = useQuery({ queryKey: ["rental-core", "stocks"], queryFn: rentalCoreApi.stockBalances });
  const orders = useQuery({ queryKey: ["rental-core", "orders"], queryFn: rentalCoreApi.orders });
  const templates = useQuery({ queryKey: ["rental-core", "templates"], queryFn: () => rentalCoreApi.inspectionTemplates() });
  const refreshOrders = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rental-core", "orders"] }),
      queryClient.invalidateQueries({ queryKey: ["rental-core", "assets"] }),
      queryClient.invalidateQueries({ queryKey: ["rental-core", "stocks"] })
    ]);
  };
  const create = useMutation({ mutationFn: rentalCoreApi.createOrder, onSuccess: async (result) => { await refreshOrders(); setOrderOpen(false); orderForm.resetFields(); setDetail(result); message.success("订单已创建，库存软预占 15 分钟"); }, onError: () => message.error("订单创建失败，请检查库存和时间段") });
  const action = useMutation({ mutationFn: ({ id, type }: { id: string; type: "confirm" | "allocate" | "cancel" }) => type === "confirm" ? rentalCoreApi.confirmOrder(id) : type === "allocate" ? rentalCoreApi.allocateOrder(id) : rentalCoreApi.cancelOrder(id, { reason: "运营端取消" }), onSuccess: async (result) => { await refreshOrders(); setDetail(result); message.success("订单状态已更新"); }, onError: () => message.error("操作失败，请检查订单状态、库存或业务规则") });
  const submitInspection = useMutation({ mutationFn: ({ orderId, templateId, results }: { orderId: string; templateId: string; results: Record<string, unknown> }) => rentalCoreApi.createInspection(orderId, { templateId, results }), onSuccess: async (result) => { await refreshOrders(); setDetail(result.order); setInspection(undefined); inspectionForm.resetFields(); message.success("检查已完成，履约状态已推进"); }, onError: () => message.error("检查提交失败，请填写所有必填项") });
  const currentCategory = categories.data?.find((row) => row.code === profile.data?.categoryCode);
  const counts = useMemo(() => ({ serialized: groups.data?.filter((row) => row.inventoryMode === RentalInventoryMode.Serialized).length ?? 0, quantity: groups.data?.filter((row) => row.inventoryMode === RentalInventoryMode.Quantity).length ?? 0, consumable: groups.data?.filter((row) => row.inventoryMode === RentalInventoryMode.Consumable).length ?? 0, bundle: groups.data?.filter((row) => row.inventoryMode === RentalInventoryMode.Bundle).length ?? 0 }), [groups.data]);

  async function submitOrder(values: OrderForm) {
    try {
      const startAt = values.period[0].toISOString();
      const endAt = values.period[1].toISOString();
      const lines = values.lines.map(({ itemGroupId, quantity, note }) => ({ itemGroupId, quantity: Number(quantity), note }));
      const quote = await rentalCoreApi.createQuote({ customerType: values.customerType, customerId: values.customerId, fulfillmentMode: values.fulfillmentMode, fulfillmentLocationId: values.fulfillmentLocationId, returnLocationId: values.returnLocationId, startAt, endAt, lines });
      create.mutate({ quoteId: quote.id, customerType: values.customerType, customerId: values.customerId, customerName: values.customerName, contactPhone: values.contactPhone, qualificationApproved: values.qualificationApproved, qualificationValidTo: values.qualificationValidTo, fulfillmentMode: quote.request.fulfillmentMode, fulfillmentLocationId: values.fulfillmentLocationId, returnLocationId: values.returnLocationId, startAt, endAt, lines });
    } catch { message.error("服务端报价失败，请先维护已启用的基础定价与规则"); }
  }
  function startInspection(order: RentalOrder, stage: "pickup" | "return") {
    const template = templates.data?.find((row) => row.stage === stage);
    if (!template) return message.warning("当前品类没有启用的检查模板");
    inspectionForm.resetFields(); setInspection({ order, template });
  }
  const itemOptions = (groups.data ?? []).filter((row) => row.status === "enabled").map((row) => ({ value: row.id, label: `${row.code} · ${row.name}（${modeLabel[row.inventoryMode]}）` }));

  return (
    <>
      <PageHeader title="Rental Core v0.1" description="租户品类、四种库存模式（含一次性耗材）、多行订单、服务端报价、预占配货和动态检查。" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { orderForm.setFieldsValue({ customerType: "personal", fulfillmentMode: settings.data?.fulfillment.enabledModes[0] ?? "store_pickup_return", fulfillmentLocationId: locations.data?.[0]?.id, period: [dayjs().add(1, "day").hour(9), dayjs().add(2, "day").hour(18)], lines: [{ itemGroupId: groups.data?.[0]?.id ?? "", quantity: 1 }] }); setOrderOpen(true); }}>新建 Core 订单</Button>} />
      <div className="context-note"><InfoCircleOutlined /><span>摄影、露营、车辆和工程设备统一使用 Rental Core；车辆专属能力通过 capability 扩展，不读取旧租赁业务数据。demo 为摄影样本、demo2 为露营样本。</span></div>
      <QueryState loading={profile.isLoading || groups.isLoading} error={profile.error || groups.error}>
        <div className="metric-grid">
          <Card className="metric-card"><Statistic title="当前经营品类" value={currentCategory?.name ?? profile.data?.categoryCode ?? "-"} prefix={<ApartmentOutlined />} /><div className="metric-foot"><span>单空间单品类</span><span className="metric-trend">已配置</span></div></Card>
          <Card className="metric-card"><Statistic title="序列化分组" value={counts.serialized} /><div className="metric-foot"><span>独立资产追踪</span><span>Serialized</span></div></Card>
          <Card className="metric-card"><Statistic title="数量型分组" value={counts.quantity} /><div className="metric-foot"><span>数量库存核算</span><span>Quantity</span></div></Card>
          <Card className="metric-card"><Statistic title="一次性耗材" value={counts.consumable} /><div className="metric-foot"><span>领取即扣减库存</span><span>Consumable</span></div></Card>
          <Card className="metric-card"><Statistic title="套装分组" value={counts.bundle} /><div className="metric-foot"><span>组成项自动占用</span><span>Bundle</span></div></Card>
        </div>
        <Tabs className="standalone-tabs" items={[
          { key: "profile", label: "租户品类", children: <Row gutter={16}><Col xs={24} lg={12}><Card title="品类配置"><Descriptions column={1} items={[{ key: "category", label: "经营品类", children: currentCategory?.name }, { key: "version", label: "配置版本", children: profile.data?.configVersion }, { key: "item", label: "业务术语", children: `${profile.data?.terminology.itemGroupLabel} / ${profile.data?.terminology.assetLabel} / ${profile.data?.terminology.fulfillmentLabel}` }, { key: "flow", label: "履约术语", children: `${profile.data?.terminology.pickupLabel} → ${profile.data?.terminology.returnLabel}` }]} /></Card></Col><Col xs={24} lg={12}><Card title="启用能力"><Space wrap>{profile.data?.capabilities.map((value) => <Tag color="blue" key={value}>{value}</Tag>)}</Space><Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>品类一旦产生标的或订单便不能直接切换，避免跨领域数据失真。</Typography.Paragraph></Card></Col></Row> },
          { key: "inventory", label: "标的与库存", children: <Space orientation="vertical" size={16} style={{ width: "100%" }}><Card title="标的分组"><Table rowKey="id" pagination={false} dataSource={groups.data ?? []} columns={[{ title: "编码", dataIndex: "code", render: (value) => <b>{value}</b> }, { title: "名称", dataIndex: "name" }, { title: "库存模式", dataIndex: "inventoryMode", render: (value) => <Tag color={value === "bundle" ? "purple" : value === "consumable" ? "volcano" : value === "quantity" ? "gold" : "blue"}>{modeLabel[value]}</Tag> }, { title: "单位", dataIndex: "unit" }, { title: "套装组成", dataIndex: "bundleComponents", render: (rows) => rows?.length ? rows.map((row: { itemGroupName: string; quantity: number }) => `${row.itemGroupName}×${row.quantity}`).join("，") : "-" }]} /></Card><Row gutter={16}><Col xs={24} xl={12}><Card title={`序列化资产（${assets.data?.length ?? 0}）`}><Table size="small" rowKey="id" pagination={false} dataSource={assets.data ?? []} columns={[{ title: "资产编号", dataIndex: "assetNo" }, { title: "标的", dataIndex: "itemGroupName" }, { title: "位置", dataIndex: "locationName" }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }]} locale={{ emptyText: <Empty description="当前品类未使用序列化库存" /> }} /></Card></Col><Col xs={24} xl={12}><Card title={`数量与耗材库存（${stocks.data?.length ?? 0}）`}><Table size="small" rowKey="id" pagination={false} dataSource={stocks.data ?? []} columns={[{ title: "标的", dataIndex: "itemGroupName" }, { title: "在手", dataIndex: "onHandQuantity" }, { title: "预占", dataIndex: "reservedQuantity" }, { title: "维护", dataIndex: "maintenanceQuantity" }, { title: "可用", dataIndex: "availableQuantity", render: (value) => <b>{value}</b> }]} locale={{ emptyText: <Empty description="当前品类未使用数量库存或一次性耗材" /> }} /></Card></Col></Row></Space> },
          { key: "orders", label: `Core 订单（${orders.data?.length ?? 0}）`, children: <Card><Table rowKey="id" dataSource={orders.data ?? []} columns={[{ title: "订单号", dataIndex: "orderNo", render: (value, row) => <Button type="link" onClick={() => setDetail(row)}>{value}</Button> }, { title: "客户", dataIndex: "customerName" }, { title: "租赁时间", render: (_, row) => <span>{dayjs(row.startAt).format("MM-DD HH:mm")}<br />{dayjs(row.endAt).format("MM-DD HH:mm")}</span> }, { title: "明细", render: (_, row) => row.lines.map((line) => `${line.itemGroupName}×${line.quantity}`).join("，") }, { title: "金额", dataIndex: "totalAmount", render: (value, row) => formatRentalMoney(Number(value), row.currency) }, { title: "状态", dataIndex: "status", render: (value) => <Tag color={orderStatus[value]?.color}>{orderStatus[value]?.label ?? value}</Tag> }]} /></Card> }
        ]} />
      </QueryState>

      <Drawer title="新建多行租赁订单" size={720} open={orderOpen} destroyOnHidden onClose={() => setOrderOpen(false)} extra={<Button type="primary" loading={create.isPending} onClick={() => orderForm.submit()}>检查库存并创建</Button>}>
        <Form form={orderForm} layout="vertical" onFinish={submitOrder}>
          <Row gutter={12}><Col span={12}><Form.Item name="customerType" label="客户类型" rules={[{ required: true }]}><Select options={[{ value: "personal", label: "个人" }, { value: "corporate", label: "企业" }]} /></Form.Item></Col><Col span={12}><Form.Item name="customerName" label="客户名称" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="contactPhone" label="联系电话"><Input /></Form.Item></Col><Col span={12}><Form.Item name="fulfillmentMode" label="租赁履约方式" rules={[{ required: true }]}><Select options={(settings.data?.fulfillment.enabledModes ?? []).map((value) => ({ value, label: value }))} /></Form.Item></Col><Col span={12}><Form.Item name="fulfillmentLocationId" label={profile.data?.terminology.fulfillmentLabel ?? "履约网点"} rules={[{ required: true }]}><Select options={(locations.data ?? []).map((row) => ({ value: row.id, label: row.name }))} /></Form.Item></Col><Col span={12}><Form.Item name="qualificationApproved" label="资质审核"><Select allowClear options={[{ value: true, label: "已通过" }, { value: false, label: "未通过/不适用" }]} /></Form.Item></Col></Row>
          <Form.Item name="period" label="租赁时间" rules={[{ required: true }]}><DatePicker.RangePicker showTime style={{ width: "100%" }} /></Form.Item>
          <Form.List name="lines">{(fields, { add, remove }) => <Space orientation="vertical" style={{ width: "100%" }}>{fields.map((field) => <Card size="small" key={field.key} extra={fields.length > 1 && <Button danger type="link" onClick={() => remove(field.name)}>删除</Button>}><Row gutter={12}><Col span={18}><Form.Item {...field} name={[field.name, "itemGroupId"]} label="租赁标的" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={itemOptions} /></Form.Item></Col><Col span={6}><Form.Item {...field} name={[field.name, "quantity"]} label="数量" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item></Col></Row></Card>)}<Button block type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>增加订单明细</Button></Space>}</Form.List>
        </Form>
      </Drawer>

      <Drawer title={detail?.orderNo ?? "订单详情"} size={760} open={Boolean(detail)} onClose={() => setDetail(undefined)}>
        {detail && <Space orientation="vertical" size={16} style={{ width: "100%" }}><Descriptions bordered column={2} items={[{ key: "status", label: "状态", children: <Tag color={orderStatus[detail.status]?.color}>{orderStatus[detail.status]?.label}</Tag> }, { key: "customer", label: "客户", children: detail.customerName }, { key: "location", label: "履约网点", children: detail.fulfillmentLocationName }, { key: "amount", label: "订单金额", children: formatRentalMoney(detail.totalAmount, detail.currency) }]} /><Card title="订单明细"><Table size="small" pagination={false} rowKey="id" dataSource={detail.lines} columns={[{ title: "标的", dataIndex: "itemGroupName" }, { title: "模式", dataIndex: "inventoryMode", render: (value) => modeLabel[value] }, { title: "数量", dataIndex: "quantity" }, { title: "金额", dataIndex: "amount", render: (value) => formatRentalMoney(Number(value), detail.currency) }]} /></Card><Card title="预占与配货"><Typography.Paragraph>预占：{detail.reservations.map((row) => `${row.quantity}×${groups.data?.find((group) => group.id === row.itemGroupId)?.name ?? row.itemGroupId} [${row.status}]`).join("；")}</Typography.Paragraph><Typography.Paragraph>分配：{detail.allocations.length ? detail.allocations.map((row) => row.assetNo ?? `${row.quantity} 件数量库存`).join("；") : "尚未分配"}</Typography.Paragraph></Card><Space wrap>{detail.status === RentalCoreOrderStatus.Draft && <Button type="primary" onClick={() => action.mutate({ id: detail.id, type: "confirm" })}>确认预占</Button>}{detail.status === RentalCoreOrderStatus.Reserved && <Button type="primary" onClick={() => action.mutate({ id: detail.id, type: "allocate" })}>执行配货</Button>}{detail.status === RentalCoreOrderStatus.ReadyForPickup && <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => startInspection(detail, "pickup")}>{profile.data?.terminology.pickupLabel}检查</Button>}{detail.status === RentalCoreOrderStatus.Renting && <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => startInspection(detail, "return")}>{profile.data?.terminology.returnLabel}检查</Button>}{[RentalCoreOrderStatus.Draft, RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(detail.status) && <Button danger onClick={() => action.mutate({ id: detail.id, type: "cancel" })}>取消订单</Button>}</Space></Space>}
      </Drawer>

      <Modal title={inspection?.template.name} open={Boolean(inspection)} confirmLoading={submitInspection.isPending} onCancel={() => setInspection(undefined)} onOk={() => inspectionForm.submit()} destroyOnHidden>
        {inspection && <Form form={inspectionForm} layout="vertical" onFinish={(results) => submitInspection.mutate({ orderId: inspection.order.id, templateId: inspection.template.id, results })}>{inspection.template.fields.map((field) => <Form.Item key={field.code} name={field.code} label={field.label} rules={[{ required: field.required }]}>{field.type === "boolean" ? <Select options={[{ value: true, label: "是 / 正常" }, { value: false, label: "否 / 异常" }]} /> : field.type === "number" ? <InputNumber addonAfter={field.unit} style={{ width: "100%" }} /> : field.type === "select" ? <Select options={field.options?.map((value) => ({ value, label: value }))} /> : <Input.TextArea rows={3} />}</Form.Item>)}</Form>}
      </Modal>
    </>
  );
}
