import type { ColumnDef, HeaderContext } from "@tanstack/react-table";
import type { RentalOrder } from "@rental-os/shared";
import { formatRentalMoney, rentalAllocationProgress } from "@rental-os/shared";
import dayjs from "dayjs";
import { useId } from "react";
import { CalendarCheck2, ChevronDown, ChevronUp, CircleCheck, CircleDashed, CircleHelp, CircleX, ClipboardCheck, ClockAlert, Layers, ListTodo, LockKeyhole, LockOpen, PackageCheck, ReceiptText, Timer, TriangleAlert, UserX, Wallet, type LucideIcon } from "lucide-react";
import { Button, DataTableColumnHeader, DataTableLeading, DataTableMoney, DataTableStatus, DataTableNote, Tooltip } from "@/components/ui";
import { ADMIN_TABLE_COLUMN_WIDTH as columnWidth } from "@/app/designTokens";
import type { AdminLocale, AdminTranslate } from "@/app/locale";
import { hasPendingFeeReview } from "./orderFeeReview";
import { orderTimingNotice, plannedReturnAt, timeSpanParts } from "./orderListPresentation";
import styles from "./RentalOrdersPage.module.css";
import { RentalOrderRowActions } from "./RentalOrderRowActions";
import { CustomerPreview } from "@/features/membership/CustomerPreview";
import type { OrderActionPermissions } from "./orderQuickActions";

export const orderStatusLabels: Record<string, string> = { draft: "软预占", reserved: "已确认", pickup_overdue: "待确认爽约", ready_for_pickup: "待交付", renting: "租赁中", return_inspection: "归还检查", settling: "待结算", completed: "已关闭", cancelled: "已取消", no_show: "已爽约" };

// Domain semantics, not the demo's fictional active/queued/failed status machine.
export function orderStatusTone(status: string) {
  if (status === "completed") return "success";
  if (["pickup_overdue", "return_inspection", "settling", "no_show"].includes(status)) return "warning";
  if (status === "renting") return "active";
  if (["reserved", "ready_for_pickup"].includes(status)) return "info";
  return "neutral";
}

const orderStatusIcons: Record<string, LucideIcon> = {
  draft: CircleDashed, reserved: CalendarCheck2, pickup_overdue: ClockAlert,
  ready_for_pickup: PackageCheck, renting: Timer, return_inspection: ClipboardCheck,
  settling: Wallet, completed: CircleCheck, cancelled: CircleX, no_show: UserX,
};
export function orderStatusIcon(status: string): LucideIcon {
  return Object.hasOwn(orderStatusIcons, status) ? orderStatusIcons[status] : CircleHelp;
}
function OrderStatusBadge({ status, t }: { status: string; t: OrderColumnContext["t"] }) {
  const tone = orderStatusTone(status);
  return <DataTableStatus variant="soft" tone={tone} icon={orderStatusIcon(status)} tinted>
    {t(orderStatusLabels[status] ?? status)}
  </DataTableStatus>;
}
function hasAllocationNote(order: RentalOrder) {
  return ["reserved", "ready_for_pickup"].includes(order.status) || Boolean(order.assignment?.issue);
}
function AllocationNote({ order, t }: { order: RentalOrder; t: OrderColumnContext["t"] }) {
  const label = order.assignment?.issue ? "待人工处理" : rentalAllocationProgress(order).label;
  const icons: Record<string, LucideIcon> = { "待分配": Layers, "部分分配": ListTodo, "待锁定": LockOpen, "已锁定": LockKeyhole, "待人工处理": TriangleAlert };
  // Successful locking is background context; outstanding work keeps its recognisable icon.
  if (label === "已锁定") return <span className={styles.secondary}>{t(label)}</span>;
  return <DataTableNote tone={order.assignment?.issue ? "warning" : "neutral"} icon={icons[label] ?? CircleHelp}>{t(label)}</DataTableNote>;
}

interface OrderColumnContext {
  t: AdminTranslate;
  locale?: AdminLocale;
  now: number;
  permissions: OrderActionPermissions;
  pickupLabel?: string;
  returnLabel?: string;
  navigate: (path: string) => void;
  labels: Record<string, string>;
}

const englishDurationUnits = {
  "天": new Intl.NumberFormat("en-US", { style: "unit", unit: "day", unitDisplay: "long" }),
  "小时": new Intl.NumberFormat("en-US", { style: "unit", unit: "hour", unitDisplay: "long" }),
  "分钟": new Intl.NumberFormat("en-US", { style: "unit", unit: "minute", unitDisplay: "long" }),
};
function Duration({ minutes, t, locale = "zh-CN" }: { minutes: number; t: OrderColumnContext["t"]; locale?: AdminLocale }) {
  const parts = timeSpanParts(minutes);
  const full = parts.length ? parts.map(part => locale === "en-US" ? englishDurationUnits[part.unit].format(part.value) : `${part.value} ${t(part.unit)}`).join(" ") : t("不足 1 分钟");
  const units = { "天": "天", "小时": "时", "分钟": "分" };
  // Display precision only: keep the full minute span available, never round a fee or deadline.
  const englishUnits = { "天": "d", "小时": "h", "分钟": "min" };
  const compact = parts.length ? parts.slice(0, 2).map(part => `${part.value}${locale === "en-US" ? englishUnits[part.unit] : t(units[part.unit])}`).join(locale === "en-US" ? " " : "") : t("不足 1 分钟");
  return <span className={styles.duration} title={full} aria-label={full}>{compact}</span>;
}

/** Row identity stays frozen to the order. The opt-in hover preview reads current customer facts separately. */
function CustomerSummary({ order, t }: { order: RentalOrder; t: OrderColumnContext["t"] }) {
  const snapshot = order.membershipSnapshot;
  const name = (snapshot?.personalCustomerName ?? order.customerName)?.trim() || "—";
  const corporate = !snapshot && order.customerType === "corporate";
  return <div className={styles.identityRow}>
    <div className={styles.identityCopy}>
      <DataTableLeading><span className={styles.customerName}><CustomerPreview customerId={snapshot?.personalCustomerId ?? order.customerId} name={name} type={corporate ? "corporate" : "personal"} companyName={snapshot?.corporateCustomerName} snapshot /></span></DataTableLeading>
      {snapshot?.corporateCustomerName ? <span className={styles.identityDetail}>
        <span><CustomerPreview customerId={snapshot.corporateCustomerId} name={snapshot.corporateCustomerName} type="corporate" snapshot /> · {t(snapshot.enterpriseContractAndPayer ? "企业签约付款" : "企业权益")}</span>
      </span> : !snapshot ? <span className={styles.secondary}>{t("旧客户记录")}</span> : null}
    </div>
  </div>;
}

/** Normal rows show one item and a count-level disclosure, not a stack of repeated category marks. */
function OrderItemsSummary({ lines, expanded, onToggle, t }: { lines: RentalOrder["lines"]; expanded: boolean; onToggle: () => void; t: OrderColumnContext["t"] }) {
  const contentId = useId();
  const [first, ...rest] = lines;
  if (!first) return <span className={styles.secondary}>—</span>;
  return <div className={styles.cellStack}>
    <DataTableLeading><span className={styles.itemName}>{first.itemGroupName}</span></DataTableLeading>
    <div className={styles.itemMeta}>
      <span className={styles.itemQuantity}>{t("数量")} × {first.quantity}</span>
      {rest.length > 0 && <Button type="link" className={styles.moreItemsTrigger} aria-expanded={expanded} aria-controls={contentId}
        onClick={onToggle}>
        {expanded ? t("收起") : t("另 {count} 项", { count: rest.length })}{expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </Button>}
    </div>
    {rest.length > 0 && <div id={contentId} className={styles.itemList} hidden={!expanded}>
      {rest.map(line => <div key={line.id} className={styles.itemLine}>
        <span className={styles.itemName}>{line.itemGroupName}</span><span className={styles.itemQuantity}>{t("数量")} × {line.quantity}</span>
      </div>)}
    </div>}
  </div>;
}

function PlannedTime({ order, kind, now, t, locale }: { order: RentalOrder; kind: "pickup" | "return"; now: number; t: OrderColumnContext["t"]; locale?: AdminLocale }) {
  const value = kind === "pickup" ? order.startAt : plannedReturnAt(order);
  const date = dayjs(value);
  const notice = orderTimingNotice(order, now);
  const applies = notice?.kind === kind;
  const extended = kind === "return" && order.effectiveEndAt && order.effectiveEndAt !== order.endAt;
  return <div className={styles.cellStack}>
    <DataTableLeading>{date.isValid() ? <time dateTime={value} className={styles.plannedDate}><span>{date.format("YYYY-MM-DD")}</span><span className={styles.plannedClock}>{date.format("HH:mm")}</span></time> : <span className={styles.secondary}>{t("时间待核对")}</span>}</DataTableLeading>
    {applies && notice ? <span className={styles.timingNotice} data-tone={notice.tone}><ClockAlert aria-hidden="true" /><span>{t(notice.label)}</span><Duration minutes={notice.minutes} t={t} locale={locale} /></span>
      : kind === "return" && date.isValid() && dayjs(order.startAt).isValid() && date.isAfter(order.startAt) ? <span className={styles.secondary}>{t("租期")} · <Duration minutes={date.diff(dayjs(order.startAt), "minute")} t={t} locale={locale} /></span> : null}
    {extended && <Tooltip title={`${t("已续租，原")} ${dayjs(order.endAt).format("YYYY-MM-DD HH:mm")}`}>
      <span className={styles.secondary} tabIndex={0} aria-label={`${t("已续租，原")} ${dayjs(order.endAt).format("YYYY-MM-DD HH:mm")}`}>{t("已续租")}</span>
    </Tooltip>}
    {kind === "return" && order.fulfillmentMode === "carrier_shipping" && order.carrierRentalDueAt && <span className={styles.secondary}>{t("寄送约定归还")}</span>}
  </div>;
}

/** Facts → current deadline → amount → status/action. Audit detail remains opt-in. */
export function rentalOrderColumns({ t, locale, now, permissions, pickupLabel, returnLabel, navigate, labels }: OrderColumnContext): ColumnDef<RentalOrder, unknown>[] {
  const header = (id: string) => ({ column }: HeaderContext<RentalOrder, unknown>) => <DataTableColumnHeader column={column} label={labels[id]} />;
  return [
    { id: "orderNo", accessorKey: "orderNo", meta: { cellAlign: "middle" }, header: header("orderNo"), size: columnWidth.identifier, enableHiding: false, cell: ({ row }) => <div className={styles.cellStack}>
      <DataTableLeading><Button type="link" className={styles.orderLink} onClick={() => navigate(`/rental/orders/${row.original.id}`)}>{row.original.orderNo}</Button></DataTableLeading>
    </div> },
    { id: "customerName", accessorFn: order => order.membershipSnapshot?.personalCustomerName ?? order.customerName, meta: { cellAlign: order => !order.membershipSnapshot || order.membershipSnapshot.corporateCustomerName ? "top" : "middle", motion: { value: order => JSON.stringify([order.membershipSnapshot?.personalCustomerName ?? order.customerName, order.membershipSnapshot?.corporateCustomerName, order.membershipSnapshot?.enterpriseContractAndPayer, order.customerType, order.membershipSnapshot?.personalCustomerId || order.customerId]) } }, header: header("customerName"), size: columnWidth.identity, cell: ({ row }) => <CustomerSummary order={row.original} t={t} /> },
    { id: "items", accessorFn: order => order.lines.map(line => line.itemGroupName).join("、"), meta: { cellAlign: order => order.lines.length ? "top" : "middle", motion: { value: order => JSON.stringify(order.lines.map(line => [line.id, line.itemGroupName, line.quantity])) } }, header: header("items"), size: columnWidth.summary, enableSorting: false, cell: ({ row }) => <OrderItemsSummary lines={row.original.lines} expanded={row.getIsExpanded()} onToggle={() => row.toggleExpanded()} t={t} /> },
    { id: "startAt", accessorKey: "startAt", meta: { cellAlign: order => orderTimingNotice(order, now)?.kind === "pickup" ? "top" : "middle", motion: { value: order => order.startAt } }, header: header("startAt"), size: columnWidth.dateTime, cell: ({ row }) => <PlannedTime order={row.original} kind="pickup" now={now} t={t} locale={locale} /> },
    { id: "endAt", accessorFn: plannedReturnAt, meta: { motion: { value: plannedReturnAt } }, header: header("endAt"), size: columnWidth.dateTimeWithNote, cell: ({ row }) => <PlannedTime order={row.original} kind="return" now={now} t={t} locale={locale} /> },
    { id: "payableAmount", accessorKey: "payableAmount", meta: { cellAlign: "middle", motion: { value: order => typeof order.payableAmount === "number" && Number.isFinite(order.payableAmount) ? order.payableAmount : null, format: (value, order) => formatRentalMoney(value, order.currency), renderNumber: formatted => <DataTableMoney formatted={formatted} />, context: order => order.currency ?? "" } }, header: header("payableAmount"), size: columnWidth.money, cell: ({ row }) => <DataTableLeading><DataTableMoney formatted={typeof row.original.payableAmount === "number" && Number.isFinite(row.original.payableAmount) ? formatRentalMoney(row.original.payableAmount, row.original.currency) : "—"} /></DataTableLeading> },
    { id: "status", accessorKey: "status", meta: { cellAlign: order => hasAllocationNote(order) || hasPendingFeeReview(order) ? "top" : "middle", motion: { value: order => JSON.stringify([order.status, rentalAllocationProgress(order).label, order.assignment?.issue, hasPendingFeeReview(order)]), status: true } }, header: header("status"), size: columnWidth.status, cell: ({ row }) => <div className={styles.cellStack}>
      <DataTableLeading><OrderStatusBadge status={row.original.status} t={t} /></DataTableLeading>
      {hasAllocationNote(row.original) && <AllocationNote order={row.original} t={t} />}
      {hasPendingFeeReview(row.original) && <DataTableNote tone="warning" icon={ReceiptText}>{t("待裁定费用")}</DataTableNote>}
    </div> },
    { id: "allocations", accessorFn: order => order.allocations, meta: { motion: { value: order => JSON.stringify(order.allocations.map(allocation => [allocation.id, allocation.status, allocation.assetNo, allocation.quantity])) } }, header: header("allocations"), size: columnWidth.resources, enableSorting: false, cell: ({ row }) => <span>{row.original.allocations.filter(allocation => !["released", "returned", "consumed"].includes(allocation.status)).map(allocation => `${allocation.assetNo ?? allocation.metadata?.itemGroupName ?? t("数量库存")} × ${allocation.quantity}`).join("、") || t("尚未分配")}</span> },
    { id: "fulfillment", accessorFn: order => order.fulfillmentLocationName, meta: { motion: { value: order => JSON.stringify([order.fulfillmentLocationName, order.returnLocationName]) } }, header: header("fulfillment"), size: columnWidth.location, enableSorting: false, cell: ({ row }) => <div className={styles.cellStack}><span>{t("取")} · {row.original.fulfillmentLocationName || "—"}</span><span className={styles.secondary}>{t("还")} · {row.original.returnLocationName || row.original.fulfillmentLocationName || "—"}</span></div> },
    { id: "security", accessorFn: order => order.depositAmount, meta: { motion: { value: order => JSON.stringify([order.currency, order.depositAmount, order.preAuthAmount]) } }, header: header("security"), size: columnWidth.security, enableSorting: false, cell: ({ row }) => <div className={styles.cellStack}><span>{t("押金")} · {formatRentalMoney(row.original.depositAmount, row.original.currency)}</span><span className={styles.secondary}>{t("预授权")} · {formatRentalMoney(row.original.preAuthAmount, row.original.currency)}</span></div> },
    { id: "quoteNo", accessorKey: "quoteNo", meta: { motion: { value: order => JSON.stringify([order.quoteNo, order.pricingPlanVersion, order.ruleVersion]) } }, header: header("quoteNo"), size: columnWidth.snapshot, cell: ({ row }) => <div className={styles.cellStack}><span>{row.original.quoteNo}</span><span className={styles.secondary}>{t("价格")} v{row.original.pricingPlanVersion} · {t("规则")} v{row.original.ruleVersion}</span></div> },
    { id: "createdAt", accessorKey: "createdAt", meta: { cellAlign: "middle" }, header: header("createdAt"), size: columnWidth.dateTimeWithNote, cell: ({ row }) => <DataTableLeading>{row.original.createdAt && dayjs(row.original.createdAt).isValid() ? <time dateTime={row.original.createdAt} className={styles.plannedDate}><span>{dayjs(row.original.createdAt).format("YYYY-MM-DD")}</span><span className={styles.plannedClock}>{dayjs(row.original.createdAt).format("HH:mm")}</span></time> : <span className={styles.secondary}>—</span>}</DataTableLeading> },
    { id: "actions", header: labels.actions, meta: { cellAlign: "middle" }, size: columnWidth.actions, enableSorting: false, enableHiding: false, cell: ({ row }) => <DataTableLeading><RentalOrderRowActions order={row.original} permissions={permissions} pickupLabel={pickupLabel} returnLabel={returnLabel} t={t} navigate={navigate} /></DataTableLeading> },
  ];
}
