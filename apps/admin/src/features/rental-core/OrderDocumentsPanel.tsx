import { PrinterOutlined } from "@ant-design/icons";
import type {
  RentalCategoryTerminology,
  RentalFundingBalance,
  RentalInspectionRecord,
  RentalInspectionTemplate,
  RentalOrder,
  RentalReservation
} from "@rental-os/shared";
import { Alert, Button, Card, Descriptions, Modal, Space, Table, Tag, Typography } from "antd";
import { useMemo, useState } from "react";

type OrderDocumentType = "quote" | "delivery" | "return" | "settlement";

const DOCUMENT_TYPES: Array<{ value: OrderDocumentType; label: string; description: string }> = [
  { value: "quote", label: "报价单", description: "展示订单确认时的商品、租金、优惠和最终应付。" },
  { value: "delivery", label: "交付清单", description: "展示本次应交付的商品、数量和已分配资产。" },
  { value: "return", label: "归还检查单", description: "展示已保存的领取/归还检查事实，不展示内部费用建议。" },
  { value: "settlement", label: "结算对账单", description: "展示费用、应收和已发生的收退款事实。" }
];

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pre_assigned: "已预分配",
  locked: "已锁定",
  allocated: "已分配",
  picked_up: "已交付",
  returned: "已归还",
  released: "已释放"
};

const RESERVATION_STATUS_LABELS: Record<string, string> = {
  soft: "已预占",
  hard: "已锁定",
  released: "已释放",
  expired: "已过期",
  cancelled: "已取消"
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "待确认",
  reserved: "已确认",
  pickup_overdue: "待确认爽约",
  ready_for_pickup: "待领取",
  renting: "租赁中",
  return_inspection: "归还检查",
  settling: "待结算",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "已爽约"
};

function text(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function dateTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "—";
}

function escapeHtml(value: unknown) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function publicTerminology(terminology?: RentalCategoryTerminology) {
  return {
    item: terminology?.itemLabel ?? "商品",
    pickup: terminology?.pickupLabel ?? "领取",
    return: terminology?.returnLabel ?? "归还",
    identifier: terminology?.identifierLabel ?? "资产编号",
    location: terminology?.fulfillmentLabel ?? "履约地点"
  };
}

function orderHeaderRows(order: RentalOrder, terminology?: RentalCategoryTerminology) {
  const labels = publicTerminology(terminology);
  return [
    { key: "order", label: "订单号", children: order.orderNo },
    { key: "customer", label: "客户", children: order.customerName },
    { key: "phone", label: "联系电话", children: order.contactPhone ?? "—" },
    { key: "period", label: "租赁时间", children: `${dateTime(order.startAt)} ～ ${dateTime(order.effectiveEndAt ?? order.endAt)}` },
    { key: "pickup", label: `${labels.pickup}地点`, children: order.fulfillmentLocationName },
    { key: "return", label: `${labels.return}地点`, children: order.returnLocationName ?? order.fulfillmentLocationName }
  ];
}

function inspectionFieldLabel(templates: RentalInspectionTemplate[], record: RentalInspectionRecord, code: string) {
  return templates.find((template) => template.code === record.templateCode)?.fields.find((field) => field.code === code)?.label ?? code;
}

function documentRows(type: OrderDocumentType, order: RentalOrder, inspections: RentalInspectionRecord[], templates: RentalInspectionTemplate[], funding: RentalFundingBalance | undefined, money: (value: number | undefined) => string, terminology?: RentalCategoryTerminology) {
  const labels = publicTerminology(terminology);
  if (type === "quote") {
    return <>
      <Table rowKey="id" size="small" pagination={false} dataSource={order.lines} columns={[
        { title: labels.item, dataIndex: "itemGroupName" },
        { title: "数量", dataIndex: "quantity" },
        { title: "租金", align: "right" as const, render: (_: unknown, row: RentalOrder["lines"][number]) => money(row.amount) }
      ]} />
      <Descriptions size="small" column={2} style={{ marginTop: 16 }} items={[
        { key: "rental", label: "租金合计", children: money(order.rentalAmount) },
        { key: "service", label: "服务费", children: money(order.serviceAmount) },
        { key: "discount", label: "优惠合计", children: money(Number(order.discountAmount) + Number(order.couponAmount)) },
        { key: "payable", label: "最终应付", children: <Typography.Text strong>{money(order.finalPayableAmount ?? order.payableAmount)}</Typography.Text> },
        { key: "deposit", label: "押金", children: money(order.depositAmount) },
        { key: "preauth", label: "预授权", children: money(order.preAuthAmount) }
      ]} />
    </>;
  }

  if (type === "delivery") {
    const allocations = order.allocations.length > 0;
    return <>
      <Alert type="info" showIcon title={`以下为${labels.pickup}时应核对的${labels.item}清单；资产未分配时只展示预占数量。`} style={{ marginBottom: 12 }} />
      {allocations ? <Table rowKey="id" size="small" pagination={false} dataSource={order.allocations} columns={[
        { title: labels.item, render: (_: unknown, row: RentalOrder["allocations"][number]) => order.lines.find((line) => line.id === row.orderLineId)?.itemGroupName ?? labels.item },
        { title: labels.identifier, render: (_: unknown, row: RentalOrder["allocations"][number]) => row.assetNo ?? "数量库存" },
        { title: "数量", dataIndex: "quantity" },
        { title: "状态", render: (_: unknown, row: RentalOrder["allocations"][number]) => DELIVERY_STATUS_LABELS[row.status] ?? row.status }
      ]} /> : <Table<RentalReservation> rowKey="id" size="small" pagination={false} dataSource={order.reservations} columns={[
        { title: labels.item, render: (_: unknown, row) => order.lines.find((line) => line.itemGroupId === row.itemGroupId)?.itemGroupName ?? labels.item },
        { title: "数量", render: (_: unknown, row) => Math.max(0, row.quantity - row.releasedQuantity) },
        { title: "状态", render: (_: unknown, row) => RESERVATION_STATUS_LABELS[row.status] ?? row.status }
      ]} />}
    </>;
  }

  if (type === "return") {
    return inspections.length ? <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      {inspections.map((record) => <Card key={record.id} size="small" title={`${record.stage === "pickup" ? labels.pickup : labels.return}检查 · ${dateTime(record.createdAt)}`} extra={<Tag>{record.stage === "pickup" ? "领取事实" : "归还事实"}</Tag>}>
        <Descriptions size="small" column={2} items={[
          { key: "operator", label: "记录人", children: record.operator },
          { key: "template", label: "检查模板", children: record.templateCode }
        ]} />
        <Table size="small" pagination={false} rowKey="code" dataSource={Object.entries(record.results).map(([code, value]) => ({ code, value }))} columns={[
          { title: "检查项目", render: (_: unknown, row: { code: string; value: unknown }) => inspectionFieldLabel(templates, record, row.code) },
          { title: "记录", dataIndex: "value", render: (value: unknown) => text(value) }
        ]} />
        {record.exceptions.length ? <><Typography.Text strong>异常记录</Typography.Text><ul>{record.exceptions.map((exception, index) => <li key={`${record.id}-${index}`}>{exception.description}{exception.customerResponseStatus === "confirmed" ? "（客户已确认）" : exception.customerResponseStatus === "disputed" ? "（客户已申诉）" : ""}</li>)}</ul></> : <Typography.Text type="secondary">未记录异常。</Typography.Text>}
      </Card>)}
    </Space> : <Typography.Text type="secondary">暂未保存领取或归还检查记录。</Typography.Text>;
  }

  return <>
    <Table rowKey="code" size="small" pagination={false} dataSource={order.chargeLines} columns={[
      { title: "费用项目", dataIndex: "name" },
      { title: "金额", align: "right" as const, render: (_: unknown, row: RentalOrder["chargeLines"][number]) => money(row.amount) }
    ]} />
    <Descriptions size="small" column={2} style={{ marginTop: 16 }} items={[
      { key: "receivable", label: "最终应收", children: money(order.finalPayableAmount ?? order.payableAmount) },
      { key: "collected", label: "已收租金及费用", children: funding ? money(funding.rental.collected) : "当前账号无资金明细查看权限" },
      { key: "refunded", label: "已退租金及费用", children: funding ? money(funding.rental.refunded) : "—" },
      { key: "balance", label: "待收/待退", children: funding ? `${funding.rental.balance < 0 ? "待退" : "待收"} ${money(Math.abs(funding.rental.balance))}` : "—" },
      { key: "deposit", label: "押金事实", children: funding ? `已收 ${money(funding.deposit.collected)} · 已退 ${money(funding.deposit.refunded)} · 已抵扣 ${money(funding.deposit.captured)}` : "—" },
      { key: "preauth", label: "预授权事实", children: funding ? `已冻结 ${money(funding.preauthorization.frozen)} · 已释放 ${money(funding.preauthorization.released)} · 已转扣 ${money(funding.preauthorization.captured)}` : "—" }
    ]} />
  </>;
}

function printDocument(type: OrderDocumentType, order: RentalOrder, inspections: RentalInspectionRecord[], templates: RentalInspectionTemplate[], funding: RentalFundingBalance | undefined, money: (value: number | undefined) => string, terminology?: RentalCategoryTerminology) {
  const labels = publicTerminology(terminology);
  const title = DOCUMENT_TYPES.find((item) => item.value === type)?.label ?? "租赁凭证";
  const rows = type === "quote"
    ? order.lines.map((line) => `<tr><td>${escapeHtml(line.itemGroupName)}</td><td>${line.quantity}</td><td>${escapeHtml(money(line.amount))}</td></tr>`).join("")
    : type === "delivery"
      ? (order.allocations.length
        ? order.allocations.map((row) => `<tr><td>${escapeHtml(order.lines.find((line) => line.id === row.orderLineId)?.itemGroupName ?? labels.item)}</td><td>${escapeHtml(row.assetNo ?? "数量库存")}</td><td>${row.quantity}</td><td>${escapeHtml(DELIVERY_STATUS_LABELS[row.status] ?? row.status)}</td></tr>`).join("")
        : order.reservations.map((row) => `<tr><td>${escapeHtml(order.lines.find((line) => line.itemGroupId === row.itemGroupId)?.itemGroupName ?? labels.item)}</td><td>数量库存</td><td>${Math.max(0, row.quantity - row.releasedQuantity)}</td><td>${escapeHtml(RESERVATION_STATUS_LABELS[row.status] ?? row.status)}</td></tr>`).join(""))
      : type === "return"
        ? inspections.map((record) => `<tr><td>${record.stage === "pickup" ? escapeHtml(labels.pickup) : escapeHtml(labels.return)}</td><td>${escapeHtml(dateTime(record.createdAt))}</td><td>${escapeHtml(Object.entries(record.results).map(([code, value]) => `${inspectionFieldLabel(templates, record, code)}：${text(value)}`).join("；"))}</td><td>${escapeHtml(record.exceptions.map((exception) => exception.description).join("；") || "无")}</td></tr>`).join("")
        : order.chargeLines.map((line) => `<tr><td>${escapeHtml(line.name)}</td><td>${escapeHtml(money(line.amount))}</td></tr>`).join("");
  const headers = type === "quote" ? `<th>${escapeHtml(labels.item)}</th><th>数量</th><th>金额</th>`
    : type === "delivery" ? `<th>${escapeHtml(labels.item)}</th><th>${escapeHtml(labels.identifier)}</th><th>数量</th><th>状态</th>`
      : type === "return" ? `<th>阶段</th><th>时间</th><th>检查记录</th><th>异常</th>` : "<th>费用项目</th><th>金额</th>";
  const summary = type === "quote"
    ? `<p>最终应付：<strong>${escapeHtml(money(order.finalPayableAmount ?? order.payableAmount))}</strong>　押金：${escapeHtml(money(order.depositAmount))}　预授权：${escapeHtml(money(order.preAuthAmount))}</p>`
    : type === "settlement"
      ? `<p>最终应收：<strong>${escapeHtml(money(order.finalPayableAmount ?? order.payableAmount))}</strong>　已收：${escapeHtml(funding ? money(funding.rental.collected) : "—")}　已退：${escapeHtml(funding ? money(funding.rental.refunded) : "—")}</p>`
      : "";
  // 只打开空白页并写入本地已转义的快照；不能把任何业务字段拼进外部 URL。
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}-${escapeHtml(order.orderNo)}</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#222;padding:32px;line-height:1.6}h1{font-size:22px;margin:0 0 8px}h2{font-size:15px;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:24px}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 24px;margin:18px 0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #d9d9d9;padding:7px;text-align:left}th{background:#fafafa}.right{text-align:right}.muted{color:#666;font-size:12px}@media print{body{padding:0}}</style></head><body><h1>${escapeHtml(title)}</h1><div class="muted">${escapeHtml(order.orderNo)} · 生成时间 ${escapeHtml(new Date().toLocaleString())}</div><div class="meta"><div>客户：${escapeHtml(order.customerName)}</div><div>联系电话：${escapeHtml(order.contactPhone ?? "—")}</div><div>租赁时间：${escapeHtml(dateTime(order.startAt))} ～ ${escapeHtml(dateTime(order.effectiveEndAt ?? order.endAt))}</div><div>${escapeHtml(labels.pickup)}地点：${escapeHtml(order.fulfillmentLocationName)}</div><div>${escapeHtml(labels.return)}地点：${escapeHtml(order.returnLocationName ?? order.fulfillmentLocationName)}</div><div>状态：${escapeHtml(ORDER_STATUS_LABELS[order.status] ?? order.status)}</div></div><h2>明细</h2><table><thead><tr>${headers}</tr></thead><tbody>${rows || `<tr><td colspan="4">暂无记录</td></tr>`}</tbody></table>${summary}<p class="muted">本凭证依据订单历史快照生成；不构成法定发票或电子签章文件。</p></body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
  return true;
}

export function OrderDocumentsPanel({ order, inspections, templates, funding, terminology, money }: {
  order: RentalOrder;
  inspections: RentalInspectionRecord[];
  templates: RentalInspectionTemplate[];
  funding?: RentalFundingBalance;
  terminology?: RentalCategoryTerminology;
  money: (value: number | undefined) => string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<OrderDocumentType>("quote");
  const selected = useMemo(() => DOCUMENT_TYPES.find((item) => item.value === type) ?? DOCUMENT_TYPES[0], [type]);
  const print = () => {
    if (!printDocument(type, order, inspections, templates, funding, money, terminology)) return;
  };
  return <>
    <Card title="客户业务凭证" extra={<Typography.Text type="secondary">基于订单快照查看或浏览器打印</Typography.Text>}>
      <Space wrap>
        {DOCUMENT_TYPES.map((item) => <Button key={item.value} icon={<PrinterOutlined />} onClick={() => { setType(item.value); setOpen(true); }}>{item.label}</Button>)}
      </Space>
    </Card>
    <Modal title={`${selected.label} · ${order.orderNo}`} open={open} width={900} onCancel={() => setOpen(false)} footer={<Space><Button onClick={() => setOpen(false)}>关闭</Button><Button type="primary" icon={<PrinterOutlined />} onClick={print}>打印</Button></Space>} destroyOnHidden>
      <Alert type="info" showIcon title={selected.description} style={{ marginBottom: 16 }} />
      <Descriptions size="small" column={{ xs: 1, md: 2 }} items={orderHeaderRows(order, terminology)} />
      <div style={{ marginTop: 16 }}>{documentRows(type, order, inspections, templates, funding, money, terminology)}</div>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>本凭证依据订单历史快照生成，不包含内部风控、成本、权限或敏感证件信息；法定发票和电子签章另行处理。</Typography.Paragraph>
    </Modal>
  </>;
}
