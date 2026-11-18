/** 原看板策略路径转接 Rental 的同一实现，保留既有消费者。 */
export {
  mergeWorkOrderDisplayOrder,
  resolveWorkOrderBoardMove,
  UNASSIGNED_WORK_ORDER,
  workOrderColumn
} from "@rental-os/rental-core/admin/work-orders/policy";
export type {
  WorkOrderBoardAction,
  WorkOrderBoardMove
} from "@rental-os/rental-core/admin/work-orders/policy";
