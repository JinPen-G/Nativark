import { createHash } from "node:crypto";
import { formatRentalMoney, type RentalCategoryTerminology, type RentalFundingBalance, type RentalInspectionRecord, type RentalInspectionTemplate, type RentalOrder, type RentalDocumentRenderResult, type RentalDocumentType } from "@rental-os/shared";

export interface RentalDocumentRenderInput {
  documentType: RentalDocumentType;
  order: RentalOrder;
  inspections: RentalInspectionRecord[];
  templates: RentalInspectionTemplate[];
  funding?: RentalFundingBalance;
  terminology?: RentalCategoryTerminology;
  timeZone?: string;
  snapshotAt: string;
}

const DOCUMENT_META: Record<RentalDocumentType, { title: string; description: string }> = {
  quote: { title: "报价单", description: "订单确认时的商品、租金、优惠和最终应付。" },
  delivery: { title: "交付清单", description: "本次应交付的商品、数量和已分配资产。" },
  return: { title: "归还检查单", description: "已保存的领取/归还检查事实，不包含内部费用建议。" },
  settlement: { title: "结算对账单", description: "费用、应收和已发生的收退款事实。" }
};

type PublicRow = Record<string, string | number | boolean | undefined>;

/**
 * DOC-PRINT-01：服务端与管理端共用的客户可读凭证渲染器。
 *
 * 这里故意只接受 RentalOrder 的公开域对象，而不是 Prisma 行或规则快照，
 * 并且逐字段挑选输出内容。这样即使后续订单增加内部风控、成本或证件字段，
 * 也不会因为“把整个订单 JSON 塞进 HTML”而泄露给客户/APP。
 */
export function renderRentalDocument(input: RentalDocumentRenderInput): RentalDocumentRenderResult {
  const { documentType, order, inspections, templates, funding, terminology, timeZone = "Asia/Shanghai", snapshotAt } = input;
  const meta = DOCUMENT_META[documentType];
  const labels = publicTerminology(terminology);
  const rows = documentRows(documentType, order, inspections, templates, labels);
  const snapshot: Record<string, unknown> = {
    documentType,
    templateCode: `${documentType}-v1`,
    title: meta.title,
    order: {
      orderNo: order.orderNo,
      status: order.status,
      customerName: order.customerName,
      contactPhone: order.contactPhone ?? undefined,
      startAt: order.startAt,
      endAt: order.effectiveEndAt ?? order.endAt,
      fulfillmentLocationName: order.fulfillmentLocationName,
      returnLocationName: order.returnLocationName ?? order.fulfillmentLocationName,
      currency: order.currency ?? "CNY"
    },
    rows,
    labels,
    summary: documentSummary(documentType, order)
  };

  if (documentType === "settlement") {
    snapshot.financial = funding
      ? {
          visible: true,
          balanceBasis: funding.balanceBasis ?? "unverified",
          rental: {
            collected: funding.rental.collected,
            refunded: funding.rental.refunded,
            ...(funding.rental.corporatePaid !== undefined ? { corporatePaid: funding.rental.corporatePaid } : {}),
            balance: funding.rental.balance
          },
          deposit: {
            collected: funding.deposit.collected,
            refunded: funding.deposit.refunded,
            captured: funding.deposit.captured
          },
          preauthorization: {
            frozen: funding.preauthorization.frozen,
            released: funding.preauthorization.released,
            captured: funding.preauthorization.captured
          }
        }
      : { visible: false, message: "当前账号无资金明细查看权限" };
  }

  const contentHash = createHash("sha256").update(stableJson(snapshot)).digest("hex");
  const documentNo = `${order.orderNo}-${documentType}`;
  const html = renderHtml({
    documentType,
    meta,
    order,
    rows,
    labels,
    summary: snapshot.summary as Record<string, unknown>,
    financial: snapshot.financial as Record<string, unknown> | undefined,
    snapshotAt,
    timeZone
  });

  return {
    documentType,
    templateCode: `${documentType}-v1` as `${RentalDocumentType}-v1`,
    title: meta.title,
    documentNo,
    sourceOrderUpdatedAt: order.updatedAt,
    snapshotAt,
    snapshot,
    html,
    contentHash
  };
}

function documentRows(
  type: RentalDocumentType,
  order: RentalOrder,
  inspections: RentalInspectionRecord[],
  templates: RentalInspectionTemplate[],
  labels: ReturnType<typeof publicTerminology>
): PublicRow[] {
  if (type === "quote") {
    return order.lines.map((line) => ({
      item: line.itemGroupName,
      quantity: activeQuantity(line.quantity, line.cancelledQuantity),
      cancelledQuantity: Math.max(0, line.cancelledQuantity ?? 0),
      amount: roundMoney((Number(line.amount) / Math.max(1, line.quantity)) * activeQuantity(line.quantity, line.cancelledQuantity))
    }));
  }
  if (type === "delivery") {
    if (order.allocations.length) {
      return order.allocations.map((allocation) => ({
        item: order.lines.find((line) => line.id === allocation.orderLineId)?.itemGroupName ?? labels.item,
        identifier: allocation.assetNo ?? "数量库存",
        quantity: allocation.quantity,
        status: allocation.status
      }));
    }
    return order.reservations.map((reservation) => ({
      item: order.lines.find((line) => line.itemGroupId === reservation.itemGroupId)?.itemGroupName ?? labels.item,
      identifier: "数量库存",
      quantity: Math.max(0, reservation.quantity - reservation.releasedQuantity),
      status: reservation.status
    }));
  }
  if (type === "return") {
    return inspections.map((record) => ({
      stage: record.stage === "pickup" ? labels.pickup : labels.return,
      at: record.createdAt,
      checks: Object.entries(record.results).map(([code, value]) => `${inspectionFieldLabel(templates, record, code)}：${safeText(value)}`).join("；"),
      exceptions: record.exceptions.map((exception) => `${exception.description}${exception.customerResponseStatus === "confirmed" ? "（客户已确认）" : exception.customerResponseStatus === "disputed" ? "（客户已申诉）" : ""}`).join("；") || "无"
    }));
  }
  return order.chargeLines.map((line) => ({ name: line.name, amount: line.amount, type: line.type }));
}

function documentSummary(type: RentalDocumentType, order: RentalOrder) {
  if (type === "quote") {
    return {
      rentalAmount: order.rentalAmount,
      serviceAmount: order.serviceAmount,
      discountAmount: Number(order.discountAmount) + Number(order.couponAmount),
      finalPayableAmount: order.finalPayableAmount ?? order.payableAmount,
      depositAmount: order.depositAmount,
      preAuthAmount: order.preAuthAmount,
      currency: order.currency ?? "CNY"
    };
  }
  if (type === "settlement") {
    return {
      receivableAmount: order.finalPayableAmount ?? order.payableAmount,
      adjustmentAmount: order.adjustmentAmount,
      currency: order.currency ?? "CNY"
    };
  }
  return {};
}

function renderHtml(input: {
  documentType: RentalDocumentType;
  meta: { title: string; description: string };
  order: RentalOrder;
  rows: PublicRow[];
  labels: ReturnType<typeof publicTerminology>;
  summary: Record<string, unknown>;
  financial?: Record<string, unknown>;
  timeZone: string;
  snapshotAt: string;
}) {
  const { documentType, meta, order, rows, labels, summary, financial, timeZone, snapshotAt } = input;
  const currency = order.currency ?? "CNY";
  const headers = documentType === "quote"
    ? [labels.item, "数量", "金额"]
    : documentType === "delivery"
      ? [labels.item, labels.identifier, "数量", "状态"]
      : documentType === "return"
        ? ["阶段", "时间", "检查记录", "异常"]
        : ["费用项目", "金额"];
  const body = rows.length
    ? rows.map((row) => documentRowHtml(documentType, row, currency, timeZone)).join("")
    : `<tr><td colspan="${headers.length}">暂无记录</td></tr>`;
  const summaryHtml = documentSummaryHtml(documentType, summary, financial, currency);
  const generated = escapeHtml(snapshotAt);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(meta.title)}-${escapeHtml(order.orderNo)}</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#222;padding:32px;line-height:1.6}h1{font-size:22px;margin:0 0 8px}h2{font-size:15px;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:24px}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 24px;margin:18px 0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #d9d9d9;padding:7px;text-align:left;vertical-align:top}th{background:#fafafa}.right{text-align:right}.muted{color:#666;font-size:12px}@media print{body{padding:0}}</style></head><body><h1>${escapeHtml(meta.title)}</h1><div class="muted">${escapeHtml(order.orderNo)} · 快照时间 ${generated}</div><div class="meta"><div>客户：${escapeHtml(order.customerName)}</div><div>联系电话：${escapeHtml(order.contactPhone ?? "—")}</div><div>租赁时间：${escapeHtml(formatDateTime(order.startAt, timeZone))} ～ ${escapeHtml(formatDateTime(order.effectiveEndAt ?? order.endAt, timeZone))}</div><div>${escapeHtml(labels.pickup)}地点：${escapeHtml(order.fulfillmentLocationName)}</div><div>${escapeHtml(labels.return)}地点：${escapeHtml(order.returnLocationName ?? order.fulfillmentLocationName)}</div><div>状态：${escapeHtml(order.status)}</div></div><h2>${escapeHtml(meta.description)}</h2><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>${summaryHtml}<p class="muted">本凭证依据订单历史快照生成；不构成法定发票、正式 PDF 或电子签章文件。</p></body></html>`;
}

function documentRowHtml(type: RentalDocumentType, row: PublicRow, currency: string, timeZone: string) {
  if (type === "quote") return `<tr><td>${escapeHtml(row.item)}</td><td>${escapeHtml(row.quantity)}</td><td>${escapeHtml(formatRentalMoney(Number(row.amount ?? 0), currency))}</td></tr>`;
  if (type === "delivery") return `<tr><td>${escapeHtml(row.item)}</td><td>${escapeHtml(row.identifier)}</td><td>${escapeHtml(row.quantity)}</td><td>${escapeHtml(row.status)}</td></tr>`;
  if (type === "return") return `<tr><td>${escapeHtml(row.stage)}</td><td>${escapeHtml(formatDateTime(String(row.at ?? ""), timeZone))}</td><td>${escapeHtml(row.checks)}</td><td>${escapeHtml(row.exceptions)}</td></tr>`;
  return `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(formatRentalMoney(Number(row.amount ?? 0), currency))}</td></tr>`;
}

function documentSummaryHtml(type: RentalDocumentType, summary: Record<string, unknown>, financial: Record<string, unknown> | undefined, currency: string) {
  if (type === "quote") {
    return `<p>租金合计：${escapeHtml(formatRentalMoney(Number(summary.rentalAmount ?? 0), currency))}　服务费：${escapeHtml(formatRentalMoney(Number(summary.serviceAmount ?? 0), currency))}　优惠合计：${escapeHtml(formatRentalMoney(Number(summary.discountAmount ?? 0), currency))}　最终应付：<strong>${escapeHtml(formatRentalMoney(Number(summary.finalPayableAmount ?? 0), currency))}</strong>　押金：${escapeHtml(formatRentalMoney(Number(summary.depositAmount ?? 0), currency))}　预授权：${escapeHtml(formatRentalMoney(Number(summary.preAuthAmount ?? 0), currency))}</p>`;
  }
  if (type !== "settlement") return "";
  const fundingNotice = financial?.balanceBasis === "simulated" ? "模拟资金演练，不代表真实收款、冻结或退款。"
    : financial?.balanceBasis === "real" ? "实际资金口径，不含模拟事件。" : "资金来源待核对，不作为实款凭证。";
  const rental = financial?.rental as Record<string, unknown> | undefined;
  const corporateHtml = rental?.corporatePaid !== undefined
    ? `　企业回款已核销：${escapeHtml(formatRentalMoney(Number(rental.corporatePaid), currency))}` : "";
  const financialHtml = financial?.visible
    ? `<p>${escapeHtml(fundingNotice)}</p><p>已收租金及费用：${escapeHtml(formatRentalMoney(Number((financial.rental as Record<string, unknown>)?.collected ?? 0), currency))}　已退：${escapeHtml(formatRentalMoney(Number((financial.rental as Record<string, unknown>)?.refunded ?? 0), currency))}${corporateHtml}　待收/待退：${escapeHtml(formatRentalMoney(Number((financial.rental as Record<string, unknown>)?.balance ?? 0), currency))}</p><p>押金已收：${escapeHtml(formatRentalMoney(Number((financial.deposit as Record<string, unknown>)?.collected ?? 0), currency))}　预授权已冻结：${escapeHtml(formatRentalMoney(Number((financial.preauthorization as Record<string, unknown>)?.frozen ?? 0), currency))}</p>`
    : `<p class="muted">${escapeHtml(String(financial?.message ?? "当前账号无资金明细查看权限"))}</p>`;
  return `<p>最终应收：<strong>${escapeHtml(formatRentalMoney(Number(summary.receivableAmount ?? 0), currency))}</strong>　调账：${escapeHtml(formatRentalMoney(Number(summary.adjustmentAmount ?? 0), currency))}</p>${financialHtml}`;
}

function publicTerminology(terminology?: RentalCategoryTerminology) {
  return {
    item: terminology?.itemLabel ?? "商品",
    pickup: terminology?.pickupLabel ?? "领取",
    return: terminology?.returnLabel ?? "归还",
    identifier: terminology?.identifierLabel ?? "资产编号"
  };
}

function inspectionFieldLabel(templates: RentalInspectionTemplate[], record: RentalInspectionRecord, code: string) {
  return templates.find((template) => template.code === record.templateCode)?.fields.find((field) => field.code === code)?.label ?? code;
}

function activeQuantity(quantity: number, cancelledQuantity?: number) {
  return Math.max(0, quantity - Math.max(0, cancelledQuantity ?? 0));
}

function safeText(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value: unknown) {
  return safeText(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formatDateTime(value: string, timeZone = "Asia/Shanghai") {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
