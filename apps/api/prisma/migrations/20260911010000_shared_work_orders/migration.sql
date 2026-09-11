-- SHARED-WORK-01A：养护工单最小事实表。
-- 工单必须与经营空间、归还处置、订单保持同一租户边界；
-- dispositionId + type 保证同一批处置不会因重试重复生成同类工单。
CREATE TABLE `rental_work_orders` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `workNo` VARCHAR(191) NOT NULL,
  `type` VARCHAR(24) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `dispositionId` VARCHAR(191) NULL,
  `orderId` VARCHAR(191) NULL,
  `inspectionId` VARCHAR(191) NULL,
  `itemGroupId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `assetId` VARCHAR(191) NULL,
  `quantity` INTEGER NOT NULL,
  `assigneeId` VARCHAR(191) NULL,
  `assigneeName` VARCHAR(191) NULL,
  `reason` TEXT NOT NULL,
  `result` TEXT NULL,
  `attachments` JSON NOT NULL,
  `startedAt` DATETIME(3) NULL,
  `submittedAt` DATETIME(3) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewedBy` VARCHAR(191) NULL,
  `reviewReason` TEXT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rental_work_orders_ws_no_key` (`workspaceId`, `workNo`),
  UNIQUE KEY `rental_work_orders_disp_type_key` (`workspaceId`, `dispositionId`, `type`),
  KEY `rental_work_orders_scope_status_type_idx` (`tenantId`, `workspaceId`, `status`, `type`),
  KEY `rental_work_orders_order_inspection_idx` (`orderId`, `inspectionId`),
  CONSTRAINT `rental_work_orders_tenant_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_work_orders_workspace_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_work_orders_disposition_fkey` FOREIGN KEY (`dispositionId`) REFERENCES `rental_stock_dispositions` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `rental_work_orders_order_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SHARED-WORK-01A：页面和 API 使用独立的查看、操作、审核权限。
INSERT INTO `Permission` (`id`, `code`, `name`, `description`, `module`, `kind`, `createdAt`)
SELECT UUID(), wanted.`code`, wanted.`name`, wanted.`description`, wanted.`module`, 'ACTION', CURRENT_TIMESTAMP(3)
FROM (
  SELECT 'rental-core:maintenance:view' AS `code`, '养护工单查看' AS `name`, '查看当前经营空间的归还处置和养护工单' AS `description`, 'Rental Core' AS `module`
  UNION ALL SELECT 'rental-core:maintenance:manage', '养护工单处理', '创建、派工、开始和提交养护工单', 'Rental Core'
  UNION ALL SELECT 'rental-core:maintenance:review', '养护工单验收', '审核养护结果并恢复库存可用状态', 'Rental Core'
) AS wanted
WHERE NOT EXISTS (SELECT 1 FROM `Permission` p WHERE p.`code` = wanted.`code`);
