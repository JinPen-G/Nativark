import { DownloadOutlined, PrinterOutlined } from "@ant-design/icons";
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
import { useLocale } from "@/app/locale";

type Translator = (value: string) => string;
const passthrough: Translator = (value) => value;

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

function text(value: unknown, translate: Translator = passthrough) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return translate(value ? "是" : "否");
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

function publicTerminology(terminology?: RentalCategoryTerminology, translate: Translator = passthrough) {
  return {
    item: terminology?.itemLabel ?? translate("商品"),
    pickup: terminology?.pickupLabel ?? translate("领取"),
    return: terminology?.returnLabel ?? translate("归还"),
    identifier: terminology?.identifierLabel ?? translate("资产编号"),
    location: terminology?.fulfillmentLabel ?? translate("履约地点")
  };
}

function orderHeaderRows(order: RentalOrder, terminology?: RentalCategoryTerminology, translate: Translator = passthrough) {
  const labels = publicTerminology(terminology, translate);
  return [
    { key: "order", label: translate("订单号"), children: order.orderNo },
    { key: "customer", label: translate("客户"), children: order.customerName },
    { key: "phone", label: translate("联系电话"), children: order.contactPhone ?? "—" },
    { key: "period", label: translate("租赁时间"), children: `${dateTime(order.startAt)} ～ ${dateTime(order.effectiveEndAt ?? order.endAt)}` },
    { key: "pickup", label: `${labels.pickup}${translate("地点")}`, children: order.fulfillmentLocationName },
    { key: "return", label: `${labels.return}${translate("地点")}`, children: order.returnLocationName ?? order.fulfillmentLocationName }
  ];
}

function inspectionFieldLabel(templates: RentalInspectionTemplate[], record: RentalInspectionRecord, code: string) {
  return templates.find((template) => template.code === record.templateCode)?.fields.find((field) => field.code === code)?.label ?? code;
}

function documentRows(type: OrderDocumentType, order: RentalOrder, inspections: RentalInspectionRecord[], templates: RentalInspectionTemplate[], funding: RentalFundingBalance | undefined, money: (value: number | undefined) => string, terminology?: RentalCategoryTerminology, translate: Translator = passthrough) {
  const labels = publicTerminology(terminology, translate);
  if (type === "quote") {
    return <>
      <Table rowKey="id" size="small" pagination={false} dataSource={order.lines} columns={[
        { title: labels.item, dataIndex: "itemGroupName" },
        { title: translate("数量"), dataIndex: "quantity" },
        { title: translate("租金"), align: "right" as const, render: (_: unknown, row: RentalOrder["lines"][number]) => money(row.amount) }
      ]} />
      <Descriptions size="small" column={2} style={{ marginTop: 16 }} items={[
        { key: "rental", label: translate("租金合计"), children: money(order.rentalAmount) },
        { key: "service", label: translate("服务费"), children: money(order.serviceAmount) },
        { key: "discount", label: translate("优惠合计"), children: money(Number(order.discountAmount) + Number(order.couponAmount)) },
        { key: "payable", label: translate("最终应付"), children: <Typography.Text strong>{money(order.finalPayableAmount ?? order.payableAmount)}</Typography.Text> },
        { key: "deposit", label: translate("押金"), children: money(order.depositAmount) },
        { key: "preauth", label: translate("预授权"), children: money(order.preAuthAmount) }
      ]} />
    </>;
  }

  if (type === "delivery") {
    const allocations = order.allocations.length > 0;
    return <>
      <Alert type="info" showIcon title={`${translate("以下为")}${labels.pickup}${translate("时应核对的")}${labels.item}${translate("清单；资产未分配时只展示预占数量")}`} style={{ marginBottom: 12 }} />
      {allocations ? <Table rowKey="id" size="small" pagination={false} dataSource={order.allocations} columns={[
        { title: labels.item, render: (_: unknown, row: RentalOrder["allocations"][number]) => order.lines.find((line) => line.id === row.orderLineId)?.itemGroupName ?? labels.item },
        { title: labels.identifier, render: (_: unknown, row: RentalOrder["allocations"][number]) => row.assetNo ?? translate("数量库存") },
        { title: translate("数量"), dataIndex: "quantity" },
        { title: translate("状态"), render: (_: unknown, row: RentalOrder["allocations"][number]) => translate(DELIVERY_STATUS_LABELS[row.status] ?? row.status) }
      ]} /> : <Table<RentalReservation> rowKey="id" size="small" pagination={false} dataSource={order.reservations} columns={[
        { title: labels.item, render: (_: unknown, row) => order.lines.find((line) => line.itemGroupId === row.itemGroupId)?.itemGroupName ?? labels.item },
        { title: translate("数量"), render: (_: unknown, row) => Math.max(0, row.quantity - row.releasedQuantity) },
        { title: translate("状态"), render: (_: unknown, row) => translate(RESERVATION_STATUS_LABELS[row.status] ?? row.status) }
      ]} />}
    </>;
  }

  if (type === "return") {
    return inspections.length ? <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      {inspections.map((record) => <Card key={record.id} size="small" title={`${record.stage === "pickup" ? labels.pickup : labels.return}${translate("检查")} · ${dateTime(record.createdAt)}`} extra={<Tag>{translate(record.stage === "pickup" ? "领取事实" : "归还事实")}</Tag>}>
        <Descriptions size="small" column={2} items={[
          { key: "operator", label: translate("记录人"), children: record.operator },
          { key: "template", label: translate("检查模板"), children: record.templateCode }
        ]} />
        <Table size="small" pagination={false} rowKey="code" dataSource={Object.entries(record.results).map(([code, value]) => ({ code, value }))} columns={[
          { title: translate("检查项目"), render: (_: unknown, row: { code: string; value: unknown }) => translate(inspectionFieldLabel(templates, record, row.code)) },
          { title: translate("记录"), dataIndex: "value", render: (value: unknown) => text(value, translate) }
        ]} />
        {record.exceptions.length ? <><Typography.Text strong>{translate("异常记录")}</Typography.Text><ul>{record.exceptions.map((exception, index) => <li key={`${record.id}-${index}`}>{exception.description}{exception.customerResponseStatus === "confirmed" ? `（${translate("客户已确认")}）` : exception.customerResponseStatus === "disputed" ? `（${translate("客户已申诉")}）` : ""}</li>)}</ul></> : <Typography.Text type="secondary">{translate("未记录异常。")}</Typography.Text>}
      </Card>)}
    </Space> : <Typography.Text type="secondary">{translate("暂未保存领取或归还检查记录。")}</Typography.Text>;
  }

  return <>
    <Table rowKey="code" size="small" pagination={false} dataSource={order.chargeLines} columns={[
      { title: translate("费用项目"), dataIndex: "name" },
      { title: translate("金额"), align: "right" as const, render: (_: unknown, row: RentalOrder["chargeLines"][number]) => money(row.amount) }
    ]} />
    <Descriptions size="small" column={2} style={{ marginTop: 16 }} items={[
      { key: "receivable", label: translate("最终应收"), children: money(order.finalPayableAmount ?? order.payableAmount) },
      { key: "collected", label: translate("已收租金及费用"), children: funding ? money(funding.rental.collected) : translate("当前账号无资金明细查看权限") },
      { key: "refunded", label: translate("已退租金及费用"), children: funding ? money(funding.rental.refunded) : "—" },
      { key: "balance", label: translate("待收/待退"), children: funding ? `${funding.rental.balance < 0 ? translate("待退") : translate("待收")} ${money(Math.abs(funding.rental.balance))}` : "—" },
      { key: "deposit", label: translate("押金事实"), children: funding ? `${translate("已收")} ${money(funding.deposit.collected)} · ${translate("已退")} ${money(funding.deposit.refunded)} · ${translate("已抵扣")} ${money(funding.deposit.captured)}` : "—" },
      { key: "preauth", label: translate("预授权事实"), children: funding ? `${translate("已冻结")} ${money(funding.preauthorization.frozen)} · ${translate("已释放")} ${money(funding.preauthorization.released)} · ${translate("已转扣")} ${money(funding.preauthorization.captured)}` : "—" }
    ]} />
  </>;
}

function documentHtml(type: OrderDocumentType, order: RentalOrder, inspections: RentalInspectionRecord[], templates: RentalInspectionTemplate[], funding: RentalFundingBalance | undefined, money: (value: number | undefined) => string, terminology?: RentalCategoryTerminology, translate: Translator = passthrough) {
  const labels = publicTerminology(terminology, translate);
  const title = translate(DOCUMENT_TYPES.find((item) => item.value === type)?.label ?? "租赁凭证");
  const rows = type === "quote"
    ? order.lines.map((line) => `<tr><td>${escapeHtml(line.itemGroupName)}</td><td>${line.quantity}</td><td>${escapeHtml(money(line.amount))}</td></tr>`).join("")
    : type === "delivery"
      ? (order.allocations.length
        ? order.allocations.map((row) => `<tr><td>${escapeHtml(order.lines.find((line) => line.id === row.orderLineId)?.itemGroupName ?? labels.item)}</td><td>${escapeHtml(row.assetNo ?? translate("数量库存"))}</td><td>${row.quantity}</td><td>${escapeHtml(translate(DELIVERY_STATUS_LABELS[row.status] ?? row.status))}</td></tr>`).join("")
        : order.reservations.map((row) => `<tr><td>${escapeHtml(order.lines.find((line) => line.itemGroupId === row.itemGroupId)?.itemGroupName ?? labels.item)}</td><td>${escapeHtml(translate("数量库存"))}</td><td>${Math.max(0, row.quantity - row.releasedQuantity)}</td><td>${escapeHtml(translate(RESERVATION_STATUS_LABELS[row.status] ?? row.status))}</td></tr>`).join(""))
      : type === "return"
        ? inspections.map((record) => `<tr><td>${record.stage === "pickup" ? escapeHtml(labels.pickup) : escapeHtml(labels.return)}</td><td>${escapeHtml(dateTime(record.createdAt))}</td><td>${escapeHtml(Object.entries(record.results).map(([code, value]) => `${translate(inspectionFieldLabel(templates, record, code))}: ${text(value, translate)}`).join(translate("；")))}</td><td>${escapeHtml(record.exceptions.map((exception) => exception.description).join(translate("；")) || translate("无"))}</td></tr>`).join("")
        : order.chargeLines.map((line) => `<tr><td>${escapeHtml(line.name)}</td><td>${escapeHtml(money(line.amount))}</td></tr>`).join("");
  const headers = type === "quote" ? `<th>${escapeHtml(labels.item)}</th><th>${translate("数量")}</th><th>${translate("金额")}</th>`
    : type === "delivery" ? `<th>${escapeHtml(labels.item)}</th><th>${escapeHtml(labels.identifier)}</th><th>${translate("数量")}</th><th>${translate("状态")}</th>`
      : type === "return" ? `<th>${translate("阶段")}</th><th>${translate("时间")}</th><th>${translate("检查记录")}</th><th>${translate("异常")}</th>` : `<th>${translate("费用项目")}</th><th>${translate("金额")}</th>`;
  const summary = type === "quote"
    ? `<p>${translate("最终应付")}：<strong>${escapeHtml(money(order.finalPayableAmount ?? order.payableAmount))}</strong>　${translate("押金")}：${escapeHtml(money(order.depositAmount))}　${translate("预授权")}：${escapeHtml(money(order.preAuthAmount))}</p>`
    : type === "settlement"
      ? `<p>${translate("最终应收")}：<strong>${escapeHtml(money(order.finalPayableAmount ?? order.payableAmount))}</strong>　${translate("已收")}：${escapeHtml(funding ? money(funding.rental.collected) : "—")}　${translate("已退")}：${escapeHtml(funding ? money(funding.rental.refunded) : "—")}</p>`
      : "";
  // 只生成本地已转义的快照；不能把任何业务字段拼进外部 URL。
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}-${escapeHtml(order.orderNo)}</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#222;padding:32px;line-height:1.6}h1{font-size:22px;margin:0 0 8px}h2{font-size:15px;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:24px}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 24px;margin:18px 0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #d9d9d9;padding:7px;text-align:left}th{background:#fafafa}.right{text-align:right}.muted{color:#666;font-size:12px}@media print{body{padding:0}}</style></head><body><h1>${escapeHtml(title)}</h1><div class="muted">${escapeHtml(order.orderNo)} · 生成时间 ${escapeHtml(new Date().toLocaleString())}</div><div class="meta"><div>客户：${escapeHtml(order.customerName)}</div><div>联系电话：${escapeHtml(order.contactPhone ?? "—")}</div><div>租赁时间：${escapeHtml(dateTime(order.startAt))} ～ ${escapeHtml(dateTime(order.effectiveEndAt ?? order.endAt))}</div><div>${escapeHtml(labels.pickup)}地点：${escapeHtml(order.fulfillmentLocationName)}</div><div>${escapeHtml(labels.return)}地点：${escapeHtml(order.returnLocationName ?? order.fulfillmentLocationName)}</div><div>状态：${escapeHtml(ORDER_STATUS_LABELS[order.status] ?? order.status)}</div></div><h2>明细</h2><table><thead><tr>${headers}</tr></thead><tbody>${rows || `<tr><td colspan="4">暂无记录</td></tr>`}</tbody></table>${summary}<p class="muted">本凭证依据订单历史快照生成；不构成法定发票或电子签章文件。</p></body></html>`;
}

function printDocument(type: OrderDocumentType, order: RentalOrder, inspections: RentalInspectionRecord[], templates: RentalInspectionTemplate[], funding: RentalFundingBalance | undefined, money: (value: number | undefined) => string, terminology?: RentalCategoryTerminology, translate: Translator = passthrough) {
  const html = documentHtml(type, order, inspections, templates, funding, money, terminology, translate);
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
  return true;
}

function downloadDocument(type: OrderDocumentType, order: RentalOrder, inspections: RentalInspectionRecord[], templates: RentalInspectionTemplate[], funding: RentalFundingBalance | undefined, money: (value: number | undefined) => string, terminology?: RentalCategoryTerminology, translate: Translator = passthrough) {
  const html = documentHtml(type, order, inspections, templates, funding, money, terminology, translate);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeOrderNo = order.orderNo.replace(/[^\p{L}\p{N}._-]+/gu, "_");
  const label = translate(DOCUMENT_TYPES.find((item) => item.value === type)?.label ?? "租赁凭证");
  anchor.href = url;
  anchor.download = `${safeOrderNo}-${label}.html`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function OrderDocumentsPanel({ order, inspections, templates, funding, terminology, money }: {
  order: RentalOrder;
  inspections: RentalInspectionRecord[];
  templates: RentalInspectionTemplate[];
  funding?: RentalFundingBalance;
  terminology?: RentalCategoryTerminology;
  money: (value: number | undefined) => string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<OrderDocumentType>("quote");
  const selected = useMemo(() => DOCUMENT_TYPES.find((item) => item.value === type) ?? DOCUMENT_TYPES[0], [type]);
  const print = () => {
    if (!printDocument(type, order, inspections, templates, funding, money, terminology, t)) return;
  };
  return <>
    <Card title={t("客户业务凭证")} extra={<Typography.Text type="secondary">{t("基于订单快照查看、下载或浏览器打印；不构成法定票据")}</Typography.Text>}>
      <Space wrap>
        {DOCUMENT_TYPES.map((item) => <Button key={item.value} icon={<PrinterOutlined />} onClick={() => { setType(item.value); setOpen(true); }}>{t(item.label)}</Button>)}
      </Space>
    </Card>
    <Modal title={`${t(selected.label)} · ${order.orderNo}`} open={open} width={900} onCancel={() => setOpen(false)} footer={<Space><Button onClick={() => setOpen(false)}>{t("关闭")}</Button><Button icon={<DownloadOutlined />} onClick={() => downloadDocument(type, order, inspections, templates, funding, money, terminology, t)}>{t("下载 HTML")}</Button><Button type="primary" icon={<PrinterOutlined />} onClick={print}>{t("打印")}</Button></Space>} destroyOnHidden>
      <Alert type="info" showIcon title={t(selected.description)} style={{ marginBottom: 16 }} />
      <Descriptions size="small" column={{ xs: 1, md: 2 }} items={orderHeaderRows(order, terminology, t)} />
      <div style={{ marginTop: 16 }}>{documentRows(type, order, inspections, templates, funding, money, terminology, t)}</div>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>{t("下载内容是客户可读 HTML 快照，不包含内部风控、成本、权限或敏感证件信息；法定发票、正式 PDF 和电子签章另行处理。")}</Typography.Paragraph>
    </Modal>
  </>;
}
