import type {
  RentalOrder,
  RentalOrderExtension,
  RentalFundingBalance,
  RentalNotificationSendLogV1,
  RentalWorkbenchTodo,
  RentalWorkbenchTodos,
  RentalWorkOrder,
  RentalWorkbenchTodoType,
  SystemUserRow
} from "@rental-os/shared";

const TODO_TYPES: RentalWorkbenchTodoType[] = [
  "pending_payment",
  "no_show_notice",
  "no_show_confirmation",
  "return_overdue",
  "fee_review",
  "refund",
  "work_order",
  "offline_payment_pending",
  "notification_failure",
  "cancelled_refund_due"
];

/** 通知模板/手工发送/批量动作会影响整个空间，必须持有完整数据范围且没有地点限制。 */
export function canManageWorkspaceWideNotifications(
  dataScope: "all" | "organization" | "store" | "own" | undefined,
  locationIds: string[] | undefined
): boolean {
  // `store` 的契约是当前会话空间内的数据；workspaceId 已由认证上下文固定。
  // 只有组织/本人范围，或当前空间内再被地点列表缩窄时，才不是完整空间范围。
  return (dataScope === "all" || dataScope === "store") && locationIds === undefined;
}

/** 可见订单过滤必须有可解析依据；组织范围须映射到地点，store 已由当前空间限定。 */
export function canResolveNotificationOrderScope(
  dataScope: "all" | "organization" | "store" | "own" | undefined,
  locationIds: string[] | undefined
): boolean {
  return dataScope === "all" || dataScope === "store" || dataScope === "own" || locationIds !== undefined;
}

/**
 * 工作台路由本身也允许报表角色查看，但养护工单不是报表数据的默认组成部分。
 * 把这个判断抽成纯函数，控制器和专项测试共用，避免以后新增工作台待办时把
 * maintenance:view 门禁漏掉。
 */
export function canIncludeWorkbenchWorkOrders(user: Pick<SystemUserRow, "isPlatformAdmin" | "permissions">): boolean {
  return Boolean(user.isPlatformAdmin || user.permissions?.includes("*") || user.permissions?.includes("rental-core:maintenance:view"));
}

/**
 * 订单待办包含订单号、费用建议和客户履约事实，不能因为能打开工作台就一并读取。
 * 报表角色沿用工作台既有只读口径；仅有维护权限的账号只能看到工单待办。
 */
export function canIncludeWorkbenchOrderTodos(user: Pick<SystemUserRow, "isPlatformAdmin" | "permissions">): boolean {
  return Boolean(
    user.isPlatformAdmin
      || user.permissions?.includes("*")
      || user.permissions?.includes("rental-os:report:view")
      || user.permissions?.includes("rental-os:order:view")
  );
}

function iso(value: string | undefined, fallback: string) {
  return value && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function priorityFor(type: RentalWorkbenchTodoType): RentalWorkbenchTodo["priority"] {
  return ["fee_review", "refund", "no_show_confirmation", "cancelled_refund_due"].includes(type) ? "high" : "normal";
}

function add(
  items: RentalWorkbenchTodo[],
  input: Omit<RentalWorkbenchTodo, "priority"> & { priority?: RentalWorkbenchTodo["priority"] }
) {
  items.push({ ...input, priority: input.priority ?? priorityFor(input.type) });
}

/** 通知日志没有地点列，受限账号只能看到可见订单关联的业务通知。 */
export function filterNotificationLogsByVisibleOrders(
  logs: RentalNotificationSendLogV1[],
  orders: RentalOrder[]
): RentalNotificationSendLogV1[] {
  const visibleOrderIds = new Set(orders.map((order) => order.id));
  return logs.filter((log) =>
    log.businessObjectType === "order" &&
    Boolean(log.businessObjectId) &&
    visibleOrderIds.has(log.businessObjectId!)
  );
}

/**
 * 只做纯聚合，便于内存专项直接覆盖边界；数据库和权限范围由调用方提供已经
 * 按当前租户/空间过滤的订单、工单和资金余额。
 */
export function buildRentalWorkbenchTodos(
  orders: RentalOrder[],
  workOrders: RentalWorkOrder[],
  fundingByOrderId: Record<string, RentalFundingBalance | undefined> = {},
  extensionsByOrderId: Record<string, RentalOrderExtension[] | undefined> = {},
  notificationLogs: RentalNotificationSendLogV1[] = [],
  at = new Date().toISOString()
): RentalWorkbenchTodos {
  const now = Date.parse(at);
  if (!Number.isFinite(now)) throw new Error("待办聚合时间无效");
  const items: RentalWorkbenchTodo[] = [];

  for (const order of orders) {
    const orderHref = `/rental/orders/${order.id}`;
    const soft = (order.reservations ?? []).filter((row) => row.status === "soft");
    if (
      order.status === "draft" &&
      soft.length > 0 &&
      soft.every((row) => row.expiresAt && Date.parse(row.expiresAt) <= now)
    ) {
      add(items, {
        id: `pending_payment:${order.id}`,
        type: "pending_payment",
        title: "待支付占用已超时",
        description: "订单仍占用库存、服务或优惠资源，需要取消并释放占用。",
        href: orderHref,
        orderId: order.id,
        orderNo: order.orderNo,
        createdAt: iso(soft.map((row) => row.expiresAt).filter(Boolean).sort()[0], order.createdAt)
      });
    }

    if (order.status === "pickup_overdue") {
      const noticeRecorded = Boolean(order.noShowNoticeAt);
      add(items, {
        id: `${noticeRecorded ? "no_show_confirmation" : "no_show_notice"}:${order.id}`,
        type: noticeRecorded ? "no_show_confirmation" : "no_show_notice",
        title: noticeRecorded ? "待确认爽约" : "待通知客户爽约",
        description: noticeRecorded
          ? "客户通知已记录，达到最终时限或填写原因后才能确认爽约。"
          : "请先通过已启用的通知模板记录客户通知，不能直接确认爽约。",
        href: orderHref,
        orderId: order.id,
        orderNo: order.orderNo,
        createdAt: iso(order.pickupOverdueAt, order.createdAt)
      });
    }

    const effectiveEndAt = order.effectiveEndAt ?? order.endAt;
    const activeAllocation = (order.allocations ?? []).some((row) => row.status === "picked_up");
    if (order.status === "renting" && activeAllocation && Date.parse(effectiveEndAt) < now) {
      add(items, {
        id: `return_overdue:${order.id}`,
        type: "return_overdue",
        title: "订单逾时未归还",
        description: `约定归还时间为 ${new Date(effectiveEndAt).toLocaleString("zh-CN")}，请办理归还检查或联系客户。`,
        href: orderHref,
        orderId: order.id,
        orderNo: order.orderNo,
        createdAt: effectiveEndAt
      });
    }

    // refund_due 不进这条通用「待裁定费用」待办：它挂在已取消/已爽约的终态订单上，
    // 不阻止结清，且语义是"退款/释放待办"而非"计费待裁定"，单列为 cancelled_refund_due。
    for (const review of (order.feeReviews ?? []).filter((row) => row.status === "pending" && row.type !== "refund_due")) {
      add(items, {
        id: `fee_review:${order.id}:${review.id}`,
        type: "fee_review",
        title: "待裁定费用",
        description: `${review.type === "overdue" ? "逾期费用" : review.type === "service_refund" ? "增值服务退款" : "提前归还退款"}需要人工裁定；裁定前订单不能结清。`,
        href: orderHref,
        orderId: order.id,
        orderNo: order.orderNo,
        amount: review.suggestedAmount,
        createdAt: review.createdAt
      });
    }

    // 取消/爽约后仍持有押金、预授权或多收租金：挂 cancelled_refund_due 待办，
    // 提醒运营在资金区按权限办理退款/释放。宿主订单已是终态，裁定金额中性、不阻止结清。
    if (order.status === "cancelled" || order.status === "no_show") {
      const refundDue = (order.feeReviews ?? []).find((row) => row.status === "pending" && row.type === "refund_due");
      if (refundDue) {
        add(items, {
          id: `cancelled_refund_due:${order.id}:${refundDue.id}`,
          type: "cancelled_refund_due",
          title: order.status === "no_show" ? "爽约后待退款/释放保证金" : "取消后待退款/释放保证金",
          description: "订单已终结但仍持有押金、预授权冻结或多收租金；请在资金区按权限办理退款或释放。",
          href: orderHref,
          orderId: order.id,
          orderNo: order.orderNo,
          amount: refundDue.suggestedAmount,
          createdAt: refundDue.createdAt
        });
      }
    }

    const extensions = extensionsByOrderId[order.id] ?? [];
    const approvedExtensionRefund = extensions.find((row) => row.status === "effective" && row.pricingSnapshot?.refundReview?.status === "approved");
    const approvedServiceRefund = (order.serviceSnapshots ?? []).some((row) => row.refundStatus === "approved_pending_refund");
    const hasRefundCharge = (order.chargeLines ?? []).some((row) => ["early_return_refund", "order_change"].includes(row.type) && Number(row.amount) < 0);
    const rentalBalance = fundingByOrderId[order.id]?.rental.balance ?? 0;
    if (rentalBalance < -0.005 && (approvedExtensionRefund || approvedServiceRefund || hasRefundCharge || order.status === "settling" || order.status === "completed")) {
      add(items, {
        id: `refund:${order.id}`,
        type: "refund",
        title: fundingByOrderId[order.id]?.balanceBasis === "simulated" ? "待办理模拟退款" : "待办理实际退款",
        description: fundingByOrderId[order.id]?.balanceBasis === "simulated"
          ? "演练退款审核/应收核减已完成，模拟资金尚未收尾，不代表实际退款。"
          : "退款审核/应收核减已完成，但尚缺原资金渠道的实际退款记录；模拟事件不能代替。",
        href: orderHref,
        orderId: order.id,
        orderNo: order.orderNo,
        amount: Math.abs(rentalBalance),
        createdAt: order.updatedAt ?? order.createdAt
      });
    }
  }

  for (const workOrder of workOrders.filter((row) => ["pending", "pending_review"].includes(row.status))) {
    add(items, {
      id: `work_order:${workOrder.id}`,
      type: "work_order",
      title: workOrder.status === "pending_review" ? "待验收养护工单" : "待处理养护工单",
      description: workOrder.reason,
      href: "/rental/work-orders",
      workOrderId: workOrder.id,
      createdAt: workOrder.createdAt,
      priority: workOrder.status === "pending_review" ? "high" : "normal"
    });
  }

  // NOTICE-01：只有带订单业务对象的失败通知才进入工作台，确保待办有明确处理出口。
  // 模拟成功、已处理历史记录和没有业务对象的手工发送不伪造成业务待办。
  for (const log of filterNotificationLogsByVisibleOrders(notificationLogs, orders).filter(
    (row) => ["failed", "delivery_failed", "delivery_uncertain", "simulation_failed"].includes(row.status) && row.businessObjectType === "order" && row.businessObjectId
  )) {
    const order = orders.find((row) => row.id === log.businessObjectId);
    // filterNotificationLogsByVisibleOrders 已保证父订单处于当前会话可见范围。
    if (!order) continue;
    add(items, {
      id: `notification_failure:${log.id}`,
      type: "notification_failure",
      title: "业务通知发送失败",
      description: `${log.eventCode} 未成功记录发送结果${log.errorMessage ? `：${log.errorMessage}` : "，请检查通知模板与渠道配置"}。`,
      href: `/rental/orders/${order.id}`,
      orderId: order.id,
      orderNo: order.orderNo,
      createdAt: log.createdAt,
      priority: "high"
    });
  }

  const priorityRank = { high: 0, normal: 1 } as const;
  items.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  const counts = Object.fromEntries(TODO_TYPES.map((type) => [type, items.filter((item) => item.type === type).length])) as Record<RentalWorkbenchTodoType, number>;
  return { generatedAt: at, counts, items };
}
