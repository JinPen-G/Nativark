-- RC-04：通用租赁订单的业务幂等记录与审计事件承载
--
-- 无破坏性语句：只有 CreateTable / AddColumn / AddForeignKey / CreateIndex，
-- 没有 DROP、TRUNCATE 或 DELETE，不丢弃任何既有数据。
--
-- 关于 OperationLog 新增的 rentalOrderId：
-- 该表原有的 orderId 外键指向车辆兼容域的 StoreRentalOrder，承载不了 Rental Core 订单。
-- 这里加一个**可空**列指向 rental_orders，因此对既有审计记录无影响，无需默认值。
-- 不新建审计表：OperationLog 已有 tenantId/userId/action/detail 与平台审计查询，
-- 另建一张只会造出第二个审计事实源。
--
-- 关于不复用 OrderIdempotencyRecord：
-- 那张表的 orderId 外键同样指向 StoreRentalOrder。改成双引用会让一张表同时服务
-- 两个订单域，与 RC-05「停止双事实源扩张」相悖；旧表保持不动，留待 RC-05 收口。
--
-- rental_order_idempotency_records.orderId 可空：订单创建动作在订单存在之前就要
-- 登记幂等键，创建成功后回填。

-- AlterTable
ALTER TABLE `OperationLog` ADD COLUMN `rentalOrderId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `rental_order_idempotency_records` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'succeeded',
    `response` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_idempotency_tenant_order_action_idx`(`tenantId`, `orderId`, `action`),
    UNIQUE INDEX `rental_idempotency_tenant_action_key`(`tenantId`, `action`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `OperationLog_tenantId_rentalOrderId_createdAt_idx` ON `OperationLog`(`tenantId`, `rentalOrderId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `OperationLog` ADD CONSTRAINT `OperationLog_rentalOrderId_fkey` FOREIGN KEY (`rentalOrderId`) REFERENCES `rental_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_idempotency_records` ADD CONSTRAINT `rental_order_idempotency_records_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_idempotency_records` ADD CONSTRAINT `rental_order_idempotency_records_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
