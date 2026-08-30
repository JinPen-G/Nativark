-- NOTICE-01A：通知发送记录补业务对象与空间级幂等键。
-- 三列均可空：手工发送没有业务对象、也不参与去重；业务事件驱动的通知才带键。
-- 唯一索引 (workspaceId, idempotencyKey) 让「同一空间同一业务事件」只落一条，
-- 而 NULL 键彼此不冲突，手工发送不受约束。
ALTER TABLE `rental_notification_logs` ADD COLUMN `businessObjectId` VARCHAR(191) NULL,
    ADD COLUMN `businessObjectType` VARCHAR(191) NULL,
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `rental_notification_logs_ws_idempotency_key` ON `rental_notification_logs`(`workspaceId`, `idempotencyKey`);
