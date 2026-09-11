-- RULE-CLOSE-01：区分“领取超时待确认爽约”和“已爽约”终态。
-- 旧订单只会落在原有枚举值，新字段均允许为空，读取存量订单不改变原语义。
ALTER TABLE `rental_orders`
  MODIFY `status` ENUM(
    'draft',
    'reserved',
    'pickup_overdue',
    'ready_for_pickup',
    'renting',
    'return_inspection',
    'settling',
    'completed',
    'cancelled',
    'no_show'
  ) NOT NULL DEFAULT 'reserved',
  ADD COLUMN `pickupOverdueAt` DATETIME(3) NULL,
  ADD COLUMN `noShowNoticeAt` DATETIME(3) NULL,
  ADD COLUMN `noShowAt` DATETIME(3) NULL,
  ADD COLUMN `noShowReason` VARCHAR(191) NULL;
