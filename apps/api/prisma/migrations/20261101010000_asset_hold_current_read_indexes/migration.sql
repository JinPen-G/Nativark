-- Asset-scoped locking reads must not scan holds belonging to other assets.
-- Additive only: no historical facts or enum values are rewritten.
CREATE INDEX `rental_stock_dispositions_asset_status_idx`
  ON `rental_stock_dispositions`(`workspaceId`, `assetId`, `status`);
CREATE INDEX `rental_work_orders_asset_status_idx`
  ON `rental_work_orders`(`workspaceId`, `assetId`, `status`);
