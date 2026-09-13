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
  "notification_failure"
];

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
  return ["fee_review", "refund", "no_show_confirmation"].includes(type) ? "high" : "normal";
}

function add(
  items: RentalWorkbenchTodo[],
  input: Omit<RentalWorkbenchTodo, "priority"> & { priority?: RentalWorkbenchTodo["priority"] }
) {
  items.push({ ...input, priority: input.priority ?? priorityFor(input.type) });
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

    for (const review of (order.feeReviews ?? []).filter((row) => row.status === "pending")) {
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

    const extensions = extensionsByOrderId[order.id] ?? [];
    const approvedExtensionRefund = extensions.find((row) => row.status === "effective" && row.pricingSnapshot?.refundReview?.status === "approved");
    const approvedServiceRefund = (order.serviceSnapshots ?? []).some((row) => row.refundStatus === "approved_pending_refund");
    const hasRefundCharge = (order.chargeLines ?? []).some((row) => ["early_return_refund", "order_change"].includes(row.type) && Number(row.amount) < 0);
    const rentalBalance = fundingByOrderId[order.id]?.rental.balance ?? 0;
    if (rentalBalance < -0.005 && (approvedExtensionRefund || approvedServiceRefund || hasRefundCharge || order.status === "settling" || order.status === "completed")) {
      add(items, {
        id: `refund:${order.id}`,
        type: "refund",
        title: "待办理模拟退款",
        description: "退款审核/应收核减已完成，但资金流水尚未登记实际模拟退款。",
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
  for (const log of notificationLogs.filter(
    (row) => ["failed", "delivery_failed", "delivery_uncertain", "simulation_failed"].includes(row.status) && row.businessObjectType === "order" && row.businessObjectId
  )) {
    const order = orders.find((row) => row.id === log.businessObjectId);
    add(items, {
      id: `notification_failure:${log.id}`,
      type: "notification_failure",
      title: "业务通知发送失败",
      description: `${log.eventCode} 未成功记录发送结果${log.errorMessage ? `：${log.errorMessage}` : "，请检查通知模板与渠道配置"}。`,
      href: order ? `/rental/orders/${order.id}` : "/rental/orders",
      orderId: order?.id ?? log.businessObjectId,
      orderNo: order?.orderNo,
      createdAt: log.createdAt,
      priority: "high"
    });
  }

  const priorityRank = { high: 0, normal: 1 } as const;
  items.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  const counts = Object.fromEntries(TODO_TYPES.map((type) => [type, items.filter((item) => item.type === type).length])) as Record<RentalWorkbenchTodoType, number>;
  return { generatedAt: at, counts, items };
}
