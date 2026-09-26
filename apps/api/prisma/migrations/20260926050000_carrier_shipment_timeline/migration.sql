CREATE TABLE `rental_carrier_shipment_events` (
  `id` VARCHAR(191) NOT NULL COMMENT '承运寄送里程碑主键',
  `tenantId` VARCHAR(191) NOT NULL COMMENT '所属租户 ID',
  `workspaceId` VARCHAR(191) NOT NULL COMMENT '所属经营空间 ID',
  `orderId` VARCHAR(191) NOT NULL COMMENT '关联订单 ID',
  `type` VARCHAR(32) NOT NULL COMMENT '里程碑：发出、客户签收、客户交寄、仓库验收',
  `occurredAt` DATETIME(3) NOT NULL COMMENT '实际业务发生时间，用于承运租期计费',
  `carrierName` VARCHAR(120) NOT NULL COMMENT '承运商名称',
  `trackingNumber` VARCHAR(191) NOT NULL COMMENT '本次运输运单号',
  `evidenceFileAssetIds` JSON NOT NULL COMMENT '本里程碑的所属订单凭证文件 ID',
  `recordedBy` VARCHAR(191) NOT NULL COMMENT '记录操作人名称快照',
  `idempotencyKey` VARCHAR(191) NOT NULL COMMENT '请求幂等键',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '事件记录时间',
  UNIQUE INDEX `rental_carrier_shipment_events_idem_key` (`tenantId`, `workspaceId`, `idempotencyKey`),
  INDEX `rental_carrier_shipment_events_order_time_idx` (`tenantId`, `workspaceId`, `orderId`, `occurredAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `rental_carrier_shipment_events_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_carrier_shipment_events_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_carrier_shipment_events_tenant_ws_order_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders`(`tenantId`, `workspaceId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='承运寄送订单的签收、揽收与实物验收时间线';

ALTER TABLE `rental_orders`
  ADD COLUMN `actualRentalStartAt` DATETIME(3) NULL COMMENT '承运寄送订单经凭证核验的客户实际签收时间',
  ADD COLUMN `carrierRentalDueAt` DATETIME(3) NULL COMMENT '承运寄送订单按实际签收平移并经续租更新后的当前约定归还时间';
