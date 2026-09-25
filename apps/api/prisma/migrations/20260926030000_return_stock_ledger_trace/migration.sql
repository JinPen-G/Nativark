-- F09/F10/R02：归还调拨与维修隔离流水可追溯到订单、检查和维修量变化。
ALTER TABLE `rental_stock_ledger_entries`
  ADD COLUMN `maintenanceDelta` INTEGER NOT NULL DEFAULT 0 COMMENT '本次维修隔离量变化；正数隔离、负数恢复',
  ADD COLUMN `sourceOrderId` VARCHAR(191) NULL COMMENT '来源租赁订单 ID',
  ADD COLUMN `sourceInspectionId` VARCHAR(191) NULL COMMENT '来源归还检查记录 ID',
  ADD COLUMN `sourceDispositionId` VARCHAR(191) NULL COMMENT '来源归还处置 ID',
  ADD INDEX `rental_stock_ledger_order_idx` (`tenantId`, `workspaceId`, `sourceOrderId`, `createdAt`),
  ADD INDEX `rental_stock_ledger_inspection_idx` (`tenantId`, `workspaceId`, `sourceInspectionId`, `createdAt`),
  ADD INDEX `rental_stock_ledger_disposition_idx` (`tenantId`, `workspaceId`, `sourceDispositionId`, `createdAt`);
