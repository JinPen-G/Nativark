-- DB-BASELINE-01：将早期迁移留下的命名与 Prisma 当前模型对齐。
-- 只调整枚举顺序、索引名和外键名，不改变业务列或数据。

ALTER TABLE `rental_pricing_groups`
  DROP FOREIGN KEY `rental_pricing_groups_categoryCode_fkey`;

ALTER TABLE `rental_pricing_groups`
  MODIFY `categoryCode` ENUM('vehicle', 'camera', 'camping', 'construction') NOT NULL;

ALTER TABLE `rental_pricing_groups`
  ADD CONSTRAINT `rental_pricing_groups_categoryCode_fkey`
    FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `rental_stock_dispositions`
  DROP FOREIGN KEY `rental_stock_dispositions_tenant_fkey`,
  DROP FOREIGN KEY `rental_stock_dispositions_workspace_fkey`,
  DROP FOREIGN KEY `rental_stock_dispositions_order_fkey`,
  DROP FOREIGN KEY `rental_stock_dispositions_inspection_fkey`,
  DROP INDEX `rental_stock_dispositions_order_idx`,
  ADD INDEX `rental_stock_dispositions_scope_status_idx` (`tenantId`, `workspaceId`, `status`),
  ADD INDEX `rental_stock_dispositions_orderId_inspectionId_idx` (`orderId`, `inspectionId`),
  ADD CONSTRAINT `rental_stock_dispositions_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_stock_dispositions_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_stock_dispositions_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `rental_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_stock_dispositions_inspectionId_fkey`
    FOREIGN KEY (`inspectionId`) REFERENCES `rental_inspection_records` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `rental_work_orders`
  DROP FOREIGN KEY `rental_work_orders_tenant_fkey`,
  DROP FOREIGN KEY `rental_work_orders_workspace_fkey`,
  DROP FOREIGN KEY `rental_work_orders_disposition_fkey`,
  DROP FOREIGN KEY `rental_work_orders_order_fkey`,
  RENAME INDEX `rental_work_orders_scope_status_type_idx` TO `rental_work_orders_tenantId_workspaceId_status_type_idx`,
  RENAME INDEX `rental_work_orders_order_inspection_idx` TO `rental_work_orders_orderId_inspectionId_idx`,
  ADD CONSTRAINT `rental_work_orders_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_work_orders_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_work_orders_dispositionId_fkey`
    FOREIGN KEY (`dispositionId`) REFERENCES `rental_stock_dispositions` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_work_orders_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `rental_orders` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
